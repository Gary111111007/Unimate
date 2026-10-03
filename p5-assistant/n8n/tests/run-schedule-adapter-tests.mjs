#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ScheduleReader seam 测试（P07 / n6 —— 比赛版课表 Adapter）
//
// 用法：node tests/run-schedule-adapter-tests.mjs   → 退出码 0 = 全通过
//
// 八组：
//   A. seam 等价与通用契约：两个 Adapter 过**同一套**断言
//   B. 五个操作端到端：换 Adapter 不换答案
//   C. 跨周与节次：周次展开、单双周、节次表映射
//   D. 空 / 无课日 / 非法输入：一律丢弃计数，不抛异常
//   E. 时区与区间边界：窗口按时刻交叠，不按日期字符串
//   F. P-01 / P-02 默认规则：默认值必须出现在 explain 里
//   G. 零网络 / 拒绝路径零读取（计数 reader 硬断言）
//   H. n8n 侧行为等价：workflow 节点 JS 与 core 实现逐字段相同
//
// 【口径】H 组证明的是「两份实现语义相同」，**不是**「Workflow 在 n8n 里跑通了」。
//        后者仍然是未验证（OQ-12）。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  FixtureScheduleReader,
  StandardCourseReader,
  NullScheduleReader,
  courseToBusySlot,
  fixtureToCourses,
  mondayOf,
  parseWeeks,
  periodSpan,
} from '../core/schedule-reader.ts'
import { LocalRulesAdapter, PROVENANCE_PREFIX, queryWindowFor } from '../core/local-rules-adapter.ts'
import { UNSUPPORTED_INTENTS, ask, buildCapsule } from '../core/uni-core.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const failures = []
let passed = 0
const fail = (g, id, msg) => failures.push({ g, id, msg })
const ok = () => { passed++ }
const check = (g, id, cond, msg) => { if (cond) ok(); else fail(g, id, msg) }

// ─── 常量：全部来自 fixtures/schedule-fixture-a.json 的可核对事实 ──────────────
const TERM = '2026-09-07'          // 第 1 周周一
const W4_WED = '2026-09-30'        // 第 4 周周三 ← §1.4 九十秒演示的基准日
const SH = 'Asia/Shanghai'
const NY = 'America/New_York'
const NOW = new Date('2026-09-30T09:30:00+08:00')
const TERM_END = '2026-12-27'      // 第 16 周周日

const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'schedule-fixture-a.json'), 'utf8'))
const TODO = [{ title: '交高数作业', dueAt: `${W4_WED}T20:00:00+08:00`, done: false }]

/** I 组用：只测「周统计不产胶囊」，不测胶囊内容，所以一份最小上下文就够。 */
const CONTEXTS_FOR_CAPSULE = {
  schedule: [
    { startAt: `${W4_WED}T10:00:00+08:00`, endAt: `${W4_WED}T11:40:00+08:00`, title: '高等数学' },
    { startAt: `${W4_WED}T14:00:00+08:00`, endAt: `${W4_WED}T15:40:00+08:00`, title: '大学物理' },
  ],
  todoSummary: [{ title: '交高数作业', dueAt: `${W4_WED}T20:00:00+08:00`, done: false }],
}

// ─── 测试自带的独立展开器（oracle）───────────────────────────────────────────
// 刻意**不复用** core 的任何解析函数：core 错和 oracle 错才会变成两件事，
// 复用的话两边会一起错，测试就成了自证。
function oracleCourses(fx) {
  const wd = (iso) => { const w = new Date(`${iso}T12:00:00Z`).getUTCDay(); return w === 0 ? 7 : w }
  const shift = (iso, n) => {
    const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10)
  }
  const monday = shift(fx.termStart, 1 - wd(fx.termStart))
  const table = new Map(fx.periods.map((p) => [p.period, p]))
  const out = []
  for (const r of fx.rows) {
    const weeks = []
    for (const part of String(r.weeks).split(',')) {
      const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/)
      if (m) { for (let w = +m[1]; w <= +m[2]; w++) weeks.push(w) } else weeks.push(Number(part.trim()))
    }
    const kept = weeks
      .filter((w) => (r.parity === 'odd' ? w % 2 === 1 : r.parity === 'even' ? w % 2 === 0 : true))
      .sort((a, b) => a - b)
    const nums = [...r.periods].sort((a, b) => a - b)
    for (const w of kept) {
      out.push({
        date: shift(monday, (w - 1) * 7 + (r.weekday - 1)),
        startHM: table.get(nums[0]).start,
        endHM: table.get(nums[nums.length - 1]).end,
        name: r.courseName,
        location: r.room,
        teacher: r.teacherName,
        periodLabel: nums.length === 1 ? `第${nums[0]}节` : `第${nums[0]}-${nums[nums.length - 1]}节`,
      })
    }
  }
  return out
}

const FIX_READER = new FixtureScheduleReader(FIXTURE)
const STD_READER = new StandardCourseReader(oracleCourses(FIXTURE))
const READERS = [FIX_READER, STD_READER]

/** 两个 Adapter 都要过同一套断言的公共体检。 */
function examine(g, tag, r, q) {
  const res = r.read(q)
  const WHERE = `${tag} ${JSON.stringify(q)}`

  // 1) 结果只有三个键（多一个字段就是接口漂移）
  const keys = Object.keys(res).sort().join(',')
  check(g, `${WHERE} 结果字段`, keys === 'busySlots,dropped,readerId', `期望 busySlots,dropped,readerId，实际 ${keys}`)

  // 2) readerId 必须是自己的 id，且不含学校名
  check(g, `${WHERE} readerId`, res.readerId === r.id, `期望 ${r.id}，实际 ${res.readerId}`)

  for (const [i, s] of res.busySlots.entries()) {
    const sk = Object.keys(s).sort().join(',')
    // 3) 字段集合必须是 BusySlot 白名单的子集
    check(g, `${WHERE} slot[${i}] 字段`, sk.split(',').every((k) => ['startAt', 'endAt', 'title', 'location', 'periodLabel'].includes(k)),
      `出现契约外字段：${sk}`)
    // 4) 带偏移的 ISO-8601
    check(g, `${WHERE} slot[${i}] startAt 带偏移`, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(s.startAt), s.startAt)
    check(g, `${WHERE} slot[${i}] endAt 带偏移`, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(s.endAt), s.endAt)
    // 5) endAt > startAt（按真实时刻，不是字符串）
    check(g, `${WHERE} slot[${i}] 顺序`, Date.parse(s.endAt) > Date.parse(s.startAt), `${s.startAt} → ${s.endAt}`)
  }

  // 6) 不得出现教师、学校名、教务字样
  const blob = JSON.stringify(res)
  for (const leak of ['教师', '北化', '北京化工', '二外', '北京第二外国语', '教务', '学号', '2025040999']) {
    check(g, `${WHERE} 泄漏扫描`, !blob.includes(leak), `读取结果里出现「${leak}」`)
  }
  check(g, `${WHERE} readerId 不含学校名`, !/北化|北京化工|二外/.test(res.readerId), res.readerId)

  // 7) 确定性：同输入两次结果完全相同
  check(g, `${WHERE} 确定性`, JSON.stringify(r.read(q)) === JSON.stringify(res), '连续两次读取结果不一致')

  return res
}

const WINDOWS = [
  { timezone: SH, from: W4_WED, to: W4_WED },
  { timezone: SH, from: TERM, to: TERM_END },
  { timezone: SH, from: '2026-09-20', to: '2026-09-21' },
  { timezone: SH, from: '2026-09-27', to: '2026-09-28' },
  { timezone: NY, scheduleTimezone: SH, from: W4_WED, to: W4_WED },
  { timezone: SH, from: '2026-10-05', to: '2026-10-04' },
]

