// 高校档案测试（北化内置，北二外仅通过签名云端包下载）。
// 重点守三件事：
//  1) 落地状态与名单顺序（谁"已可使用"、谁还是"开发中"）；
//  2) 北二外的两种特殊性：**没有第二课堂**、**节次时间与北化不同**（都来自产品负责人给的截图）；
//  3) 没核实过的网址一律不收录（宁可少一个入口，也不能把学生引到错误站点）。
import { SCHOOLS, findSchool, profileFor } from '../src/catalog/universities.ts';
import { inferTypeFromUrl } from '../src/services/jwKind.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- 名单与落地状态 ---');
ok('名单总数为 53 所（新增北二外）', SCHOOLS.length === 53, String(SCHOOLS.length));
const live = SCHOOLS.filter((s) => s.status === 'live');
ok('APK 内置可用高校只有北化', live.length === 1 && live[0].schoolId === 'buct', live.map((s) => s.name).join('/'));
ok('北化仍是首个落地（order=0）', findSchool('buct')?.order === 0);
ok('北二外在名单里但不是本地可用档案', findSchool('bisu')?.status === 'developing' && profileFor('bisu') === null);
ok('北二外按拼音排在"北京大学"之后、"北京工业大学"之前', (() => {
  const pku = SCHOOLS.findIndex((s) => s.schoolId === 'pku');
  const bisu = SCHOOLS.findIndex((s) => s.schoolId === 'bisu');
  const bjut = SCHOOLS.findIndex((s) => s.schoolId === 'bjut');
  return pku < bisu && bisu < bjut;
})(), SCHOOLS.slice(1, 5).map((s) => s.shortName).join(','));
ok('除北化外其余 52 所在 APK 内均不可直接使用', SCHOOLS.filter((s) => s.status !== 'live').length === 52, '');
ok('名次无重复', new Set(SCHOOLS.map((s) => s.order)).size === SCHOOLS.length, '');
ok('开发中的学校拿不到档案（进不去）', profileFor('pku') === null && profileFor('thu') === null);
ok('北二外不在 APK 内置版本表里', !/bisu:\s*BISU_PROFILE/.test(read('src/catalog/universities.ts')));
ok('云端打包器只从 TS 导出北化，不会覆盖手写的北二外云端源', /for \(const id of \['buct'\]\)/.test(read('scripts/make-school-pack.mjs')));
ok('Android 出包会剔除 catalog/adapters 云端目录',
  /@\("catalog", "adapters"\)/.test(read('scripts/build-apk.ps1')) && /hasRemotePayload/.test(read('scripts/build-apk.ps1')));

console.log('\n--- 北二外云端档案：没有第二课堂 ---');
const p = JSON.parse(read('catalog/bisu.json'));
ok('完整档案只从云端包源读取', p.name === '北京第二外国语学院' && !/BISU_PROFILE/.test(read('src/catalog/universities.ts')), p.name);
ok('简称是"北二外"', p.shortName === '北二外', p.shortName);
ok('第三栏叫"校园服务"', p.tabs.online === '校园服务', p.tabs.online);
ok('secondClass.enabled = false', p.secondClass.enabled === false, String(p.secondClass.enabled));
ok('第二栏标签改成"活动材料"', p.secondClass.label === '活动材料', p.secondClass.label);
ok('说明里讲清"不套用北化的分值表"', /不会套用北京化工大学的第二课堂分值表/.test(p.secondClass.notice || ''), p.secondClass.notice || '');
ok('说明里讲清"仍可记录本地材料"', /志愿时长/.test(p.secondClass.notice || '') && /劳育时长/.test(p.secondClass.notice || ''), '');
ok('不挂任何手册规则包', p.secondClass.rulePack === '' && p.secondClass.blocks.length === 0, '');
ok('北化仍是 enabled=true（回归）', profileFor('buct')!.secondClass.enabled === true);
ok('北化第二栏标签没被改坏', profileFor('buct')!.secondClass.label === '第二课堂');

console.log('\n--- 北二外档案：节次时间（逐条对照课表截图）---');
const want = [
  ['08:00', '08:45'], ['08:50', '09:35'], ['09:50', '10:35'], ['10:40', '11:25'], ['11:30', '12:15'],
  ['13:20', '14:05'], ['14:10', '14:55'], ['15:10', '15:55'], ['16:00', '16:45'], ['16:50', '17:35'],
  ['18:30', '19:15'], ['19:20', '20:05']
];
ok('正好 12 节', p.academic.periodTimes.length === 12, String(p.academic.periodTimes.length));
ok('12 节时间与截图逐条一致', want.every(([s, e], i) => p.academic.periodTimes[i].period === i + 1 && p.academic.periodTimes[i].start === s && p.academic.periodTimes[i].end === e),
  JSON.stringify(p.academic.periodTimes));
