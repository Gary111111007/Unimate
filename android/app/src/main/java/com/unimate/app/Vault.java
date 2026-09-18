package com.unimate.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 校园账号凭据的本地保管库。
 *
 * 安全边界（对应 PRD 5.4.8 与 11.16）：
 *  - 密钥在 Android Keystore 硬件后端子系统里生成并保存，**明文密钥从不进入 Java 层**；
 *  - 落盘的只有 AES/GCM 密文 + 每次随机的 IV，GCM 自带完整性校验，被改过会解不开；
 *  - 只在用户主动点"自动填充"时把值写进网页表单，**从不读取**网页上已有的值；
 *  - 不上传、不进日志、不参与备份包；换机需重新输入。
 *  - 密码字段仅本机保存，界面上永远打码显示，且提供一键清除。
 */
public final class Vault {

    private static final String KEY_ALIAS = "unimate.vault.aes";
    private static final String PREFS = "unimate_vault";
    private static final String K_USER = "enc_user";
    private static final String K_PASS = "enc_pass";
    private static final String K_IVU = "iv_user";
    private static final String K_IVP = "iv_pass";
    private static final String K_LABEL = "label";
    private static final int TAG_BITS = 128;

    private Vault() { }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        KeyStore.Entry e = ks.getEntry(KEY_ALIAS, null);
        if (e instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) e).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    private static byte[] seal(SecretKey k, byte[] plain, byte[] iv) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, k, new GCMParameterSpec(TAG_BITS, iv));
        return c.doFinal(plain);
    }

    private static byte[] open(SecretKey k, byte[] cipher, byte[] iv) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(TAG_BITS, iv));
        return c.doFinal(cipher);
    }

    private static byte[] newIv() {
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(iv);
        return iv;
    }

    public static synchronized void save(Context ctx, String account, String password) throws Exception {
        SecretKey k = key();
        byte[] ivA = newIv();
        byte[] ivB = newIv();
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        sp.edit()
                .putString(K_USER, Base64.encodeToString(seal(k, account.getBytes("UTF-8"), ivA), Base64.NO_WRAP))
                .putString(K_IVU, Base64.encodeToString(ivA, Base64.NO_WRAP))
                .putString(K_PASS, Base64.encodeToString(seal(k, password.getBytes("UTF-8"), ivB), Base64.NO_WRAP))
                .putString(K_IVP, Base64.encodeToString(ivB, Base64.NO_WRAP))
                .putString(K_LABEL, account.length() > 4
                        ? account.substring(0, 2) + "***" + account.substring(account.length() - 2)
                        : account.charAt(0) + "***")
                .apply();
    }

    public static synchronized boolean has(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return sp.getString(K_PASS, null) != null;
    }

    /** 只回账号与掩码标签，密码永不通过这个方法离开解密点。 */
    public static synchronized String[] peek(Context ctx) {
        try {
            SecretKey k = key();
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String acc = new String(open(k, Base64.decode(sp.getString(K_USER, ""), Base64.NO_WRAP),
                    Base64.decode(sp.getString(K_IVU, ""), Base64.NO_WRAP)), "UTF-8");
            return new String[]{acc, sp.getString(K_LABEL, acc)};
        } catch (Exception e) {
            return null;
        }
    }

    /** 供 WebView 自动填充使用：调用后即用，调用方不得写日志。 */
    public static synchronized String[] reveal(Context ctx) {
        try {
            SecretKey k = key();
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String acc = new String(open(k, Base64.decode(sp.getString(K_USER, ""), Base64.NO_WRAP),
                    Base64.decode(sp.getString(K_IVU, ""), Base64.NO_WRAP)), "UTF-8");
            String pw = new String(open(k, Base64.decode(sp.getString(K_PASS, ""), Base64.NO_WRAP),
                    Base64.decode(sp.getString(K_IVP, ""), Base64.NO_WRAP)), "UTF-8");
            return new String[]{acc, pw};
        } catch (Exception e) {
            return null;
        }
    }

    public static synchronized void clear(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            ks.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) { }
    }
}