// ═══ A. seam 等价与通用契约 ══════════════════════════════════════════════════
function testSeam() {
  // A-1 两个真实 Adapter 的 id 必须钉死（改名会立刻红，防止悄悄换实现）
  check('A', 'readerId 钉死', FIX_READER.id === 'fixture-period', `fixture 期望 fixture-period，实际 ${FIX_READER.id}`)
  check('A', 'readerId 钉死', STD_READER.id === 'standard-course', `standard 期望 standard-course，实际 ${STD_READER.id}`)
  check('A', '两个 Adapter 是不同实现', FIX_READER.id !== STD_READER.id, '两个 Adapter 的 id 相同')

  // A-2 【核心完成标准】同一份数据的两种表示，经各自 Adapter 必须产出**逐字段相同**的结果
  for (const q of WINDOWS) {
    const a = FIX_READER.read(q)
    const b = STD_READER.read(q)
    check('A', `等价 ${JSON.stringify(q)}`,
      JSON.stringify(a.busySlots) === JSON.stringify(b.busySlots),
      `fixture 与 standard 输出不同：\n      fixture : ${JSON.stringify(a.busySlots)}\n      standard: ${JSON.stringify(b.busySlots)}`)
    check('A', `等价 dropped ${JSON.stringify(q)}`, a.dropped === b.dropped, `${a.dropped} vs ${b.dropped}`)
  }

  // A-3 两个 Adapter 逐窗口过同一套体检
  for (const r of READERS) for (const q of WINDOWS) examine('A', r.id, r, q)

  // A-4 全学期展开条数：16+16+16+8+8 = 64
  const all = FIX_READER.read({ timezone: SH, from: TERM, to: TERM_END })
  check('A', '全学期展开条数', all.busySlots.length === 64, `期望 64，实际 ${all.busySlots.length}`)
  check('A', '全学期课程对象数', FIX_READER.courseCount === 64, `期望 64，实际 ${FIX_READER.courseCount}`)

  // A-5 第三个实现（Null）也必须能塞进 seam —— 证明接口真的可替换
  const N = new NullScheduleReader()
  const nr = N.read({ timezone: SH, from: W4_WED, to: W4_WED })
  check('A', 'Null reader 也是合法实现', nr.readerId === 'null' && nr.busySlots.length === 0 && nr.dropped === 0, JSON.stringify(nr))
}

// ═══ B. 五个操作端到端（换 Adapter 不换答案）═════════════════════════════════
function testOperations() {
  const OPS = [
    ['下一节什么课', '下一节是 10:00 的高等数学'],
    ['今天有什么课', `${W4_WED} 有 2 节课`],
    ['明天有什么课', '2026-10-01 有 1 节课'],
    ['今天下午有空吗', '空档'],
    ['今天有冲突吗', '没有发现冲突'],
    ['给我今天的简报', '今日简报'],
    ['给我明天的简报', '明日简报'],
  ]

  for (const [text, must] of OPS) {
    const outs = READERS.map((r) => {
      const A = new LocalRulesAdapter({ reader: r })
      return { r, res: A.ask({ text, timezone: SH, todos: TODO }, { requestId: 'req-p07', now: NOW }) }
    })
    // B-1 两个 Adapter 的答案必须一致（去掉「数据来源」那一行后逐字段相同）
    const strip = (res) => JSON.stringify({ ...res, explain: res.explain.filter((e) => !e.startsWith(PROVENANCE_PREFIX)) })
    check('B', `${text}：换 Adapter 不换答案`, strip(outs[0].res) === strip(outs[1].res),
      `\n      ${outs[0].r.id}: ${outs[0].res.answer}\n      ${outs[1].r.id}: ${outs[1].res.answer}`)

    for (const { r, res } of outs) {
      // B-2 答案要点
      check('B', `${text}：答案要点`, res.answer.includes(must), `答案「${res.answer}」不含「${must}」`)
      // B-3 来源恒为本机规则，且绝不出现 llm_fallback
      check('B', `${text}：source`, res.source === 'local_rule', `实际 ${res.source}`)
      // B-4 数据来源行如实标出是哪个读取器
      const prov = res.explain.filter((e) => e.startsWith(PROVENANCE_PREFIX))
      check('B', `${text}：数据来源行`, prov.length === 1 && prov[0].includes(r.id), `provenance=` + JSON.stringify(prov))
      // B-5 结构完整性
      check('B', `${text}：响应字段`, Object.keys(res).sort().join(',') === 'answer,cards,explain,offlineCapable,requestId,source', Object.keys(res).sort().join(','))
      check('B', `${text}：requestId 回传`, res.requestId === 'req-p07', res.requestId)
    }
  }

  // B-6 五个操作统一走 ActionCard，且卡片类型/操作都不许越出契约枚举
  const TYPES = ['note_draft', 'schedule_hint', 'conflict_hint', 'brief_item']
  const OPS_ENUM = ['none', 'note.create', 'open.schedule']
  const A = new LocalRulesAdapter({ reader: FIX_READER })
  const seenTypes = new Set()
  for (const [text] of OPS) {
    for (const c of A.ask({ text, timezone: SH, todos: TODO }, { requestId: 'x', now: NOW }).cards) {
      seenTypes.add(c.type)
      check('B', `${text}：卡片类型在枚举内`, TYPES.includes(c.type), String(c.type))
      check('B', `${text}：卡片 operation 在枚举内`, OPS_ENUM.includes(c.operation), String(c.operation))
      check('B', `${text}：卡片有 requiresConfirmation`, typeof c.requiresConfirmation === 'boolean', String(c.requiresConfirmation))
    }
  }
  // 课表查询与待办必须走**同一种**卡片，而不是每个问法一个新接口
  check('B', '课表类问法产出 schedule_hint', seenTypes.has('schedule_hint'), [...seenTypes].join(','))
  check('B', '待办并入 brief_item', seenTypes.has('brief_item'), [...seenTypes].join(','))
  check('B', '没有为问法发明新卡片类型', [...seenTypes].every((t) => TYPES.includes(t)), [...seenTypes].join(','))

  // B-7 记事行动卡：必须要求确认（写入路径不得绕过确认）
  const note = new LocalRulesAdapter({ reader: FIX_READER })
    .ask({ text: '今晚 8 点交高数作业', timezone: SH, todos: TODO }, { requestId: 'x', now: NOW })
  check('B', '记事卡要求确认', note.cards[0]?.requiresConfirmation === true, JSON.stringify(note.cards[0]))
  check('B', '记事卡带 noteDraft', !!note.cards[0]?.noteDraft, JSON.stringify(note.cards[0]))
}

