<script setup lang="ts">
// ============================================================================
// 北化通 —— 校园服务一站式聚合入口（PRD 第三栏）
// 本 App 由 果崇舜 / 刘佳乐 / 赵梓缘 三人共同开发，未经允许，不得擅自使用。
// ============================================================================
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { JwWebView, isNativeWebView } from '../services/jwwebview.ts';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import type { CampusApp } from '../types.ts';

const db = useDb();
const status = ref('');
const p = () => db.profile!;
/** 内置条目被长按改过的，用 appEdits 覆盖；自定义条目直接改本体。 */
function merged(a: CampusApp): CampusApp {
  const e = (db.settings.appEdits || {})[a.key];
  return e ? { ...a, ...e } : a;
}
const builtin = computed<CampusApp[]>(() => (p().campusApps || []).map(merged));
const custom = computed<CampusApp[]>(() => (db.settings.customApps || []).map(merged));

const editedKeys = computed<Set<string>>(() => new Set(Object.keys(db.settings.appEdits || {})));

// ---------- 长按编辑 ----------
const editing = ref<CampusApp | null>(null);
const editingBuiltin = ref(false);
let lpTimer: number | null = null;
let lpFired = false;

function openEdit(a: CampusApp, isB: boolean): void { editing.value = { ...a }; editingBuiltin.value = isB; showIcons.value = false; }
function lpStart(a: CampusApp, isB: boolean): void {
  lpFired = false;
  lpTimer = window.setTimeout(() => { lpFired = true; openEdit(a, isB); }, 500);
}
function lpCancel(): void { if (lpTimer !== null) { clearTimeout(lpTimer); lpTimer = null; } }
function onTap(a: CampusApp, isB: boolean): void {
  if (lpFired) { lpFired = false; return; }   // 长按已触发，别顺带打开页面
  void a; void isB; openTarget(a);
}

async function saveEdit(): Promise<void> {
  const e = editing.value; if (!e) return;
  const url = normUrl(e.url);
  if (!e.name.trim()) { db.notify('名称不能为空'); return; }
  if (!/^https?:\/\/[^\s.]+\.[^\s]{2,}$/.test(url)) { db.notify('网址格式不对，例：tygl.buct.edu.cn'); return; }
  const patch: Partial<CampusApp> = {
    name: e.name.trim(), url, desc: (e.desc || '').trim(),
    icon: (e.icon || '').trim() || '🔗', iconData: e.iconData || undefined
  };
  if (editingBuiltin.value) {
    if (!db.settings.appEdits) db.settings.appEdits = {};
    db.settings.appEdits[e.key] = patch;
  } else {
    db.settings.customApps = (db.settings.customApps || []).map((x) => (x.key === e.key ? { ...x, ...patch } : x));
  }
  await db.saveData();
  editing.value = null;
  db.notify('已保存，只改本机显示，不影响学校网站本身');
}
async function revertEdit(): Promise<void> {
  const e = editing.value; if (!e) return;
  if (db.settings.appEdits) delete db.settings.appEdits[e.key];
  await db.saveData();
  editing.value = null;
  db.notify('已恢复默认名称与信息');
}

const showAdd = ref(false);
const nf = ref({ name: '', url: '', icon: '🔗', iconData: '' });

