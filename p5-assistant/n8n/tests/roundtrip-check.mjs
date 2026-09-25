#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Workflow 往返核对（P03 步骤 11 / P11 步骤 3）
//
// 为什么单独一个脚本、不并进主测试：它要真的起一次 n8n CLI 导入导出，
// 冷启动几十秒。主测试要保持"随手可跑"，这个放在阶段收尾与最终验收各跑一次。
//
// 用法（**目标必须显式给出**）：
//   UNIMATE_ISO_N8N=<你的系统 Temp>/unimate-n8n-iso-<唯一后缀> \
//     node tests/roundtrip-check.mjs
//
// 它自己会：
//   1) **校验**目标目录（见下），不通过就立刻停
//   2) 让 n8n 在**一个全新的**隔离用户目录里跑导入 / 导出（不碰 %USERPROFILE%\.n8n）
//   3) 逐项结构比对，报告结果；跑完目录**保留**在原地作为证据
//
// ⚠️ 本脚本**没有默认目标，也不会删除任何目录**（OQ-15 裁决，产品负责人 2026-09-25）。
//    原先的默认目标 `Temp/n8n-iso` 正是 P01 要求保留的目录，而脚本开头会把它清空重建——
//    那个默认值已经删掉了。守卫的全部规则见 `tests/lib/iso-dir-guard.mjs`，
//    保留目录清单在 `docs/open-questions.md` 的 RESERVED-ISO-DIRS 块里（守卫直接读它）。
//
// ⚠️ "导入成功"不等于"运行成功"。本脚本只证明结构没丢。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { guardIsoDir, parseReservedDirs } from './lib/iso-dir-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const WF_DIR = resolve(HERE, '..', 'workflows')
const RESERVED_DOC = resolve(ROOT, 'docs', 'open-questions.md')

let checks = 0
const failures = []
const bad = (id, msg) => failures.push({ id, msg })
const good = () => { checks++ }

// ─── ① 全部路径校验 —— 必须在**任何**动作之前完成 ───────────────────────────
//     本文件里没有任何 rmSync：删目录这件事已经从这个脚本里彻底拿掉了。
const reservedText = existsSync(RESERVED_DOC) ? readFileSync(RESERVED_DOC, 'utf8') : ''
const reserved = parseReservedDirs(reservedText)
const guard = guardIsoDir(process.env.UNIMATE_ISO_N8N, { reserved })

if (!guard.ok) {
  console.error('✗ 隔离目录校验未通过 —— 已停止，**没有创建、删除或修改任何东西**：\n')
  for (const e of guard.errors) console.error('   •', e)
  console.error('\n  目标必须满足：')
  console.error('    · 通过 UNIMATE_ISO_N8N 显式提供（本脚本不再有默认值）')
  console.error('    · 是绝对路径，且位于系统临时目录内')
  console.error(`    · 目录名以 "${'unimate-n8n-iso-'}" 开头`)
  console.error('    · 执行前**尚不存在**（已存在 ⇒ 停，不删、不清、不复用）')
  console.error('    · 不是保留目录本身，也不与保留目录构成父子关系')
  console.error(`    · 保留清单读自 ${RESERVED_DOC}（读不到也拒绝运行）`)
  process.exit(1)
}
const ISO_DIR = guard.path

// ─── ② 起隔离实例并导入 ──────────────────────────────────────────────────────
const env = { ...process.env, N8N_USER_FOLDER: ISO_DIR }
// Windows 上 n8n 是 .cmd 外壳，execFileSync 直接调不动 —— 必须过 shell。
// 路径里不能有空格（WF_DIR / ISO_DIR 都没有），args 拼进命令行是安全的。
const runN8n = (args) => execFileSync('n8n', args, {
  env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000, shell: true,
})

console.log('── Workflow 往返核对 ──────────────────────────────────')
console.log('隔离用户目录:', ISO_DIR)