// ═══ C. 跨周与节次 ══════════════════════════════════════════════════════════
function testWeeksAndPeriods() {
  // C-1..C-3 周次表达式
  check('C', 'parseWeeks 1-16', JSON.stringify(parseWeeks('1-16', 'all')) === JSON.stringify(Array.from({ length: 16 }, (_, i) => i + 1)), JSON.stringify(parseWeeks('1-16', 'all')))
  check('C', 'parseWeeks 单周', JSON.stringify(parseWeeks('1-16', 'odd')) === JSON.stringify([1, 3, 5, 7, 9, 11, 13, 15]), JSON.stringify(parseWeeks('1-16', 'odd')))
  check('C', 'parseWeeks 双周', JSON.stringify(parseWeeks('1-16', 'even')) === JSON.stringify([2, 4, 6, 8, 10, 12, 14, 16]), JSON.stringify(parseWeeks('1-16', 'even')))
  check('C', 'parseWeeks 多段', JSON.stringify(parseWeeks('1-8,10-16', 'all')).includes('9') === false, JSON.stringify(parseWeeks('1-8,10-16', 'all')))
  check('C', 'parseWeeks 多段条数', parseWeeks('1-8,10-16', 'all').length === 15, String(parseWeeks('1-8,10-16', 'all').length))
  // C-4 反序区间 → 空 → 整行丢弃
  check('C', 'parseWeeks 反序区间为空', parseWeeks('16-1', 'all').length === 0, JSON.stringify(parseWeeks('16-1', 'all')))
  // C-5 越界周次（>30）一律丢
  check('C', 'parseWeeks 越界丢弃', parseWeeks('1-40', 'all').every((w) => w <= 30) && parseWeeks('1-40', 'all').length === 30, String(parseWeeks('1-40', 'all').length))
  check('C', 'parseWeeks 非法表达式', parseWeeks('abc', 'all').length === 0, JSON.stringify(parseWeeks('abc', 'all')))

  // C-6..C-8 节次表映射
  const table = new Map(FIXTURE.periods.map((p) => [p.period, p]))
  check('C', '节次 3-4 → 10:00-11:40', JSON.stringify(periodSpan([3, 4], table)) === JSON.stringify({ start: '10:00', end: '11:40', label: '第3-4节' }), JSON.stringify(periodSpan([3, 4], table)))
  check('C', '单节次标签', periodSpan([5], table)?.label === '第5节', JSON.stringify(periodSpan([5], table)))
  check('C', '节次乱序仍取最小/最大', JSON.stringify(periodSpan([4, 3], table)) === JSON.stringify(periodSpan([3, 4], table)), '节次排序不正确')
  check('C', '节次不在表中 → null', periodSpan([99], table) === null, JSON.stringify(periodSpan([99], table)))
  check('C', '空节次 → null', periodSpan([], table) === null, JSON.stringify(periodSpan([], table)))

  // C-9 mondayOf：任意日 → 本周一
  check('C', 'mondayOf 周三→本周一', mondayOf(W4_WED) === '2026-09-28', String(mondayOf(W4_WED)))
  check('C', 'mondayOf 周一→自身', mondayOf(TERM) === TERM, String(mondayOf(TERM)))
  check('C', 'mondayOf 不可解析', mondayOf('不是日期') === null, String(mondayOf('不是日期')))
  check('C', 'mondayOf 拒绝非补零', mondayOf('2026-9-7') === null, String(mondayOf('2026-9-7')))

  // C-10 termStart 传非周一 → 回退到该周周一，周次仍以周一对齐
  const shifted = new FixtureScheduleReader({ ...FIXTURE, termStart: '2026-09-09' }) // 周三
  const sameWindow = { timezone: SH, from: TERM, to: TERM_END }
  check('C', 'termStart 非周一自动回退到周一',
    JSON.stringify(shifted.read(sameWindow).busySlots) === JSON.stringify(FIX_READER.read(sameWindow).busySlots),
    '回退后展开结果与周一 termStart 不同')

  // C-11 单双周决定性：同一 weekday，相邻两周只有一周有课
  const w3mon = FIX_READER.read({ timezone: SH, from: '2026-09-21', to: '2026-09-21' }) // 第 3 周周一（单周）
  const w4mon = FIX_READER.read({ timezone: SH, from: '2026-09-28', to: '2026-09-28' }) // 第 4 周周一（双周）
  check('C', '单周周一有课', w3mon.busySlots.length === 1 && w3mon.busySlots[0].title === '数据结构', JSON.stringify(w3mon.busySlots))
  check('C', '双周周一无课', w4mon.busySlots.length === 0, JSON.stringify(w4mon.busySlots))

  // C-12 跨周窗口（周日 → 周一）不漏不重
  const cross = FIX_READER.read({ timezone: SH, from: '2026-09-20', to: '2026-09-21' })
  check('C', '跨周窗口命中周一', cross.busySlots.length === 1 && cross.busySlots[0].startAt.startsWith('2026-09-21'), JSON.stringify(cross.busySlots))
  const crossNeg = FIX_READER.read({ timezone: SH, from: '2026-09-27', to: '2026-09-28' })
  check('C', '跨周窗口（双周）无课', crossNeg.busySlots.length === 0, JSON.stringify(crossNeg.busySlots))

  // C-13 展开结果与独立 oracle 一致（core 的展开器不能自证）
  const oracle = new StandardCourseReader(oracleCourses(FIXTURE)).read({ timezone: SH, from: TERM, to: TERM_END })
  check('C', '展开与独立 oracle 一致', JSON.stringify(oracle.busySlots) === JSON.stringify(FIX_READER.read({ timezone: SH, from: TERM, to: TERM_END }).busySlots), 'fixture 展开与测试自带 oracle 不一致')
}

// ═══ D. 空 / 无课日 / 非法输入 ═══════════════════════════════════════════════
function testEmptyAndInvalid() {
  const P = [
    { period: 1, start: '08:00', end: '09:00' },
    { period: 2, start: '09:00', end: '10:00' },
    { period: 3, start: '11:00', end: '12:00' },
  ]
  const base = { termStart: TERM, periods: P }
  const q = { timezone: SH, from: '2026-09-09', to: '2026-09-09' } // 第 1 周周三

  // D-1 空课表：五个操作都成句，不抛异常
  const emptyReader = new FixtureScheduleReader({ ...base, rows: [] })
  const A = new LocalRulesAdapter({ reader: emptyReader })
  for (const text of ['下一节什么课', '今天有什么课', '今天下午有空吗', '今天有冲突吗', '给我今天的简报']) {
    let res = null
    try { res = A.ask({ text, timezone: SH, todos: [] }, { requestId: 'r', now: NOW }) } catch (e) { fail('D', `${text} 空课表`, `抛异常：${e.message}`); continue }
    check('D', `${text} 空课表成句`, typeof res.answer === 'string' && res.answer.length > 0, res.answer)
    check('D', `${text} 空课表 source`, res.source === 'local_rule', res.source)
  }
  check('D', '空课表读取为空数组', emptyReader.read(q).busySlots.length === 0, '空课表读出了内容')
  check('D', '空课表 dropped 为 0', emptyReader.read(q).dropped === 0, String(emptyReader.read(q).dropped))

  // D-2 无课日（周末）→ 空数组而不是错误
  const fri = new FixtureScheduleReader({ ...base, rows: [{ courseName: '大学英语', weekday: 5, periods: [1], weeks: '1-16' }] })
  const sat = fri.read({ timezone: SH, from: '2026-09-12', to: '2026-09-12' })
  check('D', '无课日返回空数组', Array.isArray(sat.busySlots) && sat.busySlots.length === 0, JSON.stringify(sat))
  check('D', '有课日对照非空', fri.read({ timezone: SH, from: '2026-09-11', to: '2026-09-11' }).busySlots.length === 1, '对照组失效')

  // D-3 节次不在表中 → 丢该行并计数
  const bad1 = new FixtureScheduleReader({ ...base, rows: [{ courseName: 'X', weekday: 3, periods: [99], weeks: '1-16' }] })
  check('D', '节次缺失 → 丢弃计数', bad1.read({ timezone: SH, from: TERM, to: TERM_END }).dropped === 1, String(bad1.read({ timezone: SH, from: TERM, to: TERM_END }).dropped))
  check('D', '节次缺失 → 不产出', bad1.read({ timezone: SH, from: TERM, to: TERM_END }).busySlots.length === 0, '不该有内容')

  // D-4 反序时段（end < start）→ 丢，绝不产出违反 endAt>startAt 的段
  const bad2 = new FixtureScheduleReader({
    termStart: TERM,
    periods: [{ period: 1, start: '10:00', end: '09:00' }],
    rows: [{ courseName: 'X', weekday: 3, periods: [1], weeks: '1-16' }],
  })
  const b2 = bad2.read({ timezone: SH, from: TERM, to: TERM_END })
  check('D', '反序时段 → 丢弃', b2.busySlots.length === 0 && b2.dropped === 16, `${b2.busySlots.length} / ${b2.dropped}`)

  // D-5 越界 weekday → 丢
  const bad3 = new FixtureScheduleReader({ ...base, rows: [{ courseName: 'X', weekday: 8, periods: [1], weeks: '1-16' }] })
  check('D', 'weekday 越界 → 丢弃', bad3.read({ timezone: SH, from: TERM, to: TERM_END }).dropped === 1, String(bad3.read({ timezone: SH, from: TERM, to: TERM_END }).dropped))

  // D-6 termStart 不可解析 → 整份丢弃，不猜
  const bad4 = new FixtureScheduleReader({ ...base, termStart: '第1周周一开始', rows: [{ courseName: 'X', weekday: 3, periods: [1], weeks: '1-16' }] })
  const b4 = bad4.read({ timezone: SH, from: TERM, to: TERM_END })
  check('D', 'termStart 不可解析 → 全丢', b4.busySlots.length === 0 && b4.dropped === 1, JSON.stringify(b4))

  // D-7 不可解析窗口 → 空结果，不抛
  const badWin = FIX_READER.read({ timezone: SH, from: '明天', to: '明天' })
  check('D', '非法窗口 → 空结果', badWin.busySlots.length === 0 && badWin.dropped === 0, JSON.stringify(badWin))
  check('D', 'from > to → 空结果', FIX_READER.read({ timezone: SH, from: '2026-10-05', to: '2026-10-04' }).busySlots.length === 0, '未拒绝反序窗口')

  // D-8 重复行（同名同日同起止）→ 去重只算一次
  const dup = new FixtureScheduleReader({
    ...base,
    rows: [
      { courseName: '大学英语', weekday: 3, periods: [1], weeks: '1-16' },
      { courseName: '大学英语', weekday: 3, periods: [1], weeks: '1-8,9-16' }, // 周次重叠 → 展开出同样的日期
    ],
  })
  const dd = dup.read({ timezone: SH, from: '2026-09-09', to: '2026-09-09' })
  check('D', '重复行去重', dd.busySlots.length === 1, JSON.stringify(dd.busySlots))

  // D-9 不同课程落在同一时段 → **都保留**（那是真实冲突，不是重复）
  const clash = new FixtureScheduleReader({
    ...base,
    rows: [
      { courseName: '高等数学', weekday: 3, periods: [1, 2], weeks: '1-16' }, // 08:00-10:00
      { courseName: '选修课', weekday: 3, periods: [2], weeks: '1-16' },     // 09:00-10:00
    ],
  })
  const cl = clash.read({ timezone: SH, from: '2026-09-09', to: '2026-09-09' })
  check('D', '同时段不同课都保留', cl.busySlots.length === 2, JSON.stringify(cl.busySlots))
  check('D', '冲突被 handleConflict 认出', (() => {
    const res = new LocalRulesAdapter({ reader: clash }).ask({ text: '今天有冲突吗', timezone: SH }, { requestId: 'r', now: new Date('2026-09-09T07:00:00+08:00') })
    return res.cards.some((c) => c.type === 'conflict_hint')
  })(), '未识别出重叠')

  // D-10 相邻时段（首尾相接）不算冲突，也不产生零长度空档
  const adj = new FixtureScheduleReader({
    ...base,
    rows: [
      { courseName: 'A', weekday: 3, periods: [1], weeks: '1-16' }, // 08:00-09:00
      { courseName: 'B', weekday: 3, periods: [2], weeks: '1-16' }, // 09:00-10:00
      { courseName: 'C', weekday: 3, periods: [3], weeks: '1-16' }, // 11:00-12:00
    ],
  })
  const adjRes = new LocalRulesAdapter({ reader: adj }).ask({ text: '今天有冲突吗', timezone: SH }, { requestId: 'r', now: new Date('2026-09-09T07:00:00+08:00') })
  check('D', '相邻时段不算冲突', !adjRes.cards.some((c) => c.type === 'conflict_hint'), adjRes.answer)
  const availRes = new LocalRulesAdapter({ reader: adj }).ask({ text: '今天上午有空吗', timezone: SH }, { requestId: 'r', now: new Date('2026-09-09T07:00:00+08:00') })
  check('D', '相接处不产生零长度空档', !/09:00-09:00/.test(availRes.answer), availRes.answer)
}

// ═══ E. 时区与区间边界 ══════════════════════════════════════════════════════
function testTimezone() {
  const qSH = { timezone: SH, from: W4_WED, to: W4_WED }
  const qNY = { timezone: NY, scheduleTimezone: SH, from: W4_WED, to: W4_WED }
  const a = FIX_READER.read(qSH)
  const b = FIX_READER.read(qNY)

  // E-1 同一份课表，用纽约日窗口查 09-30：只应命中**纽约当地 09-30** 那一段。
  //     高等数学 09-30 10:00+08 = 09-29 22:00-04 → 不在；大学物理 14:00+08 = 09-30 02:00-04 → 在。
  check('E', '跨时区窗口条数', b.busySlots.length === 2, `期望 2，实际 ${b.busySlots.length}：${JSON.stringify(b.busySlots.map((s) => s.title))}`)
  check('E', '跨时区窗口排除了上海当日早段', !b.busySlots.some((s) => s.title === '高等数学'), JSON.stringify(b.busySlots.map((s) => s.title)))
  check('E', '跨时区窗口保留了纽约当日课', b.busySlots.some((s) => s.title === '线性代数'), JSON.stringify(b.busySlots.map((s) => s.title)))
  // E-2 课表时刻锚在**学校时区**：同一节课无论从哪个时区查，都是同一瞬间、同一种渲染
  const sh = a.busySlots.find((s) => s.title === '大学物理')
  const ny = b.busySlots.find((s) => s.title === '大学物理')
  check('E', '同一节课是同一瞬间', Date.parse(sh.startAt) === Date.parse(ny.startAt), `${sh.startAt} vs ${ny.startAt}`)
  check('E', '课表时刻按学校时区渲染', sh.startAt === ny.startAt, `${sh.startAt} vs ${ny.startAt}`)
  check('E', '渲染带上了学校时区偏移', sh.startAt.endsWith('+08:00'), sh.startAt)

  // E-2b 为什么必须有 scheduleTimezone：漏声明时会把课表的"14:00"当成纽约的 14:00，
  //      瞬间整体偏 12 小时——这正是「不提这个字段就错一整天」的实证。
  const misdeclared = FIX_READER.read({ timezone: NY, from: W4_WED, to: W4_WED })
  const wrong = misdeclared.busySlots.find((s) => s.title === '大学物理')
  check('E', '漏声明课表时区 → 瞬间偏移', !!wrong && Date.parse(wrong.startAt) !== Date.parse(sh.startAt),
    `两种读法给出了同一瞬间：${sh.startAt}`)
  check('E', '漏声明时区后偏移量为 12 小时', !!wrong && Math.abs(Date.parse(wrong.startAt) - Date.parse(sh.startAt)) === 12 * 3600 * 1000,
    String(wrong && (Date.parse(wrong.startAt) - Date.parse(sh.startAt)) / 3600000))

  // E-3 §4.7 用例④：23:00 问「明天」
  const late = new Date('2026-09-30T23:00:00+08:00')
  const lateRes = new LocalRulesAdapter({ reader: FIX_READER }).ask({ text: '明天有什么课', timezone: SH }, { requestId: 'r', now: late })
  check('E', '23:00 问明天取次日', lateRes.answer.includes('2026-10-01') && lateRes.answer.includes('线性代数'), lateRes.answer)
  check('E', '23:00 问明天窗口为次日', lateRes.explain.some((e) => e.includes('2026-10-01..2026-10-01')), JSON.stringify(lateRes.explain))

  // E-4 时区决定「今天」是哪天：同一时刻，纽约的今天比上海早一天
  const night = new Date('2026-09-29T21:30:00-04:00') // = 09-30 09:30 +08
  const nyToday = new LocalRulesAdapter({ reader: FIX_READER, scheduleTimezone: SH }).ask({ text: '今天有什么课', timezone: NY }, { requestId: 'r', now: night })
  const shToday = new LocalRulesAdapter({ reader: FIX_READER }).ask({ text: '今天有什么课', timezone: SH }, { requestId: 'r', now: night })
  check('E', '同一瞬间两国「今天」不同', nyToday.answer !== shToday.answer, `两边都答了：${shToday.answer}`)
  check('E', '纽约的今天 = 09-29', nyToday.explain.some((e) => e.includes('窗口 2026-09-29..2026-09-29')), JSON.stringify(nyToday.explain))
  check('E', '上海的今天 = 09-30', shToday.explain.some((e) => e.includes('窗口 2026-09-30..2026-09-30')), JSON.stringify(shToday.explain))

  // E-5 同时区时不应出现「课表时区」那句噪音
  check('E', '同时区不写课表时区', !shToday.explain.some((e) => e.includes('课表时区')), JSON.stringify(shToday.explain))

  // E-6 窗口边界：窗口正好覆盖某节课的整段 → 命中；缩到课程开始之前 → 不命中
  const before = FIX_READER.read({ timezone: SH, from: '2026-09-29', to: '2026-09-29' })
  check('E', '前一日窗口不含次日课', before.busySlots.length === 0, JSON.stringify(before.busySlots))

  // E-7 queryWindowFor 的窗口选择
  check('E', 'next_class 窗口为未来 7 天', JSON.stringify(queryWindowFor('next_class', SH, NOW, null)) === JSON.stringify({ from: W4_WED, to: '2026-10-07' }), JSON.stringify(queryWindowFor('next_class', SH, NOW, null)))
  check('E', 'note_draft 不读课表', queryWindowFor('note_draft', SH, NOW, null) === null, String(queryWindowFor('note_draft', SH, NOW, null)))
  check('E', 'availability 用解析出的日期', JSON.stringify(queryWindowFor('availability', SH, NOW, '2026-10-05')) === JSON.stringify({ from: '2026-10-05', to: '2026-10-05' }), JSON.stringify(queryWindowFor('availability', SH, NOW, '2026-10-05')))
}