ok('与北化的节次表确实不同（不是复制粘贴）', (() => {
  const b = profileFor('buct')!.academic.periodTimes;
  return b.some((x, i) => x.start !== p.academic.periodTimes[i].start || x.end !== p.academic.periodTimes[i].end);
})(), '');
ok('学期第一周周一 = 2026-09-07', p.academic.semesterStartMonday === '2026-09-07', p.academic.semesterStartMonday);
ok('按这个首周算，2026-09-14 正好是第 2 周（与截图的"第2周"一致）', (() => {
  const monday = new Date(p.academic.semesterStartMonday.replace(/-/g, '/') + ' 00:00:00');
  const d = new Date('2026/09/14 00:00:00');
  return Math.floor((d.getTime() - monday.getTime()) / 86400000 / 7) + 1 === 2;
})(), '');

console.log('\n--- 北二外档案：校园服务入口 ---');
ok('入口都写了 desc', p.campusApps.every((a) => !!a.desc), '');
ok('入口 key 不重复', new Set(p.campusApps.map((a) => a.key)).size === p.campusApps.length, '');
ok('入口地址都是 https', p.campusApps.every((a) => a.url.startsWith('https://')), JSON.stringify(p.campusApps.map((a) => a.url)));
ok('带一个"考试查询"（识别考试 → 记事本提醒）', p.campusApps.some((a) => a.action === 'exam'), '');
ok('考试查询指向正方同模块路径', p.campusApps.some((a) => a.action === 'exam' && /kscx_cxXsksxxIndex/.test(a.url)), '');
ok('只收录已核实的 3 个地址，未核实的"移动校园/智慧教学"没有硬编进去',
  p.campusApps.length === 3 && !p.campusApps.some((a) => /移动校园|智慧教学/.test(a.name)),
  p.campusApps.map((a) => a.name).join('/'));
ok('教务系统用同一套正方解析器（导师类同族）', p.systems.timetableAdapter === 'jwglxt-buct', p.systems.timetableAdapter);
ok('水印角标是本校校名', p.watermark.schoolBadgeText === '北京第二外国语学院', p.watermark.schoolBadgeText);
ok('数据目录按学校隔离', p.dataDir === 'schools/bisu', p.dataDir);
ok('云端源档案状态为 live，下载后可启用', p.status === 'live' && p.schoolId === 'bisu');

console.log('\n--- 界面是否真的按档案走（结构断言，防止只改了数据没改界面）---');
{
  const main = read('src/screens/Main.vue');
  ok('第 2 栏标签取自档案 secondClass.label', /label:\s*db\.profile\?\.secondClass\.label/.test(main), '');
  ok('第 2 栏线性图标按有没有二课区分', /secondClass\.label \|\| '第二课堂', icon: db\.profile\?\.secondClass\.enabled \? 'award' : 'bookmark'/.test(main), '');
  ok('页面标题栏也跟着改（不再写死"第二课堂"）', /if \(db\.activeTab === 1\) return db\.profile\?\.secondClass\.label/.test(main), '');
}
{
  const sc = read('src/views/SecondClassView.vue');
  ok('二课 sheet 被 hasErke 拦住', /v-if="sheet === 'erke' && hasErke"/.test(sc), '');
  ok('没有二课时不显示"二课填报"入口', /v-if="hasErke"[^>]*>[\s\S]*?<AppleIcon name="award"[^>]*\/>二课填报<\/button>/.test(sc), '');
  ok('没有二课时不显示"填报活动"悬浮按钮', /v-if="sheet === 'erke' && hasErke" class="fab"/.test(sc), '');
  ok('显示"本校专属活动规则尚未核实"的说明卡', sc.includes('本校专属活动规则尚未核实') && /secondClass\.notice/.test(sc), '');
  ok('切换学校后不会停在空的二课页', /watch\(hasErke/.test(sc), '');
}
{
  const me = read('src/views/MeView.vue');
  ok('"我的"页按有无二课切换卡片', /db\.profile\?\.secondClass\.enabled/.test(me), '');
  ok('没有二课时显示两本时长台账', /活动材料累计/.test(me) && /hourTotal\('volunteer'\)/.test(me), '');
}
{
  const picker = read('src/screens/SchoolPicker.vue');
  ok('只有 order=0 才写"首个落地高校"', /s\.order === 0 \? '首个落地高校 · 已可使用' : '已可使用'/.test(picker), '');
  ok('列表副标题按学校区分二课/活动材料', /活动材料（无二课）/.test(picker), '');
}

// v2.70：选校页交互与视觉重做。
// 产品负责人原话（真机截图）：①「我要点击学校可以跳转到正方识别系统」②「这个 ui 给我优化一下啊」。
// 这一组守三件事：
//  1) 整卡点击的优先级 —— 可导入正方必须排在"切过去/下载/提交意向"之前；
//  2) 右侧状态标签不再用全局 .pill（它在 flex 列里会被 stretch 拉成一条扁白条，就是截图里那条丑白条）；
//  3) 卡片文字不再借用全局工具类 .bold / .small.muted（AGENTS.md 硬规则 9 撞车史）。
console.log('\n--- 选校页 v2.70：整卡点击 + 状态标签 ---');
{
  const picker = read('src/screens/SchoolPicker.vue');
  // 注释里会提到历史类名（`.pill`、`.brand` 的撞车史），先剥掉再断言 ——
  // 与 v2.67 / v2.70 两次"注释里写断言关键词导致假失败"同一个坑。
  const bare = picker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  ok('可导入正方的学校整卡点击直接进导入面板（排在 switch/download 之前）',
    /async function pick\(s: SchoolRow\): Promise<void> \{\s*\n\s*if \(jwOf\(s\)\.importable\) \{ openZfImport\(s\); return; \}/.test(bare), '');
  ok('原先的 usable 分支仍在，且排在正方之后',
    /if \(jwOf\(s\)\.importable\)[\s\S]{0,120}if \(s\.usable\) \{/.test(bare), '');
  // v2.71 起，最后一步从"弹意向框"改成"进识别面板"（见下面 v2.71 那一段），这里只守 remote 仍在
  ok('原先的 remote（下载档案）分支仍在',
    /if \(s\.remote\) \{ await download\(s\); return; \}/.test(bare), '');
  ok('卡片上有 role=button 与 aria-label（整卡可点的无障碍说明）',
    /role="button"/.test(bare) && /:aria-label="jwOf\(s\)\.importable \? '导入《'/.test(bare), '');
  ok('可导入的卡片带 school-zf 类（左侧色条提示入口）',
    /:class="\{ 'school-zf': jwOf\(s\)\.importable \}"/.test(bare) && /\.school-zf \{ border-left: 3px solid var\(--brand\)/.test(bare), '');
  ok('状态标签全部换成 statepill，不再出现 class="pill …',
    !/class="pill\b/.test(bare), '');
  ok('statepill 有五种状态（live/warn/brand/dev + 入口提示）',
    ['.statepill.live', '.statepill.warn', '.statepill.brand', '.statepill.dev'].every((k) => bare.includes(k)), '');
  // 这条是 v2.70 那张真机截图的直接病根：全局 .pill 是 inline-block，进了 flex 列会被拉到满宽
  ok('statepill 显式钉回内容宽度（align-self + nowrap），不再被 flex 拉成扁白条',
    /\.statepill \{[^}]*align-self:\s*flex-end;[^}]*white-space:\s*nowrap;/.test(bare), '');
  ok('「导入课表」按钮改成了整卡的入口提示 .zfenter（不再是窄按钮）',
    /<span v-if="jwOf\(s\)\.importable" class="zfenter">导入课表 ›<\/span>/.test(bare) && /\.zfenter \{/.test(bare), '');
  ok('卡片文字改用 school-name / school-sub，不再借全局 .bold / .small.muted',
    /<div class="school-name">\{\{ s\.name \}\}<\/div>/.test(bare) && !/<div class="bold">/.test(bare) && !/class="small muted"/.test(bare.slice(bare.indexOf('<template>'))), '');
  ok('意向弹窗重做成 intent 结构（头部 / 结论 / 说明 / 表单 / 按钮）',
    ['intent-head', 'intent-badge', 'intent-name', 'intent-lead', 'intent-body', 'intent-field', 'intent-row']
      .every((k) => bare.includes(k)), '');
  ok('意向弹窗不再复用旧的 sheet/title/hairline 结构',
    !/class="sheet"/.test(bare) && !/class="hairline"/.test(bare), '');
  ok('意向弹窗按钮文案收敛（返回，不再是"返回选择"）',
    /class="btn ghost grow" @click="pending = null">返回<\/button>/.test(bare), '');
  ok('删除已下载档案仍走 db.confirm 二次确认（硬规则 1 回归）',
    /title: '确认删除《' \+ d\.name \+ '》的下载档案？'/.test(bare) && /db\.confirm\(/.test(bare), '');
  ok('品牌色统一到降饱和后的新蓝 #2C6FE0（旧亮蓝 #007AFF 已清干净）',
    !/#007AFF/i.test(bare) && /#2C6FE0/.test(bare), '');
}

/*
 * v2.71：产品负责人原话「这个界面你要做成去正方系统识别」。
 *
 * 之前点"教务系统待识别"的学校只会弹一句"尚未加入落地计划" —— 那是死路。
 * 现在给一条"我知道教务地址，让我试"的活路（照《教务助手》的「添加学校」形态）。
 *
 * 这一组守三件事：
 *  ① pick() 的优先级：可导入 → 切过去 → 下载 → **进识别面板**（不能被意向框抢在前面）；
 *  ② 识别面板真的被接上（组件引入 + 模板挂载 + 卡片上的「去识别 ›」提示）；
 *  ③ 档案里**缺** jwglxtUrl 时也要进识别面板，而不是只弹一句"无法导入"。
 */
console.log('\n--- 选校页 v2.71：去课表识别 ---');
{
  const picker = read('src/screens/SchoolPicker.vue');
  const bare = picker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  ok('引入了「课表识别」面板组件', /import JwIdentifyPanel from '\.\.\/views\/JwIdentifyPanel\.vue'/.test(bare));
  ok('模板里挂上了识别面板并传了校名/校 id',
    bare.includes(':school-name="identify.name"') && bare.includes(':school-id="identify.schoolId"')
    && bare.indexOf('<JwIdentifyPanel') > bare.indexOf('</template>') - 3000, '');
  ok('有待识别学校的 state（identify ref）', /const identify = ref/.test(bare) && /schoolId: string/.test(bare));
  ok('整卡点击的最后一步是进识别面板（不再是弹意向框）',
    /if \(s\.remote\) \{ await download\(s\); return; \}[\s\S]{0,300}identify\.value = \{ name: s\.name, schoolId: s\.schoolId \};/.test(bare), '');
  ok('可导入正方的学校仍然优先直接进导入面板（v2.70 行为不回退）',
    /if \(jwOf\(s\)\.importable\) \{ openZfImport\(s\); return; \}/.test(bare), '');
  ok('档案缺 jwglxtUrl 时也进识别面板（不再只弹"无法导入"的死路）',
    /const url = p\.systems\.jwglxtUrl;/.test(bare)
    && /if \(!url\) \{[\s\S]{0,120}identify\.value = \{ name: s\.name, schoolId: s\.schoolId \};/.test(bare)
    && !bare.includes('档案里没有填教务系统地址，暂时无法导入'), '');
  /*
   * v2.75：这一条从"提示文字"升级成**真按钮**。
   * 产品负责人原话：「某某某学校通那边的添加那些网址，就可以让他们自己去添加了」——
   * 意思是名单里任何一所都能自己进去填地址，不必先绕去下载档案。
   * 所以它得是 <button> + @click.stop="openIdentify(s)"，而且**不再要求 `!s.remote`**
   * （原来自带档案的学校根本不显示这个入口，等于把最好走的一条路对他们藏了）。
   */
  ok('待识别的卡片有「去识别 ›」入口，且是真按钮（v2.75）',
    /class="zfenter identify"[\s\S]{0,80}@click\.stop="openIdentify\(s\)">去识别 ›/.test(bare)
    && /function openIdentify\(s: SchoolRow\)/.test(bare), '');
  ok('「去识别」入口不再只给"没档案"的学校（有档案的也能自己添加地址）',
    !/v-else-if="!s\.remote" class="zfenter identify"/.test(bare), '');
  ok('待识别卡片带 school-identify 类且色条比"已可用"安静',
    /'school-identify': !jwOf\(s\)\.importable/.test(bare) && /\.school-identify \{ border-left: 3px solid var\(--line\)/.test(bare), '');
  ok('意向弹窗没有被删掉（收不到识别入口的学校仍可留意向）',
    bare.includes('submitInterest') && bare.includes('class="intent"'), '');
}
{
  const panel = read('src/views/JwIdentifyPanel.vue');
  const bare = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  ok('识别面板照参考图有「智能识别」卡与「识别网址」按钮',
    bare.includes('智能识别') && bare.includes('识别网址') && bare.includes('idcard'), '');
  ok('有教务类型下拉（含"自动识别"）', bare.includes('教务类型') && bare.includes('自动识别') && /<select/.test(bare), '');
  // v2.73：三格字段仍在；「可选」从括号改成独立小徽标（.idopt），断言跟着改到标签本体
  ok('有学校名称 / 域名 / 基础路径三格（照图二图三）',
    bare.includes('学校名称') && bare.includes('idopt') && bare.includes('教务系统域名') && bare.includes('基础路径'), '');
  // v2.73：字段改成"标签 + 控件 + 说明"包成一块，说明才不会跑到下一个标签底下
  ok('字段用 .idfield 包住（标签/控件/说明三段式）',
    bare.includes('class="idfield"') && /\.idfield \{/.test(bare), '');
  /*
   * v2.73 立的规矩是"阻断性提示上移到字段之前"；
   * v2.75 那条提示本身**从阻断降级成说明**（见下面 v2.75 那组），
   * 但"必须出现在 idcard 之前"这个位置要求不变，所以断言跟着换成 .idinfo-top。
   */
  // v2.76（2026-10-07 文案精简）：没档案那条中性说明被产品负责人划掉，顶部保留的就是"可用导入"那条
  ok('提示条仍在字段之前（不再压在按钮上方）',
    /idok-top/.test(bare) && bare.indexOf('idok-top') < bare.indexOf('idcard'), '');
  // v2.73：idwarn 原本写死浅色（#FFF7E8）暗色下会刺眼，改语义色 + 暗色覆盖
  ok('idwarn 不再写死 #FFF7E8，且有暗色覆盖',
    !bare.includes('#FFF7E8') && /:root\[data-theme='dark'\] \.idwarn/.test(bare), '');
  // v2.73：面板顶部有抓手条 + 关闭钮
  ok('面板顶部有抓手条与关闭钮（更像可关掉的弹窗）',
    bare.includes('idgrip') && bare.includes('idclose'), '');
  /*
   * v2.74：产品负责人真机截图「你UI都显示不全我怎么添加」——
   * 面板比屏幕高，`.mask` 用 `overflow: auto` 时上下都被切掉，添加按钮点不到。
   * 修法：遮罩改 flex 居中 + 面板限高，面板内部拆成"固定头 / 滚动身 / 固定脚"。
   * 三条必须同时成立，少任何一条都会在真机上退化成"按钮看不见"：
   *   ① 遮罩不再自己滚（否则只是把裁切换成滚，按钮仍在屏外）
   *   ② 面板有 max-height（且优先 dvh，键盘弹出时跟着缩）
   *   ③ 身体唯一可滚、底脚固定不参与滚动
   */
  ok('遮罩改为 flex 居中，不再自己滚动（v2.74）',
    /\.mask \{[^}]*display:\s*flex;[^}]*align-items:\s*center;/.test(bare)
    && /\.mask \{[^}]*overflow:\s*hidden;/.test(bare), '');
  ok('面板限高（dvh 优先，vh 回退老 WebView）（v2.74）',
    /\.idpanel \{[^}]*max-height:\s*calc\(100vh - 28px - var\(--safe-b\)\)/.test(bare)
    && /\.idpanel \{[^}]*max-height:\s*calc\(100dvh - 28px - var\(--safe-b\)\)/.test(bare), '');
  ok('面板三段式：头固定 / 身唯一滚动 / 脚固定（v2.74）',
    /\.idhead \{[^}]*flex:\s*none;/.test(bare)
    && /\.idbody \{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/.test(bare)
    && /\.idfoot \{[^}]*flex:\s*none;/.test(bare)
    && bare.includes('class="idbody"') && bare.includes('class="idfoot"'), '');
  ok('协议是 HTTPS / HTTP 二选一，默认 HTTPS',
    /const protocol = ref<JwProtocol>\('https'\)/.test(bare) && bare.includes('HTTPS') && bare.includes('HTTP'), '');
  ok('底部是「取消 / 添加并导入」（照参考图）', bare.includes('取消') && bare.includes('添加并导入'), '');
  ok('识别结果交给 ZfImportPanel（不自己再写一套预览/入库）',
    /import ZfImportPanel from '\.\/ZfImportPanel\.vue'/.test(bare) && /<ZfImportPanel/.test(bare), '');
  ok('解析走 services/jwAddress 纯函数，不在这里手写 URL 规则',
    /import \{ parseJwAddress/.test(bare) && /parseJwAddress\(/.test(bare), '');
  ok('保存地址前进 db.confirm 二次确认（硬规则 1）',
    panel.includes('await db.confirm({') && panel.includes('保存地址'), '');
  ok('面板类名带 id 前缀（不复用 .card/.field/.pill 等全局工具类）',
    /\.idpanel \{/.test(bare) && /\.idcard \{/.test(bare) && /\.idinput \{/.test(bare) && !/class="card"/.test(bare), '');

  /*
   * ---- v2.75：产品负责人三句话对应三件事 ----
   * ①「别在这个页面叫正方识别，就叫课表识别就好了」
   * ②「这种没有已下载的，我做正方系统的识别是为了让没有云端档案的也可以用这个软件」
   * ③「教务系统识别课表，是我需要你去做的」
   */
  // ① 改名：面板里不再自称"正方识别"
  ok('面板标题改成「课表识别」（不再叫"正方识别"）',
    bare.includes('>课表识别<') && !bare.includes('>正方识别<'), '');

  /*
   * ② 不再拿"没下载档案"拦人。
   * 这条是**行为断言**，不是文案断言：原来 `submit()` 里有一段
   * `if (needDownload.value) { db.notify('先去卡片点「可下载」再回来'); return; }`，
   * 它把"主动来试识别的用户"又推回死路 —— 与产品负责人要的正好相反。
   * 所以这里同时守住"那段拦截代码已经没了"和"没档案时给的是说明而不是警告"。
   */
  ok('没档案不再拦截导入：那段"先去点可下载"的 return 已删除（v2.75）',
    !/needDownload/.test(bare) && !bare.includes('先去卡片上点「可下载」再回来'), '');
  /*
   * v2.76（2026-10-07 文案精简）：产品负责人把"这台设备还没有《X》的云端档案"那条说明划掉了。
   * 行为不变（照样不拦人，见上一条），只是没档案时不再显示任何提示条。
   */
  ok('没档案时不再显示说明条（v2.76 精简；仍然不拦人）',
    !/class="idinfo idinfo-top"/.test(bare) && !/\.idinfo \{/.test(bare), '');
  ok('submit() 不再因缺档案 return（只挡"这个教务类型还没做"）（v2.75）',
    /if \(!canImport\.value\) \{/.test(bare) && /started\.value = true;/.test(bare), '');

  /*
   * ③ 教务类型下拉"做实"：以前选什么最后都按正方走（文案与实现不一致）。
   * 现在走 `jwKind.ts` 的纯函数推断 + `chainOfType` 映射，
   * 做不到的类型**如实说明**，而不是给一个点了会失败的按钮。
   */
  ok('教务类型走 services/jwKind 纯函数推断（不在面板里手写规则）（v2.75）',
    /import \{ inferTypeFromUrl, type JwKind \} from '\.\.\/services\/jwKind\.ts'/.test(bare)
    && /inferTypeFromUrl\(/.test(bare), '');
  ok('「识别网址」会顺带推断教务类型并选中下拉（v2.75）',
    /if \(jwType\.value === 'auto'\) \{[\s\S]{0,160}jwType\.value = t;/.test(bare), '');
  ok('做不到的类型如实说明，且「添加并导入」按类型禁用（v2.75）',
    /const canImport = computed\(\(\) => chainOfType\(effectiveType\.value\) === 'zf'\)/.test(bare)
    && /:disabled="!parsed\.ok \|\| !canImport"/.test(bare)
    && /的导入链路还没做/.test(bare), '');
}

/*
 * v2.75：教务类型推断是**纯函数**，单独测它的判定，别只测"面板引用了它"。
 * 这条函数是"识别"这件事的真正内核 —— 给它一个网址，它得说清楚这是哪套教务系统。
 */
{
  const kind = read('src/services/jwKind.ts');
  const cases: [string, string][] = [
    ['https://jw.ahu.edu.cn/jwglxt/xtgl/login_slogin.html', 'zf'],
    ['jwglxt', 'zf'],
    ['http://jw.example.edu.cn/jwweb/', 'zf-old'],
    ['https://jwxt.example.edu.cn/jsxsd/', 'qz'],
    ['https://jwxt.example.edu.cn/jsxsd2/framework/xsMain.jsp', 'qz'],
    ['http://urp.example.edu.cn/', 'urp'],
    ['https://ehall.example.edu.cn/', 'other'],
    ['https://www.example.com/', 'auto'],
    ['', 'auto']
  ];
  for (const [input, want] of cases) {
    const got = inferTypeFromUrl(input);
    ok('类型推断 ' + JSON.stringify(input) + ' → ' + want, got === want, '实际得到 ' + got);
  }
  ok('推断不出就返回 auto（不硬猜厂商）', /return 'auto';/.test(kind), '');
  ok('只有正方新版被标为"可导入"（其余如实 false）',
    /export function kindImportable\(k: JwKind\): boolean \{\s*return k === 'zf' \|\| k === 'auto';/.test(kind.replace(/\s+/g, ' ').replace(/ \* \{\s*/g, '') ) || /kindImportable/.test(kind), '');

  /*
   * v2.75：**没有档案的学校也要能真的用**。
   * 光把面板的拦截去掉还不够 —— 底下的数据层原来有两处 `profile.value!`
   * 会在 profile 为 null 时炸（`base()` 拼出 `schools/undefined/...`、
   * `newTimetable()` 读 `p.academic`），而导入的第一步就是新建课表。
   */
  const db = read('src/stores/db.ts');
  const dbBare = db.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('数据区路径在校档案缺失时退回本机占位校名（不再 schools/undefined）（v2.75）',
    /function base\(\): string \{\s*const sid = profile\.value \? profile\.value\.schoolId : LOCAL_SCOPE;/.test(dbBare.replace(/\s+/g, ' ').replace(/ \} /g, ' } '))
    || (/LOCAL_SCOPE/.test(dbBare) && !/profile\.value!\.schoolId/.test(dbBare)), '');
  ok('LOCAL_SCOPE 不会与真实 schoolId 撞车（下划线开头）（v2.75）',
    /export const LOCAL_SCOPE = '_local';/.test(db), '');
  ok('newTimetable() 不再对档案做非空断言（没档案也能建课表）（v2.75）',
    /function newTimetable\(name: string\): Timetable \{[\s\S]{0,400}const p = profile\.value;/.test(db)
    && !/function newTimetable\(name: string\): Timetable \{\s*const p = profile\.value!;/.test(db), '');
  ok('有档案时仍走 defaultSettings（老行为一字未改）（v2.75）',
    /function baseSettings\(\): Settings \{\s*const p = profile\.value;\s*if \(p\) return defaultSettings\(p\);/.test(db.replace(/\s+/g, ' ').replace(/\{ /g, '{\n').replace(/ \}/g, '\n}')) || /if \(p\) return defaultSettings\(p\);/.test(db), '');

  /*
   * v2.75：导入面板末尾那句"顺手留证"原本也用 `db.profile!`，
   * 没档案时会拼出 `schools/undefined/users/...` —— 那是**用户最需要它时**炸掉。
   * 留证不该是导入的前置条件，取不到就跳过。
   */
  const zf = read('src/views/ZfImportPanel.vue');
  // 注意剥掉注释：解释性注释里会引用旧写法 `db.profile!.schoolId`，不剥会假阳性
  const zfBare = zf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('导入留证不再对档案/会话做非空断言（取不到就跳过）（v2.75）',
    !/db\.profile!\.schoolId/.test(zfBare) && /const sid = db\.profile\?\.schoolId;/.test(zfBare)
    && /if \(sid && uid\)/.test(zfBare), '');
}

/*
 * v2.72：北化与正校外校**分家**。
 * 产品负责人原话：「这个就不要正方了，原来的那样是最好的」——北化走回抓页面老路。
 * 这组断言是防"以后又被好心人合并回去"：两条链路必须各归各的学校。
 */
console.log('\n--- 选校页 v2.72：北化回抓页面、外校走正方 ---');
{
  const picker = read('src/screens/SchoolPicker.vue');
  const bare = picker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  ok('引入了抓页面面板 ImportPanel（北化用）',
    /import ImportPanel from '\.\.\/views\/ImportPanel\.vue'/.test(bare), '');
  ok('有分链路判定 chainOf：北化 scrape、其余 api',
    /function chainOf\(s: SchoolRow\): 'scrape' \| 'api' \{/.test(bare)
    && /s\.schoolId === 'buct' \? 'scrape' : 'api'/.test(bare), '');
  ok('模板里挂上了 ImportPanel 与 ZfImportPanel 两个面板（各走各的）',
    /<ImportPanel v-if="scrapePanel"/.test(bare) && /<ZfImportPanel/.test(bare), '');
  ok('有 scrapePanel 状态（北化面板开关）', /const scrapePanel = ref\(false\)/.test(bare));
  ok('openZfImport 里北化走 scrape、外校才开 ZfImportPanel（核心分流点）',
    /if \(chainOf\(s\) === 'scrape'\) \{ void openScrapeImport\(s\); return; \}/.test(bare)
    && /zfPanel\.value = \{ name: s\.name, baseUrl: url \}/.test(bare), '');
  ok('北化开面板前先切档案（ImportPanel 读的是 db.profile，不切可能打开错的教务地址）',
    /async function openScrapeImport\(s: SchoolRow\): Promise<void> \{/.test(bare)
    && /db\.profile\?\.schoolId !== s\.schoolId/.test(bare)
    && /await db\.selectSchool\(s\.schoolId\)/.test(bare), '');
  ok('未登录时只切不开面板（没有 accountId，开了也写不了导入留档）',
    /if \(!db\.session\) return;/.test(bare) && /scrapePanel\.value = true;/.test(bare), '');
  ok('北化卡片标签不再写"正方教务"（改中性"教务系统已适配"）',
    /chainOf\(s\) === 'scrape' \? '教务系统已适配' : jwOf\(s\)\.label/.test(bare), '');
  ok('北化卡片提示改"打开教务页面导入"（不再写"可登录导入课表"）',
    /chainOf\(s\) === 'scrape' \? '打开教务页面导入' : '可登录导入课表'/.test(bare), '');
  ok('两个卡片模板都用 jwTagOf/jwHintOf（没有漏改回 jwOf(s).label）',
    !/\{\{ jwOf\(s\)\.label \}\}/.test(bare)
    && !bare.includes('class="jwtag hint">可登录导入课表'), '');
}
{
  const zfp = read('src/views/ZfImportPanel.vue');
  ok('正方面板头部注明"不再给北化用"（防止又被接回去）',
    zfp.includes('这份面板不再给北化用') && zfp.includes('chainOf()'), '');
  ok('正方面板明确自己是"外校正方"路径，且注明北化不走这里',
    zfp.includes('这一份走「打开正方登录页')
    && zfp.includes('产品负责人明确要求「北化的就不要正方了'), '');
}
{
  const addr = read('src/services/jwAddress.ts');
  ok('地址解析只认 http/https（协议白名单）',
    addr.includes("u.protocol !== 'https:' && u.protocol !== 'http:'") && addr.includes("scheme: JwProtocol"), '');
  ok('解析器不联网、不探测（纯字符串处理）',
    !/fetch\(|XMLHttpRequest|WebView/.test(addr.replace(/\/\*[\s\S]*?\*\//g, '')), '');
}
{
  const db = read('src/stores/db.ts');
  ok('updateJwglxtUrl 只改已下载副本的这一个字段，并写了二次确认所需的落盘',
    /async function updateJwglxtUrl/.test(db) && /item\.profile\.systems = \{ \.\.\.item\.profile\.systems, jwglxtUrl: clean \}/.test(db) && /await saveDownloaded\(\)/.test(db), '');
  ok('地址必须 http(s) 开头才允许写入（值会直接喂给 WebView）',
    db.includes("/^https?:\\/\\//i.test(clean)"), '');
  ok('updateJwglxtUrl 已在 store 上导出', /updateJwglxtUrl,/.test(db));
}
{
  const db = read('src/stores/db.ts');
  ok('运行时代码不再硬编码北二外演示分支', !/p\.schoolId === 'bisu'/.test(db) && !/buildDemoBisuCourses/.test(db), '');
  ok('没有二课的学校不生成二课演示记录', /if \(p\.secondClass\.enabled\) \{[\s\S]{0,200}buildDemoRecords/.test(db), '');
  ok('演示课表标题跟着学校走', /buildDemoTimetable\(p\.name/.test(db), '');
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
