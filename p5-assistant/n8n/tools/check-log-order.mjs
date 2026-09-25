#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 断言「记录排在应答之前」（主规划 §4.11 的"在响应返回前调用一次"）
//
// 用法（在跑过 tools/p11-runtime-check.mjs 之后）：
//   UNIMATE_ISO_DB="<隔离目录>/.n8n/database.sqlite" \
//     node tools/check-log-order.mjs
//
// 为什么需要它：`Shape Response` 分叉成两条（记录 / 应答），**数组顺序是反的**——
// n8n 的 `executionOrder: 'v1'` 处理同层分叉用**栈（LIFO）**，数组里靠后的先跑。
// 这个语义**无法从 JSON 结构上看出来**，只能从**执行数据**里读真实顺序。
//
// P09 的实测（三份证据，别丢）：
//   第一版数组 [Build Log Input, Respond] → 实际 Shape Response → Respond → Build Log Input
//                                            （响应先返回，日志后写 —— 与 §4.11 相反）
//   第二版数组 [Respond, Build Log Input] → 实际 Shape Response → Build Log Input → Log Request → Respond ✔
//
// 【口径】本脚本证明的是「**那个隔离实例里最近一次网关执行**的真实节点顺序」。
//        它不证明生产环境、不证明 Android。
// ─────────────────────────────────────────────────────────────────────────────

import { DatabaseSync } from 'node:sqlite'

const DB = process.env.UNIMATE_ISO_DB
if (!DB) {
  console.error('缺少 UNIMATE_ISO_DB。这是**故意**的 fail closed：')
  console.error('  没有执行数据就没有顺序证据，静默跳过等于把断言变成装饰。')
  console.error('  用法：UNIMATE_ISO_DB="<隔离目录>/.n8n/database.sqlite" node tools/check-log-order.mjs')
  process.exit(2)
}

const db = new DatabaseSync(DB, { readOnly: true })

// n8n 2.x 的 execution_data.data 是**扁平化**格式：数组的第 0 项是根模板，
// 对象的每个值是指向数组下标的字符串。下面三步解引用就能拿到 runData。
const deref = (arr, i) => arr[Number(i)]

/** 取最近一次 agent_gateway 执行，返回它的节点执行顺序 */
function lastGatewayOrder() {
  const rows = db.prepare(
    'SELECT id FROM execution_entity WHERE workflowId = ? ORDER BY id DESC LIMIT 20'
  ).all('unimate-agent-gateway')
  if (!rows.length) return null
  for (const { id } of rows) {
    const row = db.prepare('SELECT data FROM execution_data WHERE executionId = ?').get(String(id))
    if (!row) continue
    const arr = JSON.parse(row.data)
    const resultData = deref(arr, arr[0].resultData)
    const runData = deref(arr, resultData.runData)
    const nodes = Object.keys(runData)
    // 只认真的走完了整条链的那种（预检失败的请求不会到 Shape Response）
    if (nodes.includes('Respond') && nodes.includes('Log Request')) return { id, nodes }
  }
  return null
}

const found = lastGatewayOrder()
if (!found) {
  console.error('在最近的 20 次 agent_gateway 执行里找不到一条同时经过 Respond 与 Log Request 的。')
  console.error('先起隔离实例并跑 tools/p11-runtime-check.mjs，再跑本脚本。')
  process.exit(1)
}

const { id, nodes } = found
console.log(`execution ${id} 的节点执行顺序：`)
console.log('  ' + nodes.join(' → '))

const iLog = nodes.indexOf('Build Log Input')
const iReq = nodes.indexOf('Log Request')
const iRes = nodes.indexOf('Respond')

let bad = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} —— ${detail}`); bad++ }
}

check('Build Log Input 在 Log Request 之前', iLog >= 0 && iReq > iLog, `iLog=${iLog} iReq=${iReq}`)
check('记录在应答之前（§4.11）', iLog >= 0 && iRes > iLog,
  `Build Log Input@${iLog} 应早于 Respond@${iRes} —— 数组顺序写反了？v1 是 LIFO，Respond 要写在数组最前`)
check('应答是该执行的最后一个节点', iRes === nodes.length - 1, `Respond@${iRes} / 共 ${nodes.length} 个`)

console.log(bad === 0 ? '\n全部通过 ✓' : `\n失败 ${bad} 条 ✗`)
process.exit(bad === 0 ? 0 : 1)
