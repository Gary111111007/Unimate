package com.unimate.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.CookieManager;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JwWebViewPlugin.class);
        registerPlugin(VaultPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * 用户从主界面直接切走/被 MIUI 回收时，内嵌 WebView 的 onPause 可能不会执行。
     * 应用级再兜一次，确保刚拿到的会话 Cookie 落盘。
     */
    @Override
    public void onPause() {
        super.onPause();
        try { CookieManager.getInstance().flush(); } catch (Exception ignored) { }
    }
}