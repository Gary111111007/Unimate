<script setup lang="ts">
// ============================================================================
// 北化通 —— 校园服务一站式聚合入口（PRD 第三栏）
// 本app为果崇舜，刘佳乐，赵梓缘三人共同开发，未经允许，不得擅自使用。
// ============================================================================
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { JwWebView, isNativeWebView } from '../services/jwwebview.ts';
import ExamPanel from './ExamPanel.vue';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import type { CampusApp } from '../types.ts';

const db = useDb();
const status = ref('');
const p = () => db.profile!;
const showIcons = ref(false);

/** 内置条目被长按改过的，用 appEdits 覆盖显示；自定义条目直接改本体。 */
function merged(a: CampusApp): CampusApp {
  const e = (db.settings.appEdits || {})[a.key];
  return e ? { ...a, ...e } : a;
}
const customKeys = computed(() => new Set((db.settings.customApps || []).map((a) => a.key)));
const hiddenKeys = computed(() => db.settings.hiddenApps || []);

/** 顺序由 appOrder 决定；没排过的按档案默认顺序排在后面。被删除的不显示。 */
const apps = computed<CampusApp[]>(() => {
  const all = [...(p().campusApps || []), ...(db.settings.customApps || [])].map(merged);
  const hidden = new Set(hiddenKeys.value);
  const order = db.settings.appOrder || [];
  const rank = (k: string) => { const ix = order.indexOf(k); return ix < 0 ? order.length + 1 : ix; };
  return all.filter((a) => !hidden.has(a.key)).sort((a, b) => rank(a.key) - rank(b.key));
});

const showAdd = ref(false);
/** 考试查询面板（两条路径：教务系统真实抓取 / 内置演示样本） */
const showExam = ref(false);
const examUrl = ref('');
const nf = ref({ name: '', url: '', icon: '🔗', iconData: '' });

function normUrl(u: string): string {
  const s = u.trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}
function validUrl(u: string): boolean { return /^https?:\/\/[^\s.]+\.[^\s]{2,}$/.test(u); }

async function openTarget(a: CampusApp): Promise<void> {
  if (a.action === 'exam') { examUrl.value = a.url; showExam.value = true; return; }
  status.value = '正在打开 ' + a.name + '…';
  if (!isNativeWebView()) {
    status.value = '桌面预览环境不支持内嵌 WebView；安装 APK 后可在 App 内直接打开。';
    return;
  }
  const r = await JwWebView.open({ url: a.url, title: a.name, allowExternal: true });
  status.value = r.ok
    ? a.name + ' 已关闭。'
    : (r.reason === 'cancelled' ? '已关闭' : '打开失败：' + (r.reason || '未知'));
  void probeOne(a);
}

/** 预设图标：覆盖校园常见服务，省得用户自己想 emoji。 */
const ICON_CHOICES = ['🔗','🏛','','🧭','','🏫','','💳','🚌','🏠','','','','💼','','','','🎯','','','','🎬','','','','','🏀','🚿','','🩺','📊','🗂'];
function iconTarget(): { icon: string; iconData: string } | null { return editing.value ? editing.value : nf.value as any; }

async function pickIcon(): Promise<void> {
  try {
    const ph = await Camera.getPhoto({
      quality: 70, width: 128, height: 128,
      resultType: CameraResultType.DataUrl, source: CameraSource.PhotosLibrary, correctOrientation: true
    });
    if (ph && ph.dataUrl) {
      const t = iconTarget(); if (!t) return;
      t.iconData = ph.dataUrl;
      db.notify('图标已换成你上传的图片');
    }
  } catch { /* 用户取消，不算错误 */ }
}
function clearIcon(): void { const t = iconTarget(); if (t) t.iconData = ''; }

async function addApp(): Promise<void> {
  const name = nf.value.name.trim();
  const url = normUrl(nf.value.url);
  if (!name) { db.notify('请填写入口名称'); return; }
  if (!validUrl(url)) { db.notify('网址格式不对，例：tygl.buct.edu.cn'); return; }
  const key = 'u' + Date.now();
  db.settings.customApps.push({
    key, name, url, icon: (nf.value.icon || '').trim() || '🔗',
    desc: '我自己添加的入口', builtin: false, iconData: nf.value.iconData || undefined
  });
  db.settings.appOrder = [...(db.settings.appOrder || []), key];   // 新加的排到最后，位置可再调
  await db.saveData();
  nf.value = { name: '', url: '', icon: '🔗', iconData: '' };
  showAdd.value = false;
  db.notify('已添加，只存在你这台手机上');
}

