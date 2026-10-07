<script setup lang="ts">
/*
 * 「课表识别」面板（v2.71 建，v2.73 优化布局，v2.75 改口径）。
 *
 * 产品负责人原话：「这个界面你要做成去正方系统识别」+ 三张《教务助手》的截图。
 * 形态照那三张图：**智能识别（粘贴网址 → 识别网址）→ 教务类型 → 学校名称
 * → 教务系统域名 → 基础路径 → 协议 HTTPS/HTTP → 取消 / 添加**。
 *
 * 【v2.73 UI 优化】产品负责人又发来真机截图说「这个 UI 帮我优化」，改了四处：
 *   1. **阻断性提示上移**：原来"档案没下载"压在按钮上方，用户辛辛苦苦填完才被告知白填 ——
 *      现在放到最前，先说清楚再让填。
 *   2. **字段三段式**（`.idfield` 包住"标签 + 控件 + 说明"）：原来 label/input/note 平铺，
 *      说明文字会紧贴下一个 label，看不出属于哪个框。
 *   3. **顶部抓手条 + 标题/副标题 + 关闭钮**，比原来孤零零一行居中大标题更像弹窗。
 *   4. **「只保存地址」改次级按钮**（给底色），原来裸文字链容易被当成说明文字。
 *   顺带修掉 `idwarn` 写死浅色 `#FFF7E8` 的暗色隐患（与 v2.71 的 `.jwtag` 同一个病）。
 *
 * 【v2.74 面板高度】`.mask` 改 flex 居中 + 面板限高，面板内部拆"头固定 / 身滚动 / 脚固定"三段，
 *   治好"面板比屏幕高、按钮点不到"（真机图一）。
 *
 * 【v2.75 三处口径变更（产品负责人 2026-10-03 真机截图 + 三句话）】
 *   ① **改名**：「别在这个页面叫正方识别，就叫课表识别就好了」→ 标题、注释、提示一律用「课表识别」。
 *   ② **不再要求先下载档案**：「没有已下载的，我做正方系统的识别是为了让没有云端档案的也可以用这个软件」。
 *      以前 `submit()` 在没档案时 `db.notify('先去卡片点「可下载」再回来')` 直接 return ——
 *      **那是把"来试识别"的用户又推回死路**，而识别面板存在的意义恰恰是给没档案的学校一条活路。
 *      现在：**没档案也能直接试导入**。导入只写"本人课表"，不依赖学校档案；
 *      档案只在两处用到（`vendor.importable` 判能否免填、`saveAddressOnly` 存地址），
 *      所以这两处对无档案的学校如实降级，而不是拦着不让走。
 *   ③ **教务类型下拉做实**：以前选什么都是按正方走（文案与实现不一致）。现在
 *      `chainOfType()` 把类型映射到链路：`zf` 走 kbList 导入；`zf-old`/`qz`/`urp`/`other`
 *      **如实说明"这条链路还没做"**，不再假装能导（硬规则 6）。
 *      「识别网址」也从"只拆域名"升级成"顺带推断教务类型"（`inferTypeFromUrl`，纯函数）。
 *
 * 【与北化那条链路的关系（重要，别搞混）】
 *   北化：`ImportPanel.vue` → 打开教务页面 → 用户自己点到课表表格 → 抓 DOM → `jwglxtBuct`
 *        （v2.72 起北化回走这条路，见 `SchoolPicker.vue` 的 `chainOf()`）。
 *   这里：给**外校 / 教务系统待识别 / 没档案**的学校用，用户自己填地址 → 走 `ZfImportPanel`
 *        的同源 kbList 接口。两条链路只在"地址从哪来"上不同，预览/入库共用。
 *
 * 【合规边界（AGENTS.md）】
 *   - 只解析用户**自己填**的地址，不探测、不扫描、不猜域名。
 *   - 登录仍在 WebView 里由用户自己完成，App 不接触账号密码、不读 Cookie 值（硬规则 2 的边界）。
 *   - `describeOutcome` 是错误话术的单一入口，这里不自己编理由（硬规则 6）。
 */
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { guard } from '../services/guard.ts';
import { parseJwAddress, addressHint, loginUrlFor, type JwProtocol } from '../services/jwAddress.ts';
import { inferTypeFromUrl, type JwKind } from '../services/jwKind.ts';
import { identifyVendor } from '../catalog/jwSystems.ts';
import ZfImportPanel from './ZfImportPanel.vue';

const props = defineProps<{ schoolName: string; schoolId: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const db = useDb();

const rawUrl = ref('');
const domain = ref('');
const basePath = ref('');
const protocol = ref<JwProtocol>('https');
const schoolNameInput = ref(props.schoolName || '');
/** 「教务类型」下拉：默认自动识别（面板上与《教务助手》一致）。 */
const jwType = ref<JwKind>('auto');
/** 点过「识别网址」之后才给地址格式提示，避免用户刚进来就被红字劝退。 */
const tried = ref(false);
const started = ref(false);

const TYPES = [
  { v: 'auto', label: '自动识别' },
  { v: 'zf', label: '正方教务（新版 jwglxt）' },
  { v: 'zf-old', label: '正方教务（老版 jwweb）' },
  { v: 'qz', label: '强智教务' },
  { v: 'urp', label: 'URP 教务' },
  { v: 'other', label: '其它 / 不确定' }
] as const;

/**
 * v2.75：类型 → 链路。**"能不能导"只有一个真值**，模板与提示都问它，不各写一套。
 *
 * 现在只有正方新版的 kbList 链路是真做出来的（`ZfImportPanel` + `zfClient`）。
 * 其余类型如实返回 `false` —— 产品负责人要求"识别课表是我需要你去做的"，
 * 那就先把他要的**识别**做实、把**做不到的**说清楚，别用一句"添加并导入"糊过去。
 * 将来补上强智 / URP 时，只需在这里接一条链路。
 */
function chainOfType(t: JwKind): 'zf' | 'unsupported' {
  return t === 'zf' || t === 'auto' ? 'zf' : 'unsupported';
}

/** 真正参与"能不能导"判断的类型：用户手选了就以手选为准，否则用网址推断出来的。 */
const effectiveType = computed<JwKind>(() => (jwType.value === 'auto' ? inferred.value : jwType.value));

/**
 * 从当前已填地址推断教务类型（纯函数 `inferTypeFromUrl`，可单测）。
 * 只在用户没手选类型时才用它 —— **不覆盖用户的选择**。
 */
const inferred = computed<JwKind>(() => {
  const src = domain.value.trim() || rawUrl.value;
  return inferTypeFromUrl(src);
});

/** 点过「识别网址」后，若推断出具体类型且用户还是"自动识别"，就把下拉跟着选中。 */
const inferredNote = computed(() => {
  if (!tried.value) return '';
  if (jwType.value !== 'auto') return '';
  const t = inferred.value;
  if (t === 'auto') return '';
  const label = TYPES.find((x) => x.v === t)?.label || '';
  return '按网址判断，这更像是「' + label + '」。';
});

const canImport = computed(() => chainOfType(effectiveType.value) === 'zf');
/** 选了做不到的类型时的如实说明（硬规则 6：不许假装能导）。 */
const unsupportedNote = computed(() => {
  if (canImport.value) return '';
  const label = TYPES.find((x) => x.v === effectiveType.value)?.label || '这个教务系统';
  return '「' + label + '」的导入链路还没做，现在只有正方新版（jwglxt）能直接取课表。你仍然可以保存地址留档。';
});

/*
 * 地址的**唯一真值**来自 `parseJwAddress`（纯函数、可单测）。
 * 三个输入框之间的同步逻辑都写在这两个 computed / 函数里，模板里不出现解析规则，
 * 免得"显示一套、导入用另一套"。
 *
 * 优先级：只要有域名就用「域名 + 基础路径 + 协议」这套表单值（用户手改过就以手改为准）；
 * 只有域名空着时才回落到解析整段粘贴的网址。
 */
const parsed = computed(() => {
  if (domain.value.trim()) {
    const proto = protocol.value;
    const path = normalizePath(basePath.value);
    const compose = proto + '://' + domain.value.trim().replace(/^\/+|\/+$/g, '') + path;
    const p = parseJwAddress(compose, proto);
    // basePath 是用户自己填的，解析器可能把自建路径也保留下来 —— 以用户填的为准
    if (p.ok) return { ok: true, parts: { ...p.parts, basePath: path }, error: '' };
    return p;
  }
  return parseJwAddress(rawUrl.value, protocol.value);
});

const hint = computed(() => {
  if (!tried.value) return '';
  if (!parsed.value.ok) return parsed.value.error;
  return addressHint(rawUrl.value || domain.value, protocol.value);
});

/** 这所学校的教务系统（判断"能不能直接试导入"的单一来源仍是 jwSystems）。 */
const vendor = computed(() => {
  const p = db.profileOf(props.schoolId);
  return identifyVendor(props.schoolId, p ? p.systems.timetableAdapter : undefined);
});

/*
 * v2.75：`hasProfile` 只用来**告知**，不再用来**拦截**。
 *
 * 产品负责人原话：「这种没有已下载的，我做正方系统的识别是为了让没有云端档案的也可以用这个软件」。
 * 所以这里改名为 `hasProfile`（事实），并保留一个"没有档案"的提示 —— 但它是**说明**，
 * 不是门槛：导入写的是"本人课表"，跟学校档案没关系，没档案照样能试。
 */
const hasProfile = computed(() => !!db.profileOf(props.schoolId));

function normalizePath(v: string): string {
  const s = String(v || '').trim().replace(/\/+$/, '');
  if (!s || s === '/') return '';
  return s.startsWith('/') ? s : '/' + s;
}

/**
 * 点「识别网址」：把粘贴的整段网址拆进下面三个输入框（图二 → 图三那个过程）。
 *
 * v2.75：顺带**推断教务类型**并自动选中下拉（只在用户还没手选时）。
 * 推断走纯函数 `inferTypeFromUrl`，认不出来就保持"自动识别"，不硬猜。
 */
function identify(): void {
  tried.value = true;
  const p = parseJwAddress(rawUrl.value, protocol.value);
  if (!p.ok) return;
  domain.value = p.parts.domain;
  basePath.value = p.parts.basePath;
  if (p.parts.protocol) protocol.value = p.parts.protocol as JwProtocol;
  // 用户没手选过类型 → 跟着网址推断走（推不出来就保持 auto）
  if (jwType.value === 'auto') {
    const t = inferTypeFromUrl(p.parts.baseUrl || rawUrl.value);
    if (t !== 'auto') jwType.value = t;
  }
}

/**
 * 点「添加并导入」。
 *
 * 不做"添加学校到名单"这种写操作 —— 名单里的学校是签名云端档案管的，
 * 本机凭空加一所进去只会让 `profileOf()` 拿到 null 而到处出错。
 * 这里诚实地把它做成"**用户自己填的地址 → 直接进导入**"：拿到地址就能用，不假装改了名单。
 *
 * 【v2.75 关键改动：不再要求先下载档案】
 * 原来这里有一段 `if (needDownload) { notify('先去卡片点可下载'); return; }` ——
 * 那等于**把主动来试识别的用户又推回死路**，与面板存在的意义正好相反。
 * 导入只写"本人课表"（`courses` 按 `accountId` 存），**不依赖学校档案**；
 * 就算那所学校根本不在名单里、永远不会有档案，"填地址 → 登录 → 取课表"这条路也成立。
 * 所以现在只挡"选了做不到的教务类型"，不挡"没档案"。
 */
async function submit(): Promise<void> {
  tried.value = true;
  const p = parsed.value;
  if (!p.ok) return;

  if (!canImport.value) {
    db.notify(unsupportedNote.value || '这个教务系统的导入链路还没做');
    return;
  }
  started.value = true;
}

/**
 * 只用地址、不登录教务：把整理好的地址记进本机档案的 systems.jwglxtUrl。
 *
 * 没档案时**没法保存**（地址是存在档案对象里的字段）—— 这里如实告知，
 * 但给出可执行的替代路径（先导入一次课表就能用），不是一句"无法保存"就完。
 * 保存地址本身是改数据，必须走 `db.confirm` 二次确认（AGENTS.md 硬规则 1）。
 */
async function saveAddressOnly(): Promise<void> {
  tried.value = true;
  const p = parsed.value;
  if (!p.ok) return;
  const prof = db.profileOf(props.schoolId);
  if (!prof) {
    db.notify('《' + props.schoolName + '》还没有本机档案，地址暂时没地方存 —— 先点「添加并导入」把课表取回来就能用了');
    return;
  }
  const ok = await db.confirm({
    title: '把教务地址保存到《' + prof.name + '》？',
    body: '本机档案里的教务系统地址会改成：' + p.parts.baseUrl,
    detail: '只改这台手机上这份档案的一个字段，方便下次直接导入；不会上传，也不会覆盖签名校验过的档案本体，重新下载档案即可还原。',
    confirmText: '保存地址'
  });
  if (!ok) return;
  await guard('保存教务地址', db.updateJwglxtUrl(props.schoolId, p.parts.baseUrl), 10000);
  db.notify('已保存教务地址');
  emit('close');
}

const loginPreview = computed(() => loginUrlFor(parsed.value.ok ? parsed.value.parts.baseUrl : ''));
</script>

<template>
  <!-- 已经在导入流程里：直接把它托起来，避免"面板叠面板" -->
  <ZfImportPanel
    v-if="started"
    :school-name="schoolNameInput || schoolName"
    :base-url="parsed.ok ? parsed.parts.baseUrl : ''"
    @close="emit('close')"
  />

  <div v-else class="mask" @click.self="emit('close')">
    <!--
      【v2.74：面板不再被裁掉】
      产品负责人真机截图：面板比屏幕高，`.mask` 上下都被切，
      顶部「智能识别」和底部「只保存地址」都看不见 —— **根本没法操作**。
      修法：把面板做成"三段式"——头部固定、中间字段区自己滚、底部按钮固定。
      这样不管屏幕多小、键盘弹不弹，标题与「添加并导入」永远在视野内。
      （整页 .mask 仍留 overflow: auto 做兜底，但正常情况不再依赖它滚动。）
    -->
    <div class="idpanel">
      <div class="idgrip" aria-hidden="true"></div>
      <header class="idhead">
        <div class="idhead-text">
          <div class="idpanel-title">课表识别</div>
          <div class="idpanel-sub">填教务地址，Unimate 帮你试导入课表</div>
        </div>
        <button class="idclose" type="button" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <!-- 中间字段区：唯一滚动的地方 -->
      <div class="idbody">
      <!--
        v2.75：顶部这条从"阻断"改成"说明"。
        以前没档案时这里写「先去卡片上点可下载，再回来」——**那是拦路**，
        而产品负责人的本意恰恰相反："我做识别就是为了让没有云端档案的也能用"。
        所以没档案现在只**告知**（不下载也能试，取回来的课表存本机），
        有档案且已判定可导入的才显示正向结论。
      -->
      <div v-if="vendor.importable" class="idok idok-top">
        这台设备已判定《{{ schoolName }}》可用导入，直接试即可。
      </div>

      <!-- 第一步：智能识别 -->
      <section class="idcard">
        <div class="idcard-head"><span class="idcard-spark">✦</span><b>智能识别</b><span class="idcard-step">第 1 步</span></div>
        <div class="idfield">
          <label class="idlab">教务系统网址</label>
          <input v-model="rawUrl" class="idinput" placeholder="粘贴完整的教务登录页或首页…" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" />
          <p class="idnote">粘贴后点右边按钮，自动拆成下面的域名与路径，并判断教务类型。</p>
        </div>
        <button class="idbtn-scan" type="button" :disabled="!rawUrl.trim()" @click="identify">识别网址</button>
      </section>

      <div class="idsec">基本信息<span class="idsec-line"></span></div>

      <div class="idfield">
        <label class="idlab">教务类型</label>
        <div class="idselectwrap">
          <select v-model="jwType" class="idselect">
            <option v-for="t in TYPES" :key="t.v" :value="t.v">{{ t.label }}</option>
          </select>
          <span class="idcaret" aria-hidden="true">⌄</span>
        </div>
        <p v-if="inferredNote" class="idnote idnote-infer">{{ inferredNote }}</p>
        <p v-else class="idnote">默认自动识别；认不出来时你也可以手动指定。</p>
      </div>

      <div class="idfield">
        <label class="idlab">学校名称 <span class="idopt">可选</span></label>
        <input v-model="schoolNameInput" class="idinput" placeholder="例如：XX 大学" />
      </div>

      <div class="idfield">
        <label class="idlab">教务系统域名</label>
        <input v-model="domain" class="idinput" placeholder="jwxt.example.edu.cn" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" />
        <p class="idnote">非标准端口可直接带上，如 jw.example.edu.cn:30443</p>
      </div>

      <div class="idfield">
        <label class="idlab">基础路径 <span class="idopt">可留空</span></label>
        <input v-model="basePath" class="idinput" placeholder="/jwglxt、/jsxsd 或留空" autocapitalize="off" autocorrect="off" spellcheck="false" />
        <p class="idnote">优先从完整网址解析；教务在网站根目录时留空。</p>
      </div>

      <div class="idfield">
        <label class="idlab">协议</label>
        <div class="idseg">
          <button type="button" :class="{ on: protocol === 'https' }" @click="protocol = 'https'">HTTPS</button>
          <button type="button" :class="{ on: protocol === 'http' }" @click="protocol = 'http'">HTTP</button>
        </div>
        <p class="idnote">加密连接，推荐优先尝试（HTTP 明文下部分机型取不到加密能力）。</p>
      </div>

      <!-- 识别反馈：平时不出现，点过「识别网址」或点过提交才给话 -->
      <div v-if="hint" class="idhint" :class="{ bad: !parsed.ok }">{{ hint }}</div>
      <!--
        v2.75：选了做不到的教务类型时**如实说明**，而不是给一个点了会失败的按钮。
        这是"先把下拉做实"的另一半 —— 做实的含义包括"承认哪条路还没修好"。
      -->
      <div v-if="unsupportedNote && parsed.ok" class="idwarn idwarn-inline">{{ unsupportedNote }}</div>
      <div v-if="loginPreview && canImport" class="idpreview">
        <span>将打开</span><code>{{ loginPreview }}</code>
      </div>
      </div><!-- /.idbody -->

      <!-- 底部动作区：固定，不随字段区滚动 -->
      <div class="idfoot">
        <div class="idactions">
          <button class="idbtn-cancel" type="button" @click="emit('close')">取消</button>
          <button class="idbtn-add" type="button" :disabled="!parsed.ok || !canImport" @click="submit">添加并导入</button>
        </div>
        <!-- 没档案时地址无处可存，这个按钮如实禁用（它改的是档案里的字段） -->
        <button class="idbtn-save" type="button" :disabled="!parsed.ok || !hasProfile" @click="saveAddressOnly">只保存地址，先不导入</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 类名全部带 id 前缀（idpanel/idcard/idlab…）：不复用 .card/.field/.pill 这些全局工具类。
 * AGENTS.md 硬规则 9 —— v2.14 .block、v2.47 .brand、v2.70 .pill 三次撞车都在这里。
 * 特别注意**不要写 position**，否则会撞 test:css 的"同名 + 定位不一致"检查
 * （唯 .idselectwrap / .idcaret 例外，它们本来就靠定位实现下拉箭头）。
 */
/*
 * 【v2.74 面板高度】产品负责人真机截图：面板比屏幕高，上下都看不见 —— 没法操作。
 * 修法：`.mask` 用 flex 居中 + 面板限高，面板内部做成"头/身/脚"三段：
 *   .idhead 固定、.idbody 滚动、.idfoot 固定。
 * `.idpanel` 的 max-height 用 dvh（动态视口高度，键盘弹出时也会跟着缩），
 * 回退到 vh 给老 WebView。
 */
.mask { position: fixed; z-index: 95; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 14px 14px calc(14px + var(--safe-b)); background: rgba(0, 0, 0, .34); }
.idpanel {
  width: min(96vw, 440px);
  max-height: calc(100vh - 28px - var(--safe-b));
  max-height: calc(100dvh - 28px - var(--safe-b));
  display: flex; flex-direction: column;
  padding: 10px 16px 12px;
  background: var(--card); border-radius: 22px; box-shadow: 0 22px 60px rgba(0, 0, 0, .30);
}
/* 中间字段区：唯一滚动的地方；左右不加内边距，负边距交给需要出血的元素自己处理 */
.idbody { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 0 2px; }
/* 底部动作区：固定，不随字段滚动 */
.idfoot { flex: none; padding-top: 4px; border-top: 1px solid var(--line); margin-top: 12px; }

/* 顶部抓手条：纯视觉，让顶层弹窗看起来"可以关掉" */
.idgrip { width: 38px; height: 4px; margin: 0 auto 6px; border-radius: 999px; background: var(--soft-2); }
.idhead { flex: none; display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
.idhead-text { flex: 1; min-width: 0; }
.idpanel-title { font-size: 19px; font-weight: 700; letter-spacing: -.2px; color: var(--text); }
.idpanel-sub { margin-top: 3px; font-size: 12.5px; color: var(--muted); }
.idclose { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--soft); color: var(--muted); font-size: 13px; }
.idclose:active { background: var(--pressed); }

.idcard { padding: 14px; border: 1px solid var(--line); border-radius: 16px; background: var(--soft); }
.idcard-head { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; font-size: 14px; color: var(--text); }
.idcard-spark { color: var(--brand); font-size: 14px; }
.idcard-step { margin-left: auto; padding: 1px 8px; border-radius: 999px; background: var(--tint); color: var(--brand); font-size: 10.5px; font-weight: 600; }
.idbtn-scan { width: 100%; min-height: 46px; margin-top: 12px; border-radius: 14px; background: var(--soft-2); color: var(--text); font-size: 14px; font-weight: 600; }
.idbtn-scan:disabled { opacity: .5; }
.idbtn-scan:active { opacity: .8; }

.idsec { display: flex; align-items: center; gap: 10px; margin: 20px 0 2px; font-size: 15px; font-weight: 600; color: var(--text); }
.idsec-line { flex: 1; height: 1px; background: var(--line); }
/* 一个字段 = 标签 + 控件 + 说明，整块包住 —— 说明才不会"跑到"下一个标签底下 */
.idfield { margin-top: 14px; }
.idlab { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: var(--text); }
.idopt { margin-left: 4px; padding: 1px 6px; border-radius: 6px; background: var(--soft); color: var(--muted); font-size: 10.5px; font-weight: 500; }
.idinput { width: 100%; min-height: 46px; padding: 0 13px; border: 1px solid var(--line); border-radius: 13px; outline: none; background: var(--field); color: var(--text); font-size: 15px; }
.idinput::placeholder { color: var(--muted); }
.idinput:focus { border-color: var(--brand); }
.idnote { margin: 6px 0 0; font-size: 11.5px; line-height: 1.55; color: var(--muted); }

.idselectwrap { position: relative; }  /* 只此一处定位，见上面的类名说明 */
.idselect { width: 100%; min-height: 46px; padding: 0 40px 0 13px; border: 1px solid var(--line); border-radius: 13px; outline: none; background: var(--field); color: var(--text); font-size: 15px; appearance: none; -webkit-appearance: none; }
.idcaret { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 14px; pointer-events: none; }

.idseg { display: flex; gap: 8px; }
.idseg button { flex: 1; min-height: 46px; border: 1px solid transparent; border-radius: 13px; background: var(--field); color: var(--text); font-size: 14px; font-weight: 600; }
.idseg button.on { border-color: var(--brand); background: var(--tint); color: var(--brand); }

.idhint { margin-top: 14px; padding: 10px 12px; border-radius: 12px; background: var(--tint); color: var(--brand); font-size: 12.5px; line-height: 1.6; }
.idhint.bad { background: rgba(255, 59, 48, .10); color: var(--danger); }
.idpreview { margin-top: 10px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 11.5px; color: var(--muted); }
.idpreview code { display: block; margin-top: 3px; color: var(--text); word-break: break-all; font-size: 11.5px; }
.idok { margin-top: 10px; padding: 9px 12px; border-radius: 12px; background: var(--tint); color: var(--brand); font-size: 12.5px; line-height: 1.6; }
.idwarn { margin-top: 10px; padding: 10px 12px; border-radius: 12px; background: rgba(255, 159, 10, .14); color: #8A5A00; font-size: 12.5px; line-height: 1.6; }
/* 顶部那两条（说明/结论）在字段之前出现，边距与字段拉开一点，别贴着抓手条 */
.idok-top, .idwarn-top { margin: 0 0 14px; }
/* 行内那条"这个类型还没做"跟着提示一起出现，别再往上加一截边距 */
.idwarn-inline { margin-top: 10px; }
:root[data-theme='dark'] .idwarn { background: rgba(255, 159, 10, .18); color: #FFC46B; }
/* 从网址推断出类型时那句提示：用品牌色强调一下，告诉用户"下拉是我帮你选的" */
.idnote-infer { color: var(--brand); }

.idactions { display: flex; gap: 10px; margin-top: 10px; }
.idbtn-cancel, .idbtn-add { flex: 1; min-height: 48px; border-radius: 15px; font-size: 15px; font-weight: 600; }
.idbtn-cancel { background: var(--soft); color: var(--text); }
.idbtn-add { background: var(--brand); color: #fff; }
.idbtn-add:disabled { opacity: .45; }
.idbtn-add:active, .idbtn-cancel:active { opacity: .82; }
/* 次级动作：给个底色，别让它看起来像一行说明文字 */
.idbtn-save { width: 100%; min-height: 44px; margin-top: 10px; border-radius: 14px; background: var(--soft); color: var(--brand); font-size: 13.5px; font-weight: 500; }
.idbtn-save:disabled { background: transparent; color: var(--muted); opacity: .7; font-weight: 400; }
.idbtn-save:active:not(:disabled) { background: var(--pressed); }
</style>
