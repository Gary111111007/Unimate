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

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Intent args = getIntent();
        String url = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_URL), "about:blank");
        String title = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_TITLE), "Unimate");
        selector = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_SELECTOR), "");
        allowExternal = args.getBooleanExtra(JwWebViewPlugin.EXTRA_ALLOW_EXTERNAL, false);

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
        Button grab = small("一键保存并识别");
        grab.setMinWidth(0);
        grab.setBackgroundColor(Color.parseColor("#2E5AAC"));
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
        row2.addView(grab);
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
                    String msg = "页面加载失败：" + (error == null ? "未知错误" : error.getDescription());
                    Uri u = request == null ? null : request.getUrl();
                    if (u != null && "http".equalsIgnoreCase(u.getScheme())) {
                        msg += "（该地址是明文 HTTP，已放开 buct.edu.cn 的明文访问，请重试或改用系统浏览器）";
                    }
                    showError(msg);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (webView != null && !webView.canGoBackOrForward(0)) { /* 保持提示，便于用户看到原因 */ }
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
        closeBtn.setOnClickListener(v -> finishWith("", "cancelled"));
        grab.setOnClickListener(v -> scrape());
        openExt.setOnClickListener(v -> openExternally(currentUrl()));

        homeUrl = url;
        webView.loadUrl(url);
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