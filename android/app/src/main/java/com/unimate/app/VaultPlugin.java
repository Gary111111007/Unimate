package com.unimate.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 凭据保管库桥。只暴露"保存 / 查看账号与掩码 / 是否存在 / 清除"。
 * 密码明文不经过这个通道 —— 只在 JwWebViewActivity 内部解密后直接注入表单。
 */
@CapacitorPlugin(name = "Vault")
public class VaultPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String acc = call.getString("account", "");
        String pw = call.getString("password", "");
        JSObject ret = new JSObject();
        if (acc.isEmpty() || pw.isEmpty()) { ret.put("ok", false); ret.put("error", "账号和密码都要填"); call.resolve(ret); return; }
        try {
            Vault.save(getContext(), acc, pw);
            ret.put("ok", true);
            ret.put("error", "");
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("error", "本机加密存储失败：" + e.getMessage());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        boolean has = Vault.has(getContext());
        String[] p = has ? Vault.peek(getContext()) : null;
        ret.put("saved", has && p != null);
        ret.put("account", p == null ? "" : p[0]);
        ret.put("masked", p == null ? "" : p[1]);
        call.resolve(ret);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Vault.clear(getContext());
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}