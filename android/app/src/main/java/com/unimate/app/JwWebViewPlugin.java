package com.unimate.app;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 内嵌教务/在线平台 WebView。
 * 只读取指定容器的 outerHTML（默认 #kbgrid_table_0），不读取表单内容、不读取 Cookie 值、
 * 不代填账号密码 —— 对应 PRD 5.4.8 与第 10.8 节质量红线。
 */
@CapacitorPlugin(name = "JwWebView")
public class JwWebViewPlugin extends Plugin {

    public static final String EXTRA_URL = "unimate:url";
    public static final String EXTRA_TITLE = "unimate:title";
    public static final String EXTRA_SELECTOR = "unimate:selector";
    public static final String EXTRA_ALLOW_EXTERNAL = "unimate:allowExternal";
    public static final String RES_HTML = "html";
    public static final String RES_URL = "url";
    public static final String RES_REASON = "reason";

    private PluginCall pending;

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("missing url");
            return;
        }
        pending = call;
        Intent intent = new Intent(getContext(), JwWebViewActivity.class);
        intent.putExtra(EXTRA_URL, url);
        intent.putExtra(EXTRA_TITLE, call.getString("title", "Unimate"));
        intent.putExtra(EXTRA_SELECTOR, call.getString("scrapeSelector", ""));
        intent.putExtra(EXTRA_ALLOW_EXTERNAL, Boolean.TRUE.equals(call.getBoolean("allowExternal", false)));
        startActivityForResult(call, intent, "handleOpenResult");
    }

    @ActivityCallback
    private void handleOpenResult(PluginCall activityCall, ActivityResult result) {
        PluginCall call = pending;
        pending = null;
        if (call == null) return;

        Intent data = result.getData();
        JSObject ret = new JSObject();
        String html = data == null ? null : data.getStringExtra(RES_HTML);
        String url = data == null ? "" : data.getStringExtra(RES_URL);
        String reason = data == null ? "cancelled" : data.getStringExtra(RES_REASON);
        boolean ok = html != null && html.length() > 0;

        ret.put("ok", ok);
        ret.put("url", url == null ? "" : url);
        ret.put("reason", ok ? "" : (reason == null || reason.isEmpty() ? "cancelled" : reason));
        if (ok) ret.put("html", html);
        call.resolve(ret);
    }
}
