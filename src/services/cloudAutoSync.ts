/**
 * v2.45：账号模式的**自动同步** —— "像普通 App 那样，改完自己就传上去了"。
 *
 * 设计要点（都是踩过的坑换来的）：
 *  1) **防抖**：改课表往往连着好几次 saveData（增删一条就保存一次），15 秒内的多次变更合成一次上传；
 *  2) **指纹比对**：上传前先算 sha256，和上次成功上传的指纹一样就直接跳过 —— 点来点去不会反复传同一份；
 *  3) **不阻塞保存**：saveData 只发一个信号（`db.onDataChanged`），打包/上传都在这里异步做，失败不影响本机数据；
 *  4) **不偷偷烧流量**：包体超过 `AUTO_MAX_BYTES` 就不自动传，只提示"请手动上传"；
 *  5) **可以被关掉**：设置项 `cloudAutoSync` 默认开，用户关了就不再请求（与天气开关同一套口径）。
 *
 * 本模块**不 import store**：`initCloudAutoSync(db)` 由 App.vue 传入 store，
 * 免得 `stores/db.ts ⇄ services/backup.ts` 那类循环依赖再出现。
 */
import { sha256 } from '@noble/hashes/sha256';
import { ref } from 'vue';
import type { Account } from '../types.ts';
import type { CloudAccountSession } from './account.ts';
import { accountUpload } from './account.ts';
import { exportBackup } from './backup.ts';
import { useDb } from '../stores/db.ts';

export type AutoSyncState = 'off' | 'idle' | 'syncing' | 'ok' | 'skipped' | 'error';

export interface AutoSyncStatus {
  state: AutoSyncState;
  at: number;
  message: string;
}

/** 超过这个体积就不自动传（比赛作品里的照片可能几 MB，别在流量上给用户惊喜） */
export const AUTO_MAX_BYTES = 12 * 1024 * 1024;
/** 15 秒内的连续变更合成一次上传（与"防抖"同义，测试里会用更短的间隔） */
export const AUTO_DEBOUNCE_MS = 15_000;

export interface AutoSyncDeps {
  /** 打包当前账号的数据（离线也能用；失败就当这次没触发） */
  build(): Promise<Uint8Array>;
  session(): CloudAccountSession | null;
  enabled(): boolean;
  upload(session: CloudAccountSession, bytes: Uint8Array): Promise<{ updatedAt: string; size: number }>;
  /** 上传成功：把时间/大小/指纹写回设置，供界面显示和下次比对 */
  onUploaded(meta: { updatedAt: string; size: number }, fingerprint: string): void;
  onStatus(status: AutoSyncStatus): void;
  /** 上次成功上传的指纹（持久化在设置里，重启后不用重传同一份） */
  lastFingerprint(): string;
  debounceMs?: number;
  now?: () => number;
}

export function fingerprintOf(bytes: Uint8Array): string {
  const digest = sha256(bytes);
  let out = '';
  for (const b of digest) out += b.toString(16).padStart(2, '0');
  return out;
}

export interface AutoSyncRunner {
  /** 数据变更了：防抖后就上传（未登录/关了开关时什么都不做） */
  onDataChanged(): void;
  /** 立刻同步一次；force=true 时忽略指纹（手动"上传到云端"用） */
  flush(force?: boolean): Promise<AutoSyncStatus>;
  stop(): void;
  status(): AutoSyncStatus;
}