// ═══ F. P-01 / P-02 默认规则 ═════════════════════════════════════════════════
function testDefaultRules() {
  const A = new LocalRulesAdapter({ reader: FIX_READER })

  // F-1 P-01：今天周四（10-01）说「本周三」→ 周三已过 → 取未来最近的那个（10-07）
  const thu = new Date('2026-10-01T09:00:00+08:00')
  const p1 = A.ask({ text: '本周三下午有空吗', timezone: SH }, { requestId: 'r', now: thu })
  check('F', 'P-01 取未来最近的周三', p1.explain.some((e) => e.includes('2026-10-07')), JSON.stringify(p1.explain))
  check('F', 'P-01 依据写进 explain', p1.explain.some((e) => e.includes('P-01')), JSON.stringify(p1.explain))
  check('F', 'P-01 窗口为 10-07', p1.explain.some((e) => e.includes('窗口 2026-10-07..2026-10-07')), JSON.stringify(p1.explain))

  // F-1b 未过时不应提 P-01（避免"总是取下一个"的误读）
  const mon = new Date('2026-09-28T09:00:00+08:00') // 第 4 周周一
  const p1b = A.ask({ text: '本周三下午有空吗', timezone: SH }, { requestId: 'r', now: mon })
  check('F', 'P-01 未过时不提 P-01', !p1b.explain.some((e) => e.includes('P-01')), JSON.stringify(p1b.explain))
  check('F', 'P-01 未过时取本周三', p1b.explain.some((e) => e.includes('窗口 2026-09-30..2026-09-30')), JSON.stringify(p1b.explain))

  // F-2 P-02：只说「9月25日」且今年已过 → 仍取今年，不跨年猜测
  const p2 = A.ask({ text: '9月25日有什么课', timezone: SH }, { requestId: 'r', now: thu })
  check('F', 'P-02 取今年', p2.explain.some((e) => e.includes('2026-09-25')), JSON.stringify(p2.explain))
  check('F', 'P-02 依据写进 explain', p2.explain.some((e) => e.includes('P-02')), JSON.stringify(p2.explain))

  // F-3 明天：依据必须点明"按客户端时区推算"
  const t = A.ask({ text: '明天有什么课', timezone: SH }, { requestId: 'r', now: NOW })
  check('F', '明天的依据点明客户端时区', t.explain.some((e) => e.includes('按客户端时区推算')), JSON.stringify(t.explain))

  // F-4 日期敏感的回答都必须带「日期依据：」这一行
  for (const text of ['今天有什么课', '明天有什么课', '本周三下午有空吗', '给我今天的简报', '9月25日有什么课']) {
    const res = A.ask({ text, timezone: SH, todos: TODO }, { requestId: 'r', now: NOW })
    check('F', `${text}：带日期依据`, res.explain.some((e) => e.startsWith('日期依据：')), JSON.stringify(res.explain))
  }
}

// ═══ I. 本周课程统计（OQ-11 裁决的落实，P07.1）═══════════════════════════════
//
// 口径来自产品负责人裁决，逐条断言：
//   · 窗口 = **使用者时区**本周一 00:00 → 周日 23:59
//   · 单位 = **连续上课时段**（重叠或首尾相接合并）；不按 periodLabel 拆、不按课程名去重
//   · 不读待办、不联网、不调用模型
function testWeekPlan() {
  const P = [
    { period: 1, start: '08:00', end: '09:00' },
    { period: 2, start: '09:00', end: '10:00' }, // 与上节首尾相接
    { period: 3, start: '10:10', end: '11:00' }, // 与上节有 10 分钟课间 → 不该合并
  ]
  const mk = (rows) => new LocalRulesAdapter({ reader: new FixtureScheduleReader({ termStart: TERM, periods: P, rows }) })
  const week = (adapter, now = NOW, todos = TODO) => adapter.ask({ text: '这周有几节课', timezone: SH, todos }, { requestId: 'req-w', now })

  // I-1 普通一周：主 fixture 第 4 周（09-28 周一 .. 10-04 周日）
  //     高等数学(周三) + 大学物理(周三) + 线性代数(周四) + 大学英语(周五，双周)
  //     数据结构是周一单周 → 第 4 周是双周，**不该出现**
  const plain = week(new LocalRulesAdapter({ reader: FIX_READER }))
  check('I', '普通一周计数', plain.answer === '本周共有 4 次课程安排。', plain.answer)
  check('I', '计数不被"几节"拆开', !/9 次|8 次|6 次/.test(plain.answer), 'periodLabel 被拆成多节了')

  // I-2 explain 必须说明统计口径与窗口（裁决明文要求）
  check('I', 'explain 说明连续时段口径', plain.explain.some((e) => e.includes('连续上课时段')), JSON.stringify(plain.explain))
  check('I', 'explain 给出周窗口', plain.explain.some((e) => e.includes('2026-09-28..2026-10-04')), JSON.stringify(plain.explain))
  check('I', 'explain 说明按使用者时区', plain.explain.some((e) => e.includes('使用者时区 Asia/Shanghai')), JSON.stringify(plain.explain))
  check('I', 'explain 给出原始段数对照', plain.explain.some((e) => e.includes('原始 4 段，合并后 4 次')), JSON.stringify(plain.explain))

  // I-3 ActionCard 统一：本周统计走 brief_item，不为它发明新卡片类型
  check('I', '产出 brief_item 卡片', plain.cards.length === 4 && plain.cards.every((c) => c.type === 'brief_item' && c.operation === 'none'), JSON.stringify(plain.cards.map((c) => c.type)))

  // I-4 空课表：必须明确说"没有"，不能返回一个像答案的 0
  const empty = week(mk([]))
  check('I', '空课表明确回答', empty.answer === '本周没有课程安排。', empty.answer)
  check('I', '空课表无卡片', empty.cards.length === 0, JSON.stringify(empty.cards))

  // I-5 去重：同一时段写了两遍只算一次。
  //     5a 走 handler（直接喂 context）——统计口径必须在**没有 reader 帮忙去重**时也成立
  const dupWeek = ask(
    { text: '这周有几节课', now: NOW.toISOString(), timezone: SH, context: { schedule: [
      { startAt: `${W4_WED}T14:00:00+08:00`, endAt: `${W4_WED}T15:40:00+08:00`, title: '大学物理' },
      { startAt: `${W4_WED}T14:00:00+08:00`, endAt: `${W4_WED}T15:40:00+08:00`, title: '大学物理' },
    ] } },
    { requestId: 'req-w', now: NOW },
  )
  check('I', '重复时段去重（handler 层）', dupWeek.answer === '本周共有 1 次课程安排。', dupWeek.answer)
  //     5b 走完整链路
  const dupAdapter = mk([
    { courseName: '大学物理', weekday: 3, periods: [1], weeks: '4' },
    { courseName: '大学物理', weekday: 3, periods: [1], weeks: '4' },
  ])
  check('I', '重复行去重（链路层）', week(dupAdapter).answer === '本周共有 1 次课程安排。', week(dupAdapter).answer)

  // I-6 同名课程的不同时段**各算一次**——不按课程名去重
  const sameName = mk([
    { courseName: '高等数学', weekday: 1, periods: [1], weeks: '4' },
    { courseName: '高等数学', weekday: 2, periods: [1], weeks: '4' },
  ])
  check('I', '同名不同时段各计一次', week(sameName).answer === '本周共有 2 次课程安排。', week(sameName).answer)

  // I-7 连续时段：首尾相接合并成 1 次；有 10 分钟课间的**不**合并
  const touching = mk([
    { courseName: '大学英语', weekday: 1, periods: [1], weeks: '4' }, // 08:00-09:00
    { courseName: '体育', weekday: 1, periods: [2], weeks: '4' },     // 09:00-10:00 ← 首尾相接
    { courseName: '选修课', weekday: 1, periods: [3], weeks: '4' },   // 10:10-11:00 ← 有课间
  ])
  const t = week(touching)
  check('I', '首尾相接合并、有课间不合并', t.answer === '本周共有 2 次课程安排。', t.answer)
  check('I', '合并后原始段数如实写出', t.explain.some((e) => e.includes('原始 3 段，合并后 2 次')), JSON.stringify(t.explain))

  // I-8 跨周边界：上周日与下周周一都**不**计入本周
  const across = mk([
    { courseName: '上周的课', weekday: 7, periods: [1], weeks: '3' }, // 09-27 周日（上一周）
    { courseName: '本周的课', weekday: 3, periods: [1], weeks: '4' }, // 09-30 周三 ✓
    { courseName: '下周的课', weekday: 1, periods: [1], weeks: '5' }, // 10-05 周一（下一周）
  ])
  check('I', '跨周边界', week(across).answer === '本周共有 1 次课程安排。', week(across).answer)

  // I-9 使用者时区 ≠ 学校时区：窗口按使用者那一周算
  //     同一瞬间，上海是 09-30 周三、纽约是 09-29 周二 → 两边的"本周"不是同一段绝对时间
  const night = new Date('2026-09-29T21:30:00-04:00') // = 09-30 09:30 +08
  const shWeek = new LocalRulesAdapter({ reader: FIX_READER, scheduleTimezone: SH })
    .ask({ text: '这周有几节课', timezone: SH, todos: [] }, { requestId: 'req-w', now: night })
  const nyWeek = new LocalRulesAdapter({ reader: FIX_READER, scheduleTimezone: SH })
    .ask({ text: '这周有几节课', timezone: NY, todos: [] }, { requestId: 'req-w', now: night })
  check('I', '上海本周 = 4 次', shWeek.answer === '本周共有 4 次课程安排。', shWeek.answer)
  // 纽约那一周（09-28 00:00-04:00 .. 10-04 23:59-04:00）= 上海 09-28 12:00 .. 10-05 11:59，
  // 比上海那周多含周一 10-05 的数据结构（单周），因此是 5 次
  check('I', '纽约本周 = 5 次（多含落到当地周日的课）', nyWeek.answer === '本周共有 5 次课程安排。', nyWeek.answer)
  check('I', '两地本周窗口不同', shWeek.explain.some((e) => e.includes('2026-09-28..2026-10-04')) && nyWeek.explain.some((e) => e.includes('2026-09-28..2026-10-04')), '窗口字面相同但时刻不同——见下一条')
  check('I', '两地窗口指向不同绝对时刻', shWeek.explain.some((e) => e.includes('按使用者时区 Asia/Shanghai')) && nyWeek.explain.some((e) => e.includes('按使用者时区 America/New_York')), JSON.stringify(nyWeek.explain))
  check('I', '跨时区时 explain 标出课表时区', nyWeek.explain.some((e) => e.includes('课表时区 Asia/Shanghai')), JSON.stringify(nyWeek.explain))

  // I-10 不读待办：给不给待办，结论必须一样，且 explain 不提待办
  const withTodos = week(mk([{ courseName: '大学英语', weekday: 3, periods: [1], weeks: '4' }]), NOW, TODO)
  const noTodos = week(mk([{ courseName: '大学英语', weekday: 3, periods: [1], weeks: '4' }]), NOW, [])
  check('I', '不读待办', withTodos.answer === noTodos.answer && withTodos.answer === '本周共有 1 次课程安排。', `${withTodos.answer} / ${noTodos.answer}`)
  check('I', 'explain 不提待办', !withTodos.explain.join(' ').includes('待办'), JSON.stringify(withTodos.explain))

  // I-11 不得用「今日安排」冒充周范围：同一时刻、同一份课表，两者的数字必须不同
  const A = new LocalRulesAdapter({ reader: FIX_READER })
  const todayAns = A.ask({ text: '今天有什么课', timezone: SH, todos: [] }, { requestId: 'req-w', now: NOW }).answer
  check('I', '周范围没被今日安排冒充', plain.answer !== todayAns && !todayAns.includes('本周'), `${plain.answer} vs ${todayAns}`)

  // I-12 llmUsed === false 的等价断言 + 连续 20 次一致
  check('I', 'source 恒为 local_rule', plain.source === 'local_rule', plain.source)
  const first = JSON.stringify(week(new LocalRulesAdapter({ reader: FIX_READER })))
  let same = true
  for (let i = 0; i < 19; i++) if (JSON.stringify(week(new LocalRulesAdapter({ reader: FIX_READER }))) !== first) { same = false; break }
  check('I', '连续 20 次结果一致', same, '周统计不确定')

  // I-13 不扩胶囊：周统计完全在本机完成，不需要任何远端上下文
  check('I', '周统计不产出数据胶囊', buildCapsule({ capability: 'week_plan', context: CONTEXTS_FOR_CAPSULE, timezone: SH, now: NOW }) === null, 'week_plan 竟产出了胶囊——那会让远端也需要周窗口')

  // I-14 两个真实 Adapter 的统计结果必须一致（换数据源不换答案）
  const std = new LocalRulesAdapter({ reader: STD_READER })
  const stdAns = week(std)
  const fixAns = week(new LocalRulesAdapter({ reader: FIX_READER }))
  check('I', '两个 Adapter 统计一致', stdAns.answer === fixAns.answer, `${stdAns.answer} vs ${fixAns.answer}`)
  check('I', '两个 Adapter 的卡片一致', JSON.stringify(stdAns.cards) === JSON.stringify(fixAns.cards), '卡片不一致')
}

