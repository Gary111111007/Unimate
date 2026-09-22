package com.unimate.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.CookieManager;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JwWebViewPlugin.class);
        super.onCreate(savedInstanceState);
        /*
         * 提醒兜底心跳（v2.30）：应用一启动就把它排上。
         * 不这么做的话，只有在"系统真的按点放行了插件那条闹钟"之后心跳才会存在 —— 那是鸡生蛋问题。
         */
        try { ReminderHeartbeat.arm(this); } catch (Throwable ignored) { }
        /*
         * 提醒守护前台服务（v2.34）：用户在设置里开着的话，App 一启动就把它拉起来。
         * 前台服务要"由前台应用启动"才允许，所以放在这里；开机广播那条路上只是尽力而为。
         */
        try { if (ReminderGuardService.isEnabled(this)) ReminderGuardService.start(this); } catch (Throwable ignored) { }
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
