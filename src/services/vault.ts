// 校园账号自动填充的本机侧（PRD 11.16）。
// 原生用 Android Keystore AES/GCM 加密，明文不出 Java 层；本模块只经手"账号 + 掩码"，
// 密码既不回传也不显示。桌面预览环境一律返回未保存。
import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

export interface VaultStatus { saved: boolean; account: string; masked: string }
interface VaultPlugin {
  save(o: { account: string; password: string }): Promise<{ ok: boolean; error: string }>;
  status(): Promise<VaultStatus>;
  clear(): Promise<{ ok: boolean }>;
}

export const Vault = registerPlugin<VaultPlugin>('Vault', {
  web: () => ({
    save: async () => ({ ok: false, error: '桌面预览环境不支持本机加密存储，请安装 APK 后使用' }),
    status: async () => ({ saved: false, account: '', masked: '' }),
    clear: async () => ({ ok: true })
  })
});

export const vaultSupported = (): boolean => Capacitor.isNativePlatform();