// ═══ G. 零网络 / 拒绝路径零读取 ══════════════════════════════════════════════
function testNoNetwork() {
  // G-1 计数 reader：拒绝路径一次都不能读
  const spy = {
    id: 'spy',
    calls: 0,
    inner: FIX_READER,
    read(q) { this.calls++; return this.inner.read(q) },
  }
  const A = new LocalRulesAdapter({ reader: spy })
  // ① 既不该读课表、也不属于 E_UNSUPPORTED 的问法：闲聊与记事查询是**真回答**，
  //    但它们同样不需要课表——把它们和"不支持"混成一类就测不出东西。
  const ANSWERED_WITHOUT_READ = [
    ['你好', 'smalltalk'],
    ['我的待办有哪些', 'notes.query'],
  ]
  // ② 明确不支持的问法：必须走 E_UNSUPPORTED
  //    ★ `这周有几节课` 在 P07.1 已按 OQ-11 裁决移出这一类，改由 I 组测它的**新语义**。
  //      留在这里会变成一条假绿的断言（"它不读课表"在支持之后就是错的）。
  const UNSUPPORTED_CASES = [
    ['明天天气怎么样', 'weather.tomorrow'],
    ['今天多少度', 'weather.today'],
    ['二课还差多少分', 'records.summary'],
    ['改一下那条记事', 'notes.update'],
    ['删掉那个记事', 'notes.delete'],
    ['量子力学怎么复习', 'unsupported'],
  ]

  for (const [text, why] of [...ANSWERED_WITHOUT_READ, ...UNSUPPORTED_CASES]) {
    const before = spy.calls
    const res = A.ask({ text, timezone: SH, todos: TODO }, { requestId: 'r', now: NOW })
    check('G', `不读课表：${text}（${why}）`, spy.calls === before, `读取了 ${spy.calls - before} 次`)
    check('G', `无数据来源行：${text}`, !res.explain.some((e) => e.startsWith(PROVENANCE_PREFIX)), JSON.stringify(res.explain))
    check('G', `source 恒为本机规则：${text}`, res.source === 'local_rule', res.source)
    check('G', `不抛：${text}`, typeof res.answer === 'string' && res.answer.length > 0, res.answer)
    check('G', `无写入卡：${text}`, !res.cards.some((c) => c.operation === 'note.create'), JSON.stringify(res.cards))
  }

  // G-2 确实走 E_UNSUPPORTED（不是被误判成别的能力）
  for (const [text] of UNSUPPORTED_CASES) {
    const res = A.ask({ text, timezone: SH, todos: TODO }, { requestId: 'r', now: NOW })
    const isUnsupported = res.explain.some((e) => /不覆盖|没识别出|没有对应的本机能力/.test(e))
    check('G', `确为 E_UNSUPPORTED：${text}`, isUnsupported, JSON.stringify(res.explain))
  }
  // G-2b 对照组：闲聊与记事查询**不该**被判成不支持，否则上面的断言可能只是"全都拒了"
  for (const [text] of ANSWERED_WITHOUT_READ) {
    const res = A.ask({ text, timezone: SH, todos: TODO }, { requestId: 'r', now: NOW })
    const isUnsupported = res.explain.some((e) => /不覆盖|没识别出|没有对应的本机能力/.test(e))
    check('G', `不该判成不支持：${text}`, !isUnsupported, JSON.stringify(res.explain))
  }

  // G-3 天气/二课不得出现在"已支持"文案里
  const greet = A.ask({ text: '你能干什么', timezone: SH }, { requestId: 'r', now: NOW })
  for (const leak of ['天气', '二课', '第二课堂', '多少度', '签到']) {
    check('G', `能力清单不含「${leak}」`, !greet.answer.includes(leak), greet.answer)
  }
  const unsup = A.ask({ text: '帮我签到好吗', timezone: SH }, { requestId: 'r', now: NOW })
  for (const leak of ['天气', '二课']) {
    check('G', `兜底文案不含「${leak}」`, !unsup.answer.includes(leak), unsup.answer)
  }

  // G-4 core/ 源码静态扫描：零网络、零环境变量、零原生依赖
  const CORE = ['uni-core.ts', 'types.ts', 'schedule-reader.ts', 'local-rules-adapter.ts']
  const BANNED = ['process.env', '$env', 'XMLHttpRequest', 'fetch(', 'require(', "from 'node:", 'from "node:', 'http://', 'https://', 'localStorage']
  for (const f of CORE) {
    const src = readFileSync(join(ROOT, 'core', f), 'utf8')
    for (const b of BANNED) {
      check('G', `core/${f} 不含 ${b}`, !src.includes(b), `源码里出现 ${b}`)
    }
  }

  // G-5 六个 Workflow 都不得含 LLM / HTTP / Redis / 数据库节点，且必须非激活
  const wfFiles = readdirSync(join(ROOT, 'workflows')).filter((f) => f.endsWith('.json'))
  check('G', 'workflow 数量 ≤ 6', wfFiles.length <= 6, String(wfFiles.length))
  const BANNED_NODE = ['@n8n/n8n-nodes-langchain', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.redis', 'n8n-nodes-base.postgres']
  for (const f of wfFiles) {
    const w = JSON.parse(readFileSync(join(ROOT, 'workflows', f), 'utf8'))
    for (const n of w.nodes) {
      for (const b of BANNED_NODE) {
        check('G', `${f}：不得含 ${b}`, !n.type.startsWith(b), `${n.name} = ${n.type}`)
      }
    }
    check('G', `${f}：active 必须为 false`, w.active === false, String(w.active))
  }
}

// ═══ H. n8n 侧行为等价 ═══════════════════════════════════════════════════════
function testWorkflowEquivalence() {
  const wf = JSON.parse(readFileSync(join(ROOT, 'workflows', 'schedule_query.json'), 'utf8'))
  const nodeJs = (name) => wf.nodes.find((n) => n.name === name)?.parameters?.jsCode
  const adapterJs = nodeJs('Schedule Adapter')
  const clampJs = nodeJs('Clamp Range')
  const resultJs = nodeJs('Build Result')

  check('H', 'schedule_query 有三个 Code 节点', !!(adapterJs && clampJs && resultJs), wf.nodes.map((n) => n.name).join(','))

  const runNode = (jsCode, input) => new Function('$input', jsCode)({ first: () => ({ json: input }) })[0].json

  // 剥掉行注释后再看"代码里有没有"：注释里写着"不读 $env"是**好实践**，
  // 不该被自己的扫描误伤；反过来，只扫代码才能说明"真的没实现"。
  const stripComments = (js) => js.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

  // H-1 【核心】行为等价：喂同一份 fixture，节点输出必须与 core 的 reader 逐字段相同
  const cases = [
    { timezone: SH, from: W4_WED, to: W4_WED },
    { timezone: SH, from: TERM, to: TERM_END },
    { timezone: SH, from: '2026-09-20', to: '2026-09-21' },
    { timezone: SH, from: '2026-09-27', to: '2026-09-28' },
    { timezone: NY, scheduleTimezone: SH, from: W4_WED, to: W4_WED },
    { timezone: SH, from: '2026-10-05', to: '2026-10-04' },
    { timezone: SH, from: '2026-09-12', to: '2026-09-12' },
    // P07.1：week_plan 的周一→周日窗口（7 个自然日）——新能力用的就是这个窗口
    { timezone: SH, from: '2026-09-28', to: '2026-10-04' },
    { timezone: NY, scheduleTimezone: SH, from: '2026-09-28', to: '2026-10-04' },
  ]
  for (const q of cases) {
    const mine = FIX_READER.read(q)
    const theirs = runNode(adapterJs, {
      requestId: 'r', timezone: q.timezone, scheduleTimezone: q.scheduleTimezone,
      termStart: FIXTURE.termStart, periods: FIXTURE.periods, rows: FIXTURE.rows,
      from: q.from, to: q.to,
    })
    check('H', `行为等价 ${JSON.stringify(q)}`,
      JSON.stringify(mine.busySlots) === JSON.stringify(theirs.busySlots) && mine.dropped === theirs.dropped,
      `\n      core : ${JSON.stringify(mine.busySlots)} (dropped ${mine.dropped})` +
      `\n      node : ${JSON.stringify(theirs.busySlots)} (dropped ${theirs.dropped})`)
  }

  // H-2 非法行在两侧也必须同样处理
  const badRows = [
    { courseName: 'X', weekday: 8, periods: [1], weeks: '1-16' },
    { courseName: 'Y', weekday: 3, periods: [99], weeks: '1-16' },
    { courseName: 'Z', weekday: 3, periods: [1], weeks: '16-1' },
    { courseName: '', weekday: 3, periods: [1], weeks: '1-16' },
  ]
  const badFx = { termStart: TERM, periods: [{ period: 1, start: '08:00', end: '09:00' }], rows: badRows }
  const mineBad = new FixtureScheduleReader(badFx).read({ timezone: SH, from: TERM, to: TERM_END })
  const theirsBad = runNode(adapterJs, { requestId: 'r', timezone: SH, termStart: TERM, periods: badFx.periods, rows: badRows, from: TERM, to: TERM_END })
  check('H', '非法行等价（含丢弃计数）', mineBad.busySlots.length === theirsBad.busySlots.length && mineBad.dropped === theirsBad.dropped,
    `core ${mineBad.busySlots.length}/${mineBad.dropped} vs node ${theirsBad.busySlots.length}/${theirsBad.dropped}`)

  // H-3 Clamp Range：日期范围上限 31 天（含端点），超出必须拒而不是截断
  const clamp = (input) => runNode(clampJs, input)
  check('H', 'Clamp 单日', clamp({ date: '2026-09-25' }).rangeError === null, String(clamp({ date: '2026-09-25' }).rangeError))
  // P07.1：week_plan 用的就是 7 天窗口，必须能过 Clamp（别让新能力被旧上限挡住）
  check('H', 'Clamp 放行周一→周日窗口', clamp({ dateRange: { from: '2026-09-28', to: '2026-10-04' } }).rangeError === null, String(clamp({ dateRange: { from: '2026-09-28', to: '2026-10-04' } }).rangeError))
  check('H', 'Clamp 恰好 31 天通过', clamp({ dateRange: { from: '2026-09-25', to: '2026-10-25' } }).rangeError === null, String(clamp({ dateRange: { from: '2026-09-25', to: '2026-10-25' } }).rangeError))
  check('H', 'Clamp 32 天被拒', !!clamp({ dateRange: { from: '2026-09-25', to: '2026-10-26' } }).rangeError, '超过 31 天却没被拒')
  check('H', 'Clamp date+dateRange 同给被拒', !!clamp({ date: '2026-09-25', dateRange: { from: '2026-09-25', to: '2026-09-26' } }).rangeError, '互斥字段没被拒')
  check('H', 'Clamp 两者都缺被拒', !!clamp({}).rangeError, '缺字段没被拒')
  check('H', 'Clamp to<from 被拒', !!clamp({ dateRange: { from: '2026-09-26', to: '2026-09-25' } }).rangeError, '反序范围没被拒')
  check('H', 'Clamp 不接收相对说法', !!clamp({ date: '明天' }).rangeError, '相对说法没被拒')
  check('H', 'Clamp 被拒时 Adapter 不产出', (() => {
    const out = runNode(adapterJs, { requestId: 'r', timezone: SH, rangeError: '日期范围超过 31 天', termStart: TERM, periods: FIXTURE.periods, rows: FIXTURE.rows, from: TERM, to: TERM_END })
    return out.busySlots.length === 0
  })(), '窗口非法时仍产出了课程')

  // H-4 Build Result：派生字段在 Adapter 侧算；且**仍然不**产出周统计计数。
  //     理由在 P07.1 变了（不再是"OQ-11 未裁决"），结论没变：口径只许存在一处。
  const built = runNode(resultJs, { requestId: 'r', from: W4_WED, to: W4_WED, busySlots: [{ startAt: `${W4_WED}T10:00:00+08:00`, endAt: `${W4_WED}T11:40:00+08:00`, title: '高等数学' }], dropped: 0 })
  check('H', 'Build Result 产出 firstStart', built.data.firstStart === `${W4_WED}T10:00:00+08:00`, JSON.stringify(built.data))
  check('H', 'Build Result 不含 coursesInTheWindow', !('coursesInTheWindow' in built.data), JSON.stringify(built.data))
  check('H', 'Build Result llmUsed=false', built.data ? built.llmUsed === false : false, String(built.llmUsed))
  check('H', 'Build Result 失败时给 E_SCHEMA', runNode(resultJs, { requestId: 'r', rangeError: 'x' }).errorCode === 'E_SCHEMA', 'errorCode 不正确')
  check('H', '周统计不在 Tool 侧重复实现的说明还在', resultJs.includes('OQ-11'), '缺少说明：将来有人会"顺手补上"第二个口径')
  check('H', '周统计口径只在本机一处', (() => {
    const coreSrc = readFileSync(join(ROOT, 'core', 'uni-core.ts'), 'utf8')
    // 只在**代码**里找，注释里提到 handleWeekPlan 是应该的（那是在说"口径不在这"）
    const toolCode = stripComments(resultJs)
    return coreSrc.includes('function handleWeekPlan') &&
      !toolCode.includes('handleWeekPlan') &&
      !toolCode.includes('coursesInTheWindow')
  })(), '周统计要么没实现，要么在 Tool 侧出现了第二份实现')

  // H-4b 路由：schedule.week 必须有自己的 Switch 分支，不能掉进 unsupported 兜底
  const router = JSON.parse(readFileSync(join(ROOT, 'workflows', 'agent_intent_router.json'), 'utf8'))
  const sw = router.nodes.find((n) => n.name === 'Route By Intent')
  const routedIntents = (sw?.parameters?.rules?.values ?? []).map((r) => r.conditions.conditions[0].rightValue)
  check('H', '路由含 schedule.week 分支', routedIntents.includes('schedule.week'), routedIntents.join(','))
  check('H', '路由不把不支持的意图交给 Tool', !routedIntents.some((i) => UNSUPPORTED_INTENTS.has(i)), routedIntents.filter((i) => UNSUPPORTED_INTENTS.has(i)).join(','))

  // H-5 节点类型白名单（schedule_query 只允许内置的触发器 + Code）
  const ALLOWED = new Set(['n8n-nodes-base.executeWorkflowTrigger', 'n8n-nodes-base.code'])
  for (const n of wf.nodes) {
    check('H', `节点类型白名单：${n.name}`, ALLOWED.has(n.type), n.type)
  }

  // H-6 节点 JS 不得读环境变量 / 发网络请求（用上面已剥离注释的同一把尺子）
  for (const [name, js] of [['Clamp Range', clampJs], ['Schedule Adapter', adapterJs], ['Build Result', resultJs]]) {
    const code = stripComments(js)
    for (const b of ['$env', 'process.env', 'fetch(', 'XMLHttpRequest', 'require(', 'http://', 'https://']) {
      check('H', `${name} 不含 ${b}`, !code.includes(b), `${name} 代码里出现 ${b}`)
    }
    // 但"不读环境变量"这条纪律必须在注释里写明——否则下一个人不知道该守什么
    check('H', `${name} 声明了不读环境变量`, /不读 \$env|不访问网络|不碰教务/.test(js), `${name} 缺少红线声明`)
  }

  // H-7 口径：H 组只证明"两份实现语义相同"，不证明"Workflow 跑通了"
  check('H', '文件里保留了未运行的口径声明', adapterJs.includes('沙箱') || readFileSync(join(ROOT, 'docs', 'open-questions.md'), 'utf8').includes('OQ-12'), 'OQ-12 的口径说明不见了')
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────
console.log('── ScheduleReader seam 测试（P07 / n6）───────────────')
testSeam()
testOperations()
testWeeksAndPeriods()
testEmptyAndInvalid()
testTimezone()
testDefaultRules()
testWeekPlan()
testNoNetwork()
testWorkflowEquivalence()

console.log(`通过 ${passed} 条，失败 ${failures.length} 条`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`  [${f.g}] ${f.id}\n      ${f.msg}`)
  process.exit(1)
}
console.log('全部通过 ✓')