const files = readdirSync(WF_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
if (files.length === 0) { console.error('✗ workflows/ 下没有可导入的 JSON'); process.exit(1) }

try {
  const imp = runN8n(['import:workflow', '--separate', '--input', WF_DIR])
  const m = imp.match(/Successfully imported (\d+) workflows/)
  if (!m) bad('导入', `导入输出里没有成功行：${imp.split('\n').slice(-3).join(' / ')}`)
  else if (Number(m[1]) !== files.length) bad('导入', `预期 ${files.length} 个，实际导入 ${m[1]} 个`)
  else good()
} catch (e) {
  // 把真实错误打出来 —— 之前只吞成一句"导入失败"，排查时等于没有信息
  console.error('\n✗ 导入命令失败：')
  console.error('  message:', String(e.message).split('\n').slice(0, 6).join('\n           '))
  if (e.stderr) console.error('  stderr :', String(e.stderr).split('\n').slice(-8).join('\n           '))
  if (e.stdout) console.error('  stdout :', String(e.stdout).split('\n').slice(-8).join('\n           '))
  console.error(`\n目录保留在 ${ISO_DIR} 供排查`)
  process.exit(1)
}

// ─── 导出回来 ────────────────────────────────────────────────────────────────
const RT = join(ISO_DIR, '_roundtrip.json')
try {
  runN8n(['export:workflow', '--all', '--output', RT])
  if (!existsSync(RT)) bad('导出', '导出文件不存在')
  else good()
} catch (e) {
  bad('导出', `导出命令失败：${e.message.split('\n')[0]}`)
}

// ─── 逐项结构比对 ────────────────────────────────────────────────────────────
if (existsSync(RT)) {
  const back = JSON.parse(readFileSync(RT, 'utf8'))
  const byName = new Map(back.map((w) => [w.name, w]))

  for (const f of files) {
    const orig = JSON.parse(readFileSync(join(WF_DIR, f), 'utf8'))
    const tag = orig.name
    const rt = byName.get(tag)
    if (!rt) { bad(tag, '导出后找不到同名工作流'); continue }

    // 1) 节点集合（名称）
    const on = orig.nodes.map((n) => n.name).sort().join('|')
    const rn = rt.nodes.map((n) => n.name).sort().join('|')
    if (on !== rn) bad(tag, `节点集合变了：原 ${on} / 回 ${rn}`); else good()

    // 2) 节点类型一一对应
    const ot = orig.nodes.map((n) => `${n.name}=${n.type}`).sort().join('|')
    const rtt = rt.nodes.map((n) => `${n.name}=${n.type}`).sort().join('|')
    if (ot !== rtt) bad(tag, '节点类型变了'); else good()

    // 3) 连接逐条保留
    if (JSON.stringify(orig.connections) !== JSON.stringify(rt.connections)) {
      bad(tag, '连接变了');
    } else good()

    // 4) onError 不丢（错误传播是硬要求）
    for (const n of orig.nodes) {
      if (!n.onError) continue
      const r = rt.nodes.find((x) => x.name === n.name)
      if (r?.onError !== n.onError) bad(tag, `${n.name} 的 onError 丢了`); else good()
    }

    // 5) Code 节点正文逐字保留
    for (const n of orig.nodes) {
      if (n.type !== 'n8n-nodes-base.code') continue
      const r = rt.nodes.find((x) => x.name === n.name)
      if (r?.parameters?.jsCode !== n.parameters?.jsCode) bad(tag, `${n.name} 的 jsCode 被改写`); else good()
    }

    // 6) 必须仍是非激活
    if (rt.active !== false) bad(tag, `active 应为 false，实际 ${rt.active}`); else good()

    // 7) Webhook 路径这类关键参数
    for (const n of orig.nodes) {
      if (n.type !== 'n8n-nodes-base.webhook') continue
      const r = rt.nodes.find((x) => x.name === n.name)
      if (r?.parameters?.path !== n.parameters?.path) bad(tag, `webhook path 变了`); else good()
    }
  }
}

// ─── 报告 ────────────────────────────────────────────────────────────────────
console.log(`\n往返核对：${checks} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`  ✗ [${f.id}] ${f.msg}`)
  console.log(`\n隔离目录**保留**在 ${ISO_DIR} 供排查（本脚本不清理任何目录）`)
  process.exit(1)
}
console.log(`隔离目录**保留**：${ISO_DIR}`)
console.log('  本脚本不自动清理——它是这次核对的证据。删除需另行确认（OQ-14）。')
console.log('全部通过 ✓')
