/**
 * v2.44：开机登录页的"用 Unimate 账号登录并取回课表"。
 *
 * 为什么单独放一个文件、而不是写进 store：`stores/db.ts ⇄ services/backup.ts` 会形成模块循环
 * （backup.ts 要用 db.ts 的 `APP_VERSION`/`SCHEMA_VERSION`）。所以这里只做**编排**：
 * 用 store 已经对外暴露的能力（`accounts` / `session` / `selectSchool` / `loadUserData` / `persistManifest`）
 * 串起"建本机账号 → 绑定高校 → 恢复数据 → 进主界面"，不往 store 里塞新依赖。
 */
import type { Account } from '../types.ts';
import { uuid, nowStamp } from './id.ts';
import { randomSalt, sha256Text } from './crypto.ts';
import { writeJson } from './io.ts';
import { inspectBackup, readBackupProfile, restoreBackup, type BackupManifest } from './backup.ts';
import type { CloudAccountSession } from './account.ts';

export interface AdoptPreview {
  manifest: BackupManifest;
  /** 备份里自带的原账号记录（有的话，换机后连本机密码都保持原样） */
  savedAccount: Account | null;
  /** 这份备份会不会覆盖本机已有数据（真覆盖时调用方必须先二次确认） */
  willOverwrite: boolean;
}

/** 只声明本文件真正用到的那部分 store 能力，避免和 stores/db.ts 互相 import */
export interface AdoptTarget {
  accounts: Account[];
  timetables: unknown[];
  screen: string;
  profile: { schoolId: string } | null;
  session: { accountId: string; username: string; displayName: string; isDemo: boolean } | null;
  settings: { cloudAccount?: CloudAccountSession | null };
  profileOf(schoolId: string): unknown;
  selectSchool(schoolId: string, silent?: boolean): Promise<boolean>;
  loadUserData(): Promise<void>;
  saveData(): Promise<void>;
  persistManifest(): Promise<void>;
  notify(msg: string): void;
}

type Db = AdoptTarget;

export async function previewCloudBackup(bytes: Uint8Array, db: Db): Promise<AdoptPreview> {
  const { manifest } = await inspectBackup(bytes);
  const savedAccount = readBackupProfile(bytes);
  const target = savedAccount ? db.accounts.find((a) => a.id === savedAccount.id) : null;
  const willOverwrite = !!target && db.timetables.length > 0;
  return { manifest, savedAccount, willOverwrite };
}

/** 这份备份来自哪所学校、本机有没有这所学校的档案 */
export function adoptBlockedReason(manifest: BackupManifest, db: Db): string {
  if (db.profileOf(manifest.schoolId)) return '';
  return '这份备份来自「' + manifest.schoolName + '」，本机还没有这所高校的档案 —— 请先在「选择高校」页把它下载下来，再回来登录取回。';
}

/**
 * 真正落地：把云端备份装进本机并直接进入主界面。
 * 调用方负责在 `willOverwrite` 时先弹 `db.confirm`（硬规则 1）。
 */
export async function adoptCloudBackup(bytes: Uint8Array, db: Db, cloud: CloudAccountSession | null): Promise<void> {
  const { manifest, savedAccount } = await previewCloudBackup(bytes, db);
  const blocked = adoptBlockedReason(manifest, db);
  if (blocked) throw new Error(blocked);

  // 1) 本机账号：优先沿用备份里那一条（id/用户名/口令哈希/盐都原样），冲突时才另起一个
  let account = savedAccount ? db.accounts.find((a) => a.id === savedAccount.id) || null : null;
  if (!account) {
    const wantedName = savedAccount?.username || manifest.username || 'unimate';
    let username = wantedName;
    let n = 2;
    while (db.accounts.some((a) => a.username === username)) { username = wantedName + '-' + n; n++; }
    account = savedAccount
      ? { ...savedAccount, id: db.accounts.some((a) => a.id === savedAccount.id) ? uuid() : savedAccount.id, username }
      : { id: uuid(), username, displayName: username, isDemo: false, createdAt: nowStamp(), lastLoginAt: '' } as Account;
    if (!account.passwordHash || !account.salt) {
      // 备份里没有可用口令信息（老版本/第三方包）：本机账号用随机口令，反正数据已经取回来了
      const salt = randomSalt();
      account.salt = salt;
      account.passwordHash = await sha256Text(salt + uuid());
    }
    db.accounts.push(account);
    await writeJson('accounts.json', db.accounts);
  }

  // 2) 设为当前会话 + 绑定高校（selectSchool 内部会 applyProfile / 写 accounts.json / loadUserData / 进主界面）
  db.session = { accountId: account.id, username: account.username, displayName: account.displayName, isDemo: !!account.isDemo };
  account.lastLoginAt = nowStamp();
  account.schoolId = manifest.schoolId;
  await writeJson('accounts.json', db.accounts);
  const ok = await db.selectSchool(manifest.schoolId, true);
  if (!ok) throw new Error('本机还没有「' + manifest.schoolName + '」的档案，无法恢复到这所学校');

  // 3) 把备份写进这个账号的数据目录，再重新读一遍
  const base = 'schools/' + manifest.schoolId + '/users/' + account.id;
  try {
    await restoreBackup(bytes, base, false);
    await db.loadUserData();
  } catch (e) {
    // selectSchool 已经把界面切到主界面了：恢复失败要退回登录页，别让用户对着空课表发懵
    db.screen = 'login';
    throw e;
  }
  if (cloud) {
    db.settings.cloudAccount = { ...cloud };
    await db.saveData();
  }
  await db.persistManifest();
  db.notify('已从云端取回课表');
}