export function createAutoSync(d: AutoSyncDeps): AutoSyncRunner {
  const now = d.now || (() => Date.now());
  const debounceMs = d.debounceMs ?? AUTO_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let rerun = false;
  let current: AutoSyncStatus = { state: d.session() ? 'idle' : 'off', at: 0, message: '' };

  function set(state: AutoSyncState, message: string): void {
    current = { state, at: now(), message };
    try { d.onStatus(current); } catch { /* 界面回调出错不影响同步 */ }
  }

  async function flush(force = false): Promise<AutoSyncStatus> {
    const session = d.session();
    if (!session) { set('off', '未登录云端账号'); return current; }
    if (!d.enabled() && !force) { set('off', '自动同步已关闭'); return current; }
    if (running) { rerun = true; return current; }   // 正在传：把这次标记成"传完再来一次"
    running = true;
    set('syncing', '正在同步…');
    try {
      let bytes: Uint8Array;
      try { bytes = await d.build(); }
      catch (e: any) { set('error', '打包失败：' + (e?.message || '未知原因')); return current; }
      if (bytes.length > AUTO_MAX_BYTES) {
        set('skipped', '数据 ' + Math.round(bytes.length / 1024 / 1024) + ' MB，超过自动同步上限，请手动上传');
        return current;
      }
      const fingerprint = fingerprintOf(bytes);
      if (!force && fingerprint === d.lastFingerprint()) { set('ok', '已是最新（无需上传）'); return current; }
      const meta = await d.upload(session, bytes);
      d.onUploaded(meta, fingerprint);
      set('ok', '已同步 · ' + Math.round(meta.size / 1024) + ' KB');
    } catch (e: any) {
      set('error', e?.message || '自动同步失败');
    } finally {
      running = false;
      if (rerun) { rerun = false; void flush(false); }
    }
    return current;
  }

  function onDataChanged(): void {
    if (!d.session() || !d.enabled()) return;   // 关着的时候一次请求都不发（与天气开关同一口径）
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void flush(false); }, debounceMs);
  }

  function stop(): void {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  return { onDataChanged, flush, stop, status: () => current };
}

/* ------------------------- 与 App 绑定的单例 ------------------------- */

let runner: AutoSyncRunner | null = null;
let wired = false;

/** 界面直接绑这个（「我的 → 加密换机同步」里那行状态） */
export const autoSyncState = ref<AutoSyncStatus>({ state: 'off', at: 0, message: '自动同步未启动' });

export function autoSyncStatus(): AutoSyncStatus {
  return runner ? runner.status() : autoSyncState.value;
}

/** 手动"上传当前数据到云端"也走同一条路（force 忽略指纹），保证两边口径一致 */
export async function syncNow(): Promise<AutoSyncStatus> {
  if (!runner) return { state: 'off', at: 0, message: '自动同步未启动' };
  return runner.flush(true);
}

/** 由 App.vue 在挂载时调用一次（幂等） */
export function initCloudAutoSync(db = useDb()): AutoSyncRunner {
  if (runner && wired) return runner;
  const runnerNew = createAutoSync({
    // v2.50：自动同步上传的是"换机范围"的备份 —— 只有课表/记事/设置，不含二课记录与照片
    build: () => exportBackup(db.profile!.schoolId, db.profile!.name, db.session!.username,
      'schools/' + db.profile!.schoolId + '/users/' + db.session!.accountId,
      db.accounts as Account[], db.session!.accountId, 'study').then((r) => r.bytes),
    session: () => (db.settings.cloudAccount as CloudAccountSession | null) || null,
    enabled: () => db.settings.cloudAutoSync !== false,
    upload: (session, bytes) => accountUpload(session, bytes),
    onUploaded: (meta, fingerprint) => {
      const session = db.settings.cloudAccount;
      if (!session) return;
      db.settings.cloudAccount = { ...session, updatedAt: meta.updatedAt, size: meta.size, lastHash: fingerprint };
      void db.saveData();
    },
    onStatus: (s) => { autoSyncState.value = s; },
    lastFingerprint: () => db.settings.cloudAccount?.lastHash || ''
  });
  runner = runnerNew;
  if (!wired) {
    db.onDataChanged(() => runnerNew.onDataChanged());
    wired = true;
  }
  return runnerNew;
}

/** 仅供测试：清掉单例（真实运行不需要） */
export function resetCloudAutoSyncForTest(): void {
  runner?.stop();
  runner = null;
  wired = false;
}
