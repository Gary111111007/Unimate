package com.unimate.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;

/**
 * 全屏 WebView：顶部工具条含「一键保存并识别」「刷新」「关闭」。
 * 登录状态由系统 CookieManager 持久化（PRD 5.7 / AC-24）。
 */
public class JwWebViewActivity extends Activity {

    private WebView webView;
    private String selector;
    private boolean allowExternal;
    private String homeUrl = "";
    private android.widget.LinearLayout errBox;
    private android.widget.TextView errText;
    private Button grabBtn;
    private Button fillBtn;
    private boolean retriedOnce;
    private boolean vaultReady;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Intent args = getIntent();
        String url = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_URL), "about:blank");
        String title = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_TITLE), "Unimate");
        selector = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_SELECTOR), "");
        allowExternal = args.getBooleanExtra(JwWebViewPlugin.EXTRA_ALLOW_EXTERNAL, false);

        vaultReady = Vault.has(this);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);

        int dp = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#101826"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setPadding(8 * dp, 8 * dp, 8 * dp, 8 * dp);
        bar.setBackgroundColor(Color.parseColor("#101826"));
        try { getWindow().setStatusBarColor(Color.parseColor("#0B1220")); } catch (Exception ignored) { }

        LinearLayout row1 = new LinearLayout(this);
        row1.setOrientation(LinearLayout.HORIZONTAL);
        row1.setGravity(Gravity.CENTER_VERTICAL);
        TextView label = new TextView(this);
        label.setText(title);
        label.setTextColor(Color.WHITE);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        LinearLayout.LayoutParams labelLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        label.setLayoutParams(labelLp);

        Button back = small("←");
        Button fwd = small("→");
        Button reload = small("刷新");
        Button home = small("主页");
        // 「保存课表」是这一页最重要的动作，之前和别的按钮一样大、还挤在横向滚动区里，
        // 真机反馈"按钮太隐藏"。改成主按钮：更大字号、更高内边距、品牌色，且只在教务
        // 域名下出现（在别的站点显示它只会让人困惑）。
        grabBtn = primary("保存课表");
        grabBtn.setMinWidth(0);
        fillBtn = small("自动填充");
        fillBtn.setBackgroundColor(Color.parseColor("#1E6E46"));
        Button openExt = small("浏览器");
        Button closeBtn = small("关闭");
        row1.addView(label);
        row1.addView(closeBtn);

        LinearLayout row2 = new LinearLayout(this);
        row2.setOrientation(LinearLayout.HORIZONTAL);
        row2.setGravity(Gravity.CENTER_VERTICAL);
        row2.addView(back);
        row2.addView(fwd);
        row2.addView(reload);
        row2.addView(home);
        row2.addView(grabBtn);
        row2.addView(fillBtn);
        row2.addView(openExt);

        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        scroll.addView(row2);

        bar.addView(row1);
        bar.addView(scroll);

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        // 双指缩放：教务/在线平台页面需要放大查看
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setBackgroundColor(Color.WHITE);
        errBox = new LinearLayout(this);
        errBox.setOrientation(LinearLayout.VERTICAL);
        errBox.setPadding(14 * dp, 14 * dp, 14 * dp, 14 * dp);
        errBox.setBackgroundColor(Color.parseColor("#FFF4F3"));
        errBox.setVisibility(View.GONE);
        errText = new TextView(this);
        errText.setTextColor(Color.parseColor("#7A1F1A"));
        errText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        LinearLayout.LayoutParams errLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        errText.setLayoutParams(errLp);
        Button retry = small("重试");
        Button ext = small("用系统浏览器打开");
        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        rowLp.topMargin = 10 * dp;
        errBox.addView(errText);
        LinearLayout.LayoutParams btnRow = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        LinearLayout rr = new LinearLayout(this);
        rr.setOrientation(LinearLayout.HORIZONTAL);
        rr.setLayoutParams(btnRow);
        rr.addView(retry);
        rr.addView(ext);
        errBox.addView(rr);
        retry.setOnClickListener(v -> { errBox.setVisibility(View.GONE); webView.reload(); });
        ext.setOnClickListener(v -> openExternally(currentUrl()));

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (allowExternal && u.getScheme() != null && !u.getScheme().startsWith("http")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                    return true;
                }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    Uri u = request == null ? null : request.getUrl();
                    int code = error == null ? -1 : error.getErrorCode();
                    String host = u == null ? hostOf(currentUrl()) : String.valueOf(u.getHost());
                    // DNS 解析失败多为对方网络/路由器的问题（真机出现过同一地址在
                    // 一台手机可解析、另一台报 ERR_NAME_NOT_RESOLVED）。先自动重试一次，
                    // 别把一次抖动直接甩给用户。
                    if (code == android.webkit.WebViewClient.ERROR_HOST_LOOKUP && !retriedOnce) {
                        retriedOnce = true;
                        errText.setText("正在重试「" + host + "」的地址解析…");
                        errBox.setVisibility(View.VISIBLE);
                        webView.postDelayed(() -> { errBox.setVisibility(View.GONE); webView.reload(); }, 900);
                        return;
                    }
                    String msg = "打不开 " + host + "\n原因：" + (error == null ? "未知错误" : error.getDescription());
                    if (code == android.webkit.WebViewClient.ERROR_HOST_LOOKUP) {
                        msg += "\n这台设备当前解析不到该域名。换用移动数据/校园 Wi‑Fi 再试，"
                             + "或点下方「用系统浏览器打开」；若系统浏览器也打不开，说明学校这个入口对你所在网络不可达。";
                    } else if (u != null && "http".equalsIgnoreCase(u.getScheme())) {
                        msg += "\n（明文 HTTP 地址，已对 buct.edu.cn 放开，请重试或改用系统浏览器）";
                    }
                    showError(msg);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (webView != null && !webView.canGoBackOrForward(0)) { /* 保持提示，便于用户看到原因 */ }
                // 关键：不能只在 onPause 落盘。国产 ROM 直接杀进程时 onPause 根本不执行，
                // 刚登录拿到的会话 Cookie 就随内存一起没了。页面一加载完就刷盘，
                // 把丢失窗口从"整个使用期间"压到"秒级"。
                flushCookies();
                refreshToolbar(url);
                if (bar != null) {
                    bar.postDelayed(new Runnable() {
                        @Override public void run() { flushCookies(); }
                    }, 1500);   // 登录后常有跳转/JS 补写 Cookie，稍后再刷一次
                }
            }
        });
        LinearLayout.LayoutParams wvLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        webView.setLayoutParams(wvLp);

        root.addView(bar);
        root.addView(errBox);
        root.addView(webView);
        setContentView(root);

        fwd.setOnClickListener(v -> { if (webView.canGoForward()) webView.goForward(); });
        home.setOnClickListener(v -> webView.loadUrl(homeUrl));
        back.setOnClickListener(v -> { if (webView.canGoBack()) webView.goBack(); else finishWith("", "cancelled"); });
        reload.setOnClickListener(v -> webView.reload());
        closeBtn.setOnClickListener(v -> maybeOfferSaveThen(() -> finishWith("", "cancelled")));
        grabBtn.setOnClickListener(v -> scrape());
        fillBtn.setOnClickListener(v -> doAutofill());
        openExt.setOnClickListener(v -> openExternally(currentUrl()));

        homeUrl = url;
        webView.loadUrl(url);
    }


    /** 在教务/门户页用完且本机还没存凭据时，问一次要不要保存，方便下次一键填充。 */
    private void maybeOfferSaveThen(Runnable then) {
        String h = hostOf(currentUrl());
        boolean relevant = h.contains("portal") || h.contains("jwglxt");
        if (!relevant || vaultReady) { then.run(); return; }
        new android.app.AlertDialog.Builder(this)
            .setTitle("要保存账号到本机吗？")
            .setMessage("下次进入这个页面可以一键自动填充。\n\n"
                + "· 账号密码用 Android 系统密钥库加密后存在这台手机上，不联网、不上传、不进备份文件；\n"
                + "· App 只会把它写进登录框，不会读取页面上已输入的内容；\n"
                + "· 随时可在「我的 → 校园账号（自动填充）」里清除。")
            .setPositiveButton("保存到本机", (d, w) -> showVaultForm(then))
            .setNegativeButton("这次不用", (d, w) -> then.run())
            .setNeutralButton("以后再说", (d, w) -> then.run())
            .setOnCancelListener(d -> then.run())
            .show();
    }

    private void showVaultForm(final Runnable then) {
        int dp = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
        android.widget.EditText acc = new android.widget.EditText(this);
        acc.setHint("学号 / 工号");
        acc.setSingleLine(true);
        android.widget.EditText pw = new android.widget.EditText(this);
        pw.setHint("密码");
        pw.setSingleLine(true);
        pw.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(20 * dp, 12 * dp, 20 * dp, 0);
        box.addView(acc);
        box.addView(pw);
        new android.app.AlertDialog.Builder(this)
            .setTitle("保存到本机")
            .setView(box)
            .setPositiveButton("保存", (d, w) -> {
                String a = acc.getText().toString().trim();
                String b = pw.getText().toString();
                if (a.isEmpty() || b.isEmpty()) { toast("账号和密码都要填"); then.run(); return; }
                try {
                    Vault.save(this, a, b);
                    vaultReady = true;
                    refreshToolbar(currentUrl());
                    toast("已加密保存到本机，下次点「自动填充」即可");
                } catch (Exception e) {
                    toast("保存失败：" + e.getMessage());
                }
                then.run();
            })
            .setNegativeButton("取消", (d, w) -> then.run())
            .setOnCancelListener(d -> then.run())
            .show();
    }
    private Button primary(String text) {
        Button b = small(text);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setTypeface(b.getTypeface(), android.graphics.Typeface.BOLD);
        b.setBackgroundColor(Color.parseColor("#2E5AAC"));
        int dp = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
        b.setPadding(18 * dp, 12 * dp, 18 * dp, 12 * dp);
        return b;
    }

    private static String hostOf(String url) {
        try { Uri u = Uri.parse(url); return u.getHost() == null ? "" : u.getHost().toLowerCase(); }
        catch (Exception e) { return ""; }
    }

    /** 按当前页面决定哪些按钮该露出来，避免在无关站点上显示"保存课表"。 */
    private void refreshToolbar(String url) {
        String h = hostOf(url);
        boolean jw = h.contains("jwglxt") || h.contains("buct.edu.cn") && !selector.isEmpty();
        if (grabBtn != null) grabBtn.setVisibility(jw ? View.VISIBLE : View.GONE);
        boolean canFill = vaultReady && (h.contains("portal") || h.contains("jwglxt"));
        if (fillBtn != null) fillBtn.setVisibility(canFill ? View.VISIBLE : View.GONE);
    }

    /**
     * 自动填充：只把本机保管库里的值**写入**表单，绝不读取页面上已有的内容。
     * 用原生 setter + 派发 input/change 事件，兼容 Vue/React 受控输入框。
     */
    private void doAutofill() {
        final String[] kv = Vault.reveal(this);
        if (kv == null) {
        showError("本机凭据解不开（可能系统密钥已被重置）。请到「我的 → 校园账号（自动填充）」重新保存一次。");
            return;
        }
        String js = "(function(){var u=" + JSONObject.quote(kv[0]) + ",p=" + JSONObject.quote(kv[1]) + ";"
            + "function set(el,v){if(!el)return false;try{var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;"
            + "d.call(el,v);}catch(e){el.value=v;}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;}"
            + "var pw=document.querySelector('input[type=password]');var user=null;var all=document.getElementsByTagName('input');"
            + "for(var i=0;i<all.length;i++){var f=all[i];var ty=(f.type||'').toLowerCase();"
            + "if(ty==='password'||ty==='hidden'||ty==='submit'||ty==='button')continue;"
            + "var sig=((f.name||'')+' '+(f.id||'')+' '+(f.placeholder||'')).toLowerCase();"
            + "if(ty==='text'||ty==='tel'||ty==='number'||ty===''||/user|account|login|zh|学号|工号|账/.test(sig)){user=f;break;}}"
            + "var a=set(user,u),b=set(pw,p);return (a&&b)?'ok':(a?'no-pw':(b?'no-user':'none'));})();";
        webView.evaluateJavascript(js, value -> {
            String r = value == null ? "" : value.replace("\"", "");
            if (r.contains("ok")) {
                toast("已填入本机保存的账号，请自己核对后点登录");
            } else if (r.contains("no-pw")) {
                toast("已填账号，但没找到密码框");
            } else if (r.contains("no-user")) {
                toast("已填密码，但没找到账号框");
            } else {
                toast("这个页面没找到可填写的登录框");
            }
        });
    }

    private void toast(String msg) {
        android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show();
    }

    private void flushCookies() {
        try { CookieManager.getInstance().flush(); } catch (Exception ignored) { }
    }

    private String currentUrl() {
        String u = webView == null ? null : webView.getUrl();
        return u == null || u.isEmpty() ? homeUrl : u;
    }

    private void showError(String msg) {
        if (errText != null) errText.setText(msg);
        if (errBox != null) errBox.setVisibility(View.VISIBLE);
    }

    private void openExternally(String url) {
        if (url == null || url.isEmpty()) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    private Button small(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextColor(Color.WHITE);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        b.setBackgroundColor(Color.parseColor("#2A3547"));
        int dp = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
        b.setPadding(10 * dp, 6 * dp, 10 * dp, 6 * dp);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(5 * dp, 0, 0, 0);
        b.setLayoutParams(lp);
        return b;
    }

    /** 只读取目标容器 HTML；找不到就回报原因，不猜测、不代填。 */
    private void scrape() {
        String css = selector == null || selector.isEmpty() ? "#kbgrid_table_0" : selector;
        String js = "(function(){try{var el=document.querySelector(" + JSONObject.quote(css) + ");"
            + "if(!el){return JSON.stringify({error:'no-table',url:location.href});}"
            + "return JSON.stringify({html:el.outerHTML,url:location.href,title:document.title});}"
            + "catch(e){return JSON.stringify({error:'scrape-failed:'+e.message,url:location.href});}})()";
        webView.evaluateJavascript(js, value -> {
            String raw = value == null || value.equals("null") ? "{}" : value;
            try {
                // evaluateJavascript 返回的是 JSON 字符串的字面量，需要先解一层
                String unwrapped = new JSONObject("{\"v\":" + raw + "}").getString("v");
                JSONObject obj = new JSONObject(unwrapped);
                if (obj.has("error")) {
                    finishWith("", obj.getString("error"));
                } else {
                    finishWith(obj.getString("html"), "");
                }
            } catch (Exception e) {
                finishWith("", "parse-failed");
            }
        });
    }

    private void finishWith(String html, String reason) {
        Intent data = new Intent();
        data.putExtra(JwWebViewPlugin.RES_HTML, html == null ? "" : html);
        data.putExtra(JwWebViewPlugin.RES_URL, webView == null ? "" : webView.getUrl());
        data.putExtra(JwWebViewPlugin.RES_REASON, reason == null ? "" : reason);
        setResult(RESULT_OK, data);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finishWith("", "cancelled");
    }

    @Override
    protected void onPause() {
        super.onPause();
        try { CookieManager.getInstance().flush(); } catch (Exception ignored) { }
    }

    @Override
    protected void onDestroy() {
        try { CookieManager.getInstance().flush(); } catch (Exception ignored) { }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}