function normUrl(u: string): string {
  const s = u.trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

/** 预设图标：覆盖校园常见服务，省得用户自己想 emoji。 */
const ICON_CHOICES = ['🔗','🏛','📚','🧭','','🏫','','💳','🚌','🏠','','📝','','💼','','⚙','','🎯','','🧪','','🎬','🛒','','📺','','🏀','🚿'];
const showIcons = ref(false);

/** 用系统相机/相册挑一张图当图标。原生会按 width/height 缩放，再压一次质量，控制在几 KB。 */
async function pickIcon(): Promise<void> {
  try {
    const ph = await Camera.getPhoto({
      quality: 70, width: 128, height: 128,
      resultType: CameraResultType.DataUrl, source: CameraSource.Prompt, correctOrientation: true
    });
    if (ph && ph.dataUrl) {
      if (editing.value) editing.value.iconData = ph.dataUrl; else nf.value.iconData = ph.dataUrl;
      db.notify('图标已换成你上传的图片');
    }
  } catch { /* 用户取消，不算错误 */ }
}
function clearIcon(): void { if (editing.value) editing.value.iconData = ''; else nf.value.iconData = ''; }
async function openTarget(a: CampusApp): Promise<void> {
  status.value = '正在打开 ' + a.name + '…';
  if (!isNativeWebView()) {
    status.value = '桌面预览环境不支持内嵌 WebView；安装 APK 后可在 App 内直接打开，登录状态由本机自动保持。';
    return;
  }
  const r = await JwWebView.open({ url: a.url, title: a.name, allowExternal: true });
  status.value = r.ok
    ? a.name + ' 已关闭。登录状态保存在本机 WebView 里，下次进来还是登录的。'
    : (r.reason === 'cancelled' ? '已关闭' : '打开失败：' + (r.reason || '未知'));
}

async function addApp(): Promise<void> {
  const name = nf.value.name.trim();
  const url = normUrl(nf.value.url);
  if (!name) { db.notify('请填写入口名称'); return; }
  if (!/^https?:\/\/[^\s.]+\.[^\s]{2,}$/.test(url)) { db.notify('网址格式不对，例：tygl.buct.edu.cn'); return; }
  db.settings.customApps.push({
    key: 'u' + Date.now(), name, url,
    icon: nf.value.icon.trim() || '🔗', desc: '我自己添加的入口', builtin: false, iconData: nf.value.iconData || undefined
  });
  await db.saveData();
  nf.value = { name: '', url: '', icon: '🔗', iconData: '' };
  showAdd.value = false;
  db.notify('已添加，只存在你这台手机上');
}

async function delApp(a: CampusApp): Promise<void> {
  db.settings.customApps = (db.settings.customApps || []).filter((x) => x.key !== a.key);
  await db.saveData();
  db.notify('已移除「' + a.name + '」');
}
</script>

<template>
  <div class="scroll">
    <div class="card hero">
      <div class="title">{{ p().tabs.online }}</div>
      <div class="small">把{{ p().shortName }}要用的东西收在一页里，点开就走，不在 App 里存任何账号密码</div>
    </div>

    <div class="secrow">
      <span class="seclabel">校园服务</span>
      <button class="btn sm ghost" @click="showAdd = !showAdd">{{ showAdd ? '收起' : '＋ 添加入口' }}</button>
    </div>

    <div v-if="showAdd" class="card addbox">
      <div class="field"><label>名称</label><input v-model="nf.name" placeholder="例：一卡通充值" /></div>
      <div class="field"><label>网址</label><input v-model="nf.url" placeholder="例：card.buct.edu.cn" /></div>
      <div class="field">
        <label>图标</label>
        <div class="iconbar">
          <div class="preview">
            <img v-if="nf.iconData" :src="nf.iconData" class="icoimg big" alt="" />
            <span v-else class="prevemoji">{{ nf.icon || '🔗' }}</span>
          </div>
          <div class="grow">
            <button class="btn sm ghost block" @click="showIcons = !showIcons">{{ showIcons ? '收起预设' : '选预设图标' }}</button>
            <button class="btn sm grey block" style="margin-top: 6px" @click="pickIcon">从相册/拍照上传</button>
          </div>
          <button v-if="nf.iconData" class="btn sm danger" style="margin-left:6px" @click="clearIcon">清除</button>
        </div>
        <div v-if="showIcons" class="icongrid">
          <button v-for="ic in ICON_CHOICES" :key="ic" class="ichip" :class="{ on: !nf.iconData && nf.icon === ic }"
                  @click="nf.icon = ic; nf.iconData = ''">{{ ic }}</button>
        </div>
        <div class="small muted" style="margin-top: 6px">上传的图片会被压到 128×128 存在本机，不上传到任何服务器。</div>
      </div>

      <button class="btn block sm" @click="addApp">保存到本机</button>
      <div class="small muted" style="margin-top: 6px">自定义入口只写进你手机的本地文件，不上传、不联网；换机或清除数据即消失。</div>
    </div>

    <div class="tip">长按任意入口可改名、改网址、换图标</div>
    <div class="grid">
      <div v-for="a in builtin" :key="a.key" class="app" :class="{ edited: !!a.desc && editedKeys.has(a.key) }"
           @click="onTap(a, true)" @touchstart="lpStart(a, true)" @touchend="lpCancel" @touchmove="lpCancel" @touchcancel="lpCancel" @contextmenu.prevent>

        <img v-if="a.iconData" :src="a.iconData" class="icoimg" alt="" />
        <span v-else class="ico">{{ a.icon }}</span>
        <div class="an">{{ a.name }}</div>
        <div class="ad">{{ a.desc }}</div>
        <span v-if="editedKeys.has(a.key)" class="tag-edited">已自定义</span>
      </div>
      <div v-for="a in custom" :key="a.key" class="app mine" @click="onTap(a, false)" @touchstart="lpStart(a, false)" @touchend="lpCancel" @touchmove="lpCancel" @touchcancel="lpCancel" @contextmenu.prevent>
        <img v-if="a.iconData" :src="a.iconData" class="icoimg" alt="" />
        <span v-else class="ico">{{ a.icon }}</span>
        <div class="an">{{ a.name }}</div>
        <div class="ad">{{ a.desc }}</div>
        <span v-if="editedKeys.has(a.key)" class="tag-edited">已改</span>
        <button class="del" @click.stop="delApp(a)">×</button>
      </div>
    </div>

    <div v-if="editing" class="mask" @click.self="editing = null">
      <div class="sheet">
        <div class="row"><div class="title grow">编辑入口</div><button class="btn sm ghost" @click="editing = null">取消</button></div>
        <div class="hairline"></div>
        <div class="field"><label>名称</label><input v-model="editing.name" placeholder="显示名" /></div>
        <div class="field"><label>网址</label><input v-model="editing.url" placeholder="https://…" /></div>
        <div class="field"><label>说明</label><input v-model="editing.desc" placeholder="一句话说明，显示在名字下面" /></div>
        <div class="field">
          <label>图标</label>
          <div class="iconbar">
            <div class="preview">
              <img v-if="editing.iconData" :src="editing.iconData" class="icoimg big" alt="" />
              <span v-else class="prevemoji">{{ editing.icon || '🔗' }}</span>
            </div>
            <div class="grow">
              <button class="btn sm ghost block" @click="showIcons = !showIcons">{{ showIcons ? '收起预设' : '选预设图标' }}</button>
              <button class="btn sm grey block" style="margin-top: 6px" @click="pickIcon">从相册/拍照上传</button>
            </div>
            <button v-if="editing.iconData" class="btn sm danger" style="margin-left:6px" @click="clearIcon">清除</button>
          </div>
          <div v-if="showIcons" class="icongrid">
            <button v-for="ic in ICON_CHOICES" :key="ic" class="ichip" :class="{ on: !editing.iconData && editing.icon === ic }"
                    @click="editing.icon = ic; editing.iconData = ''">{{ ic }}</button>
          </div>
        </div>
        <div class="small muted" style="margin-bottom: 8px">改动只影响本机显示，不上传、不联网，也不会改变学校网站本身。</div>
        <div class="row" style="gap: 8px">
          <button v-if="editingBuiltin" class="btn grey grow" @click="revertEdit">恢复默认</button>
          <button class="btn grow" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>

    <div v-if="status" class="card small">{{ status }}</div>

    <div class="card" style="margin-top: 10px">
      <div class="bold small" style="margin-bottom: 6px">关于登录</div>
      <div class="small muted" style="line-height: 1.75">
        · 这些站点大多会跳到学校统一身份认证。<b style="color:#3A424E">你在 App 里登录一次，之后由系统 WebView 的 Cookie 自动保持</b>，
          退出 App、重开都还是登录状态，直到学校那边会话过期才需要再登。<br />
        · 因此本 App <b style="color:#3A424E">不保存、也读不到你的账号密码</b>：不代填表单、不读取输入框、不导出 Cookie，
          密码只存在于你与学校服务器之间的连接里。<br />
        · 企业微信必须用它自己的 App（设备级认证，内嵌网页登不上），所以没有列进来。<br />
        · 需要下载课件或播放视频时，用页面顶部「浏览器」按钮交给系统浏览器。
      </div>
    </div>

    <div class="card" style="margin-top: 10px">
      <div class="bold small" style="margin-bottom: 6px">说明</div>
      <div class="small muted" style="line-height: 1.7">
        · 以上站点均由{{ p().name }}运营，Unimate 只做跳转入口，不代理任何数据。<br />
        · 内置地址均为人工核实过的学校域名；没收录的服务你可以自己添加。<br />
        · 本栏名称由高校档案决定：北化为「北化通」，其他高校接入后显示各自名称。
      </div>
    </div>
  </div>
</template>

<style scoped>
.tip { font-size: 11.5px; color: var(--muted); margin: 2px 2px 8px; }
.tag-edited { position: absolute; top: 5px; left: 6px; font-size: 9px; color: #7A6A1F; background: #FFF3C4; border-radius: 5px; padding: 1px 4px; }
.app { user-select: none; -webkit-touch-callout: none; -webkit-user-select: none; }
.mask { position: fixed; inset: 0; z-index: 110; background: rgba(8,12,20,.46); display: flex; align-items: flex-end; }
.sheet { width: 100%; max-height: 86vh; overflow: auto; background: #fff; border-radius: 18px 18px 0 0; padding: 14px 14px calc(16px + var(--safe-b)); }
.sheet .title { font-size: 16px; font-weight: 700; }
.sheet .field { margin-bottom: 11px; }
.sheet .field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
.sheet .field input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #FBFCFE; font-size: 14px; }
.hairline { height: 1px; background: var(--line); margin: 10px 0 12px; }
.hero { background: linear-gradient(140deg, #2E5AAC, #3E6FBF); color: #fff; }
.hero .title { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
.hero .small { color: rgba(255, 255, 255, .82); font-size: 12.5px; line-height: 1.6; }
.secrow { display: flex; align-items: center; justify-content: space-between; margin: 14px 2px 8px; }
.seclabel { font-size: 13px; font-weight: 700; color: var(--ink); }
.addbox { padding: 12px; }
.addbox .field { margin-bottom: 10px; }
.addbox label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
.addbox input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #FBFCFE; font-size: 14px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.app { position: relative; background: #fff; border-radius: 14px; padding: 14px 8px 12px; text-align: center; box-shadow: var(--shadow); }
.app:active { transform: scale(.97); }
.app.mine { border: 1px dashed #B9C9E8; }
.iconbar { display: flex; align-items: center; gap: 8px; }
.preview { width: 46px; height: 46px; border-radius: 12px; background: #F4F7FC; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; flex: none; }
.prevemoji { font-size: 24px; }
.icoimg { width: 30px; height: 30px; border-radius: 9px; object-fit: cover; background: #F4F7FC; }
.icoimg.big { width: 42px; height: 42px; border-radius: 10px; }
.icongrid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin-top: 10px; max-height: 132px; overflow: auto; }
.ichip { font-size: 19px; padding: 5px 0; border-radius: 9px; border: 1px solid var(--line); background: #fff; }
.ichip.on { border-color: var(--brand); background: #EDF3FF; }
.ico { font-size: 26px; line-height: 1.2; }
.an { font-size: 13px; font-weight: 700; margin-top: 6px; color: var(--ink); }
.ad { font-size: 10.5px; color: var(--muted); margin-top: 2px; line-height: 1.35; }
.del { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; border: none; background: #F1F3F7; color: #8A93A3; font-size: 14px; line-height: 1; }
</style>