// ---------- 长按进入拖动排序：拖到上方面板改信息，拖到下方面板删除 ----------
const dragging = ref<CampusApp | null>(null);
const dragDX = ref(0); const dragDY = ref(0);
const overZone = ref<'' | 'edit' | 'del'>('');
const overKey = ref('');
let lpTimer: number | null = null;
let lpFired = false;
let originX = 0; let originY = 0;
let curX = 0; let curY = 0;
const editZone = ref<HTMLElement | null>(null);
const delZone = ref<HTMLElement | null>(null);
const dragEls = new Map<string, HTMLElement>();

function setDragEl(k: string, el: Element | null): void {
  if (el) dragEls.set(k, el as HTMLElement); else dragEls.delete(k);
}
function inZone(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function lpStart(a: CampusApp, e: TouchEvent): void {
  lpFired = false;
  const t = e.touches[0];
  curX = originX = t.clientX; curY = originY = t.clientY;
  lpTimer = window.setTimeout(() => {
    lpFired = true;
    dragging.value = a;
    // 以"当前指尖"而不是"按下时"为基准，否则长按到进入拖动之间的那点位移会让卡片突然跳一下
    originX = curX; originY = curY;
    dragDX.value = 0; dragDY.value = 0;
    overZone.value = ''; overKey.value = '';
    if (navigator.vibrate) { try { navigator.vibrate(18); } catch { /* 不支持就算了 */ } }
  }, 380);
}
function lpCancel(): void { if (lpTimer !== null) { clearTimeout(lpTimer); lpTimer = null; } }

function onDragMove(e: TouchEvent): void {
  curX = e.touches[0].clientX; curY = e.touches[0].clientY;
  if (!dragging.value) return;
  const t = e.touches[0];
  dragDX.value = t.clientX - originX;
  dragDY.value = t.clientY - originY;
  overZone.value = inZone(editZone.value, t.clientX, t.clientY) ? 'edit'
    : inZone(delZone.value, t.clientX, t.clientY) ? 'del' : '';
  // 不在拖动过程中实时换位（那样列表会在手指底下乱跳，手感很差）；
  // 只记下手指压在谁身上，松手时一次性落位。
  if (!overZone.value) {
    const under = document.elementsFromPoint(t.clientX, t.clientY)
      .map((el) => (el as HTMLElement).closest('[data-akind]') as HTMLElement | null)
      .find((el) => el && el.dataset.akind !== dragging.value!.key);
    overKey.value = under ? (under.dataset.akind || '') : '';
  }
  e.preventDefault();
}

function reorderFrom(dragKey: string, dropKey: string): void {
  const keys = apps.value.map((x) => x.key);
  const from = keys.indexOf(dragKey);
  const to = keys.indexOf(dropKey);
  if (from < 0 || to < 0 || from === to) return;
  keys.splice(to, 0, keys.splice(from, 1)[0]);
  db.settings.appOrder = keys;
}


async function onDragEnd(): Promise<void> {
  lpCancel();
  const a = dragging.value;
  if (!a) return;
  const zone = overZone.value;
  const target = overKey.value;
  dragging.value = null; overZone.value = ''; overKey.value = '';
  dragDX.value = 0; dragDY.value = 0;
  // 落在两个投放区里就只做对应操作，**不动排序**；只有落在空白/卡片上才换位置
  if (zone === 'edit') { openEdit(a); return; }
  if (zone === 'del') { await askDelete(a); return; }
  if (target) {
    reorderFrom(a.key, target);
    await db.saveData();
    db.notify('已把「' + a.name + '」放到「' + (apps.value.find((x) => x.key === target)?.name || '') + '」的位置');
  } else {
    await db.saveData();
  }
}
function onTap(a: CampusApp): void {
  if (lpFired) { lpFired = false; return; }
  void openTarget(a);
}
function isFirst(k: string): boolean { return apps.value[0]?.key === k; }
function isLast(k: string): boolean { return apps.value[apps.value.length - 1]?.key === k; }

async function move(a: CampusApp, dir: -1 | 1): Promise<void> {
  const keys = apps.value.map((x) => x.key);
  const i = keys.indexOf(a.key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return;
  keys.splice(j, 0, keys.splice(i, 1)[0]);
  db.settings.appOrder = keys;
  await db.saveData();
}

// ---------- 删除：两步确认，防误触 ----------

async function askDelete(a: CampusApp): Promise<void> {
  const mine = customKeys.value.has(a.key);
  const ok = await db.confirm({
    title: '确认删除此板块？',
    body: a.name + '｜' + a.url,
    detail: mine ? '这是你自己添加的入口，删除后不可恢复。' : '内置入口删除后仍可在页面上方「恢复全部」找回。'
  });
  if (!ok) return;
  await reallyDelete(a);
}
async function reallyDelete(a: CampusApp): Promise<void> {
  if (customKeys.value.has(a.key)) {
    db.settings.customApps = (db.settings.customApps || []).filter((x) => x.key !== a.key);
  } else {
    if (!db.settings.hiddenApps) db.settings.hiddenApps = [];
    if (!db.settings.hiddenApps.includes(a.key)) db.settings.hiddenApps.push(a.key);
    if (db.settings.appEdits) delete db.settings.appEdits[a.key];
  }
  if (db.settings.appOrder) db.settings.appOrder = db.settings.appOrder.filter((k) => k !== a.key);
  await db.saveData();
  db.notify('已删除「' + a.name + '」');
}
async function restoreHidden(): Promise<void> {
  db.settings.hiddenApps = [];
  await db.saveData();
  db.notify('已恢复全部内置入口');
}

// ---------- 编辑信息 ----------
const editing = ref<CampusApp | null>(null);
const editingBuiltin = ref(false);
function openEdit(a: CampusApp): void {
  editing.value = { ...a };
  editingBuiltin.value = !customKeys.value.has(a.key);
  showIcons.value = false;
}
async function saveEdit(): Promise<void> {
  const e = editing.value; if (!e) return;
  const url = normUrl(e.url);
  if (!e.name.trim()) { db.notify('名称不能为空'); return; }
  if (!validUrl(url)) { db.notify('网址格式不对，例：tygl.buct.edu.cn'); return; }
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
  // 恢复默认会丢掉用户自己改过的名称/图标/说明，按"删除类操作一律二次确认"处理
  const ok = await db.confirm({
    title: '放弃你对这个入口的自定义？',
    body: '恢复默认后，你改过的名称、图标和说明会丢失。',
    detail: '网站地址会回到学校档案里的默认值；不会删除这个入口本身。',
    confirmText: '放弃自定义'
  });
  if (!ok) return;
  if (db.settings.appEdits) delete db.settings.appEdits[e.key];
  await db.saveData();
  editing.value = null;
  db.notify('已恢复默认名称与信息');
}

// ---------- 登录态诊断 ----------
const cookieMap = ref<Record<string, string>>({});
async function probeOne(a: CampusApp): Promise<void> {
  if (!isNativeWebView()) return;
  try {
    const r = await JwWebView.cookieProbe({ url: a.url });
    cookieMap.value[a.key] = r.present ? r.count + ' 条' : '无';
  } catch { cookieMap.value[a.key] = '未知'; }
}
async function probeAll(): Promise<void> {
  if (!isNativeWebView()) { db.notify('桌面预览环境无法检测 Cookie'); return; }
  for (const a of apps.value) await probeOne(a);
  db.notify('检测完成。「无」表示本机没有该站 Cookie');
}
</script>

<template>
  <div class="scroll">
    <div class="card hero">
      <div class="title">{{ p().tabs.online }}</div>
      <div class="small">把{{ p().shortName }}要用的东西收在一页里。<b>长按并拖动</b>可换位置，拖到上方改信息、拖到下方删除。</div>
    </div>

    <div class="secrow">
      <span class="seclabel">校园服务（{{ apps.length }}）</span>
      <div class="row" style="gap: 6px">
        <button class="btn sm ghost" @click="showAdd = !showAdd">{{ showAdd ? '收起' : '＋ 添加' }}</button>
        <button class="btn sm ghost" @click="probeAll">查登录态</button>
      </div>
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
          <button v-for="ic in ICON_CHOICES" :key="ic" class="ichip" :class="{ on: !nf.iconData && nf.icon === ic }" @click="nf.icon = ic; nf.iconData = ''">{{ ic }}</button>
        </div>
      </div>
      <button class="btn block sm" @click="addApp">保存到本机</button>
      <div class="small muted" style="margin-top: 6px">自定义入口只写进你手机的本地文件，不上传、不联网。</div>
    </div>

    <div class="grid">
      <div v-for="a in apps" :key="a.key" class="app" :data-akind="a.key"
           :class="{ mine: customKeys.has(a.key), edited: !!cookieMap[a.key], dragging: dragging?.key === a.key, drop: !!dragging && overKey === a.key && dragging.key !== a.key }"
           :style="dragging?.key === a.key ? { transform: 'translate3d(' + dragDX + 'px,' + dragDY + 'px,0)' } : {}"
           @click="onTap(a)" @touchstart="lpStart(a, $event)" @touchend="onDragEnd" @touchmove="onDragMove" @touchcancel="onDragEnd" @contextmenu.prevent>
        <span v-if="customKeys.has(a.key)" class="tag-mine">我的</span>
        <span v-else-if="(db.settings.appEdits || {})[a.key]" class="tag-edited">已改</span>
        <img v-if="a.iconData" :src="a.iconData" class="icoimg" alt="" />
        <span v-else class="ico">{{ a.icon }}</span>
        <div class="an">{{ a.name }}</div>
        <div class="ad">{{ a.desc }}</div>
        <div v-if="cookieMap[a.key]" class="ck" :class="{ has: cookieMap[a.key] !== '无' }">Cookie {{ cookieMap[a.key] }}</div>
      </div>
    </div>

    <div v-if="hiddenKeys.length" class="card small" style="margin-top: 10px">
      <div class="row" style="justify-content: space-between">
        <span>已删除 {{ hiddenKeys.length }} 个内置入口</span>
        <button class="btn sm ghost" @click="restoreHidden">恢复全部</button>
      </div>
    </div>

    <div v-if="status" class="card small" style="margin-top: 10px">{{ status }}</div>

    <div class="card" style="margin-top: 10px">
      <div class="bold small" style="margin-bottom: 6px">关于登录状态</div>
      <div class="small muted" style="line-height: 1.75">
        · 这些站点大多会跳到学校统一身份认证。App 内登录后，<b style="color:#3A424E">Cookie 会在页面加载完成时立即写入本机</b>，
          并在你切到后台、退出界面时再各刷一次盘。<br />
        · 点右上角「查登录态」可以看到本机当前为每个站点保存了几条 Cookie。
          显示"无"意味着要么从未在此登录，要么<b style="color:#3A424E">学校把会话设成了不落盘的临时 Cookie</b>。<br />
        · 本 App 不保存、也读不到你的账号密码：不代填表单、不读取输入框、不导出 Cookie 内容（诊断只统计条数）。<br />
        · 企业微信必须用它自己的 App（设备级认证，内嵌网页登不上），所以没有列进来。
      </div>
    </div>

    <!-- 拖动时浮现的两个投放区 -->
    <div v-if="dragging" ref="editZone" class="zone zedit" :class="{ on: overZone === 'edit' }">拖到这里：更改信息</div>
    <div v-if="dragging" ref="delZone" class="zone zdel" :class="{ on: overZone === 'del' }">拖到这里：删除此板块</div>
    <div v-if="dragging" class="dragtip">正在拖动「{{ dragging.name }}」· 松手放到目标卡片上即换位置，拖到上/下方面板可改信息或删除</div>
    <!-- 编辑信息 -->
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
            <button v-for="ic in ICON_CHOICES" :key="ic" class="ichip" :class="{ on: !editing.iconData && editing.icon === ic }" @click="editing.icon = ic; editing.iconData = ''">{{ ic }}</button>
          </div>
        </div>
        <div class="small muted" style="margin-bottom: 8px">改动只影响本机显示，不上传、不联网，也不会改变学校网站本身。</div>
        <div class="row" style="gap: 8px">
          <button v-if="editingBuiltin" class="btn grey grow" @click="revertEdit">恢复默认</button>
          <button class="btn grow" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>
  </div>

  <ExamPanel v-if="showExam" :start-url="examUrl" @close="showExam = false" />
</template>

<style scoped>
.zone { position: fixed; left: 0; right: 0; z-index: 130; height: 74px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; color: #fff; border-radius: 0; }
.zedit { top: 0; padding-top: var(--safe-t); background: rgba(46, 90, 172, .93); }
.zdel { bottom: 0; padding-bottom: var(--safe-b); background: rgba(176, 67, 59, .93); }
.zone.on { outline: 3px solid #FFD37A; outline-offset: -6px; }
.dragtip { position: fixed; left: 50%; transform: translateX(-50%); top: 50%; z-index: 131; background: rgba(16,24,38,.9); color: #fff; font-size: 12px; padding: 7px 12px; border-radius: 999px; pointer-events: none; white-space: nowrap; }
.app.dragging { z-index: 140; position: relative; box-shadow: 0 12px 28px rgba(0,0,0,.34); opacity: .97; transition: none; will-change: transform; transform-origin: center; }
.app.drop { outline: 2px solid var(--brand); outline-offset: -2px; }

.grid { position: relative; }
.hero { background: linear-gradient(140deg, #2E5AAC, #3E6FBF); color: #fff; }
.hero .title { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
.hero .small { color: rgba(255, 255, 255, .82); font-size: 12.5px; line-height: 1.6; }
.secrow { display: flex; align-items: center; justify-content: space-between; margin: 14px 2px 8px; }
.seclabel { font-size: 13px; font-weight: 700; color: var(--ink); }
.addbox { padding: 12px; }
.addbox .field { margin-bottom: 10px; }
.addbox label, .sheet label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
.addbox input, .sheet input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--field); font-size: 14px; }
.tip { font-size: 11.5px; color: var(--muted); margin: 2px 2px 8px; }
.tag-edited, .tag-mine { position: absolute; top: 5px; left: 6px; font-size: 9px; border-radius: 5px; padding: 1px 4px; }
.tag-edited { color: #7A6A1F; background: #FFF3C4; }
.tag-mine { color: #fff; background: #8A93A3; left: auto; right: 24px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.app { position: relative; background: var(--card); border-radius: 14px; padding: 14px 8px 12px; text-align: center; box-shadow: var(--shadow); user-select: none; -webkit-touch-callout: none; -webkit-user-select: none; }
.app:active { transform: scale(.97); }
.app.mine { border: 1px dashed #B9C9E8; }
.ico { font-size: 26px; line-height: 1.2; }
.an { font-size: 13px; font-weight: 700; margin-top: 6px; color: var(--ink); }
.ad { font-size: 10.5px; color: var(--muted); margin-top: 2px; line-height: 1.35; }
.ck { font-size: 9.5px; margin-top: 4px; color: #B0433B; }
.ck.has { color: #2FA35C; }
.del { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; border: none; background: var(--soft); color: var(--muted); font-size: 14px; line-height: 1; }
.iconbar { display: flex; align-items: center; gap: 8px; }
.preview { width: 46px; height: 46px; border-radius: 12px; background: var(--soft); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; flex: none; }
.prevemoji { font-size: 24px; }
.icoimg { width: 30px; height: 30px; border-radius: 9px; object-fit: cover; background: var(--soft); }
.icoimg.big { width: 42px; height: 42px; border-radius: 10px; }
.icongrid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin-top: 10px; max-height: 132px; overflow: auto; }
.ichip { font-size: 19px; padding: 5px 0; border-radius: 9px; border: 1px solid var(--line); background: var(--card); }
.ichip.on { border-color: var(--brand); background: var(--tint); }
.mask { position: fixed; inset: 0; z-index: 110; background: rgba(8,12,20,.46); display: flex; align-items: flex-end; }
.sheet { width: 100%; max-height: 88vh; overflow: auto; background: var(--card); border-radius: 18px 18px 0 0; padding: 14px 14px calc(16px + var(--safe-b)); }
.sheet .title { font-size: 16px; font-weight: 700; }
.sheet .field { margin-bottom: 11px; }
.hairline { height: 1px; background: var(--line); margin: 10px 0 12px; }
.sect { font-size: 12px; font-weight: 700; color: var(--muted); margin: 16px 0 8px; }
.sect.danger { color: #B0433B; }
</style>
