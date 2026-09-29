package com.unimate.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.content.ClipData;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;

/**
 * 全屏 WebView。
 *
 * 工具条按 Chrome 的做法收成一行：左侧导航、中间标题+域名、右侧操作，
 * 底下压一条 3dp 进度线；不再用横向滚动的一排大按钮（真机反馈"顶部 UI 不好、还卡"）。
 * 「自动导入课表」改成可随手指拖动的小圆钮，只在教务页面出现。
 *
 * 性能取舍（查证后落地）：
 *  - 工具条按钮用 TextView 而非 Button，省掉 ripple / 9-patch 背景与最小高度约束；
 *  - 不给 WebView 强设 LAYER_TYPE_HARDWARE（软键盘弹出时会错乱），保持默认；
 *  - onPause 时 webView.onPause() 停掉绘制与动画，回来 onResume()，避免后台空转掉帧；
 *  - onDestroy 先从父容器摘掉再 destroy()，防止 WebView 泄漏导致越用越卡。
 *
 * 登录状态由系统 CookieManager 持久化；抓取只读指定表格的 outerHTML，
 * 不读取表单值、不读取 Cookie 内容（PRD 5.4.8）。
 */
public class JwWebViewActivity extends Activity {

    private WebView webView;
    private TextView titleView;
    private TextView urlView;
    private View progressBar;
    private FabImportView fab;
    private LinearLayout errBox;
    private TextView errText;

    private String selector = "";
    /**
     * 抓取模式：
     *  "timetable"（默认）= 课表，圆钮只在教务域名下出现；
     *  "exam" = 考试，按钮**常驻**并显示「识别考试」（产品负责人："这个界面你得一直保有一个按键，叫做识别考试"）。
     */
    private String mode = "timetable";
    private String actionLabel = "读取当前结果";
    private boolean allowExternal;
    private String homeUrl = "";
    private boolean retriedOnce;
    private int barWidth;

    /** 网页里的 <input type=file>（交作业、传附件）：北化在线/学习通提交作业必走这条路。 */
    private static final int REQ_FILES = 4108;
    private ValueCallback<Uri[]> uploadCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Intent args = getIntent();
        String url = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_URL), "about:blank");
        String title = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_TITLE), "Unimate");
        selector = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_SELECTOR), "");
        mode = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_MODE), "timetable");
        actionLabel = orDefault(args.getStringExtra(JwWebViewPlugin.EXTRA_ACTION_LABEL), "读取当前结果");
        allowExternal = args.getBooleanExtra(JwWebViewPlugin.EXTRA_ALLOW_EXTERNAL, false);
        if (isExamMode() && (selector == null || selector.isEmpty())) {
            // 考试页是 jqGrid：优先取整个表格容器，取不到再退到行容器/整页
            selector = "#gbox_tabGrid,#tabGrid,table.ui-jqgrid-btable,body";
        }

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);

        float dp = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
        int dpi = (int) dp;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#101826"));
        try { getWindow().setStatusBarColor(Color.parseColor("#0B1220")); } catch (Exception ignored) { }

        // ---------- 工具条：一行搞定 ----------
        FrameLayout barWrap = new FrameLayout(this);
        barWrap.setBackgroundColor(Color.parseColor("#101826"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(4 * dpi, 0, 4 * dpi, 0);
        FrameLayout.LayoutParams barLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, (int) (46 * dp));
        barWrap.addView(bar, barLp);
        barWrap.addOnLayoutChangeListener((v2, l, tp, r, btm, ol, ot, or2, ob) -> barWidth = v2.getWidth());

        TextView back = nav("←");
        TextView fwd = nav("→");
        TextView reload = nav("⟳");
        TextView home = nav("⌂");
        TextView ext = nav("↗");
        TextView close = nav("✕");
        close.setTextColor(Color.parseColor("#FFB4AB"));

        LinearLayout mid = new LinearLayout(this);
        mid.setOrientation(LinearLayout.VERTICAL);
        mid.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams midLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        midLp.leftMargin = 4 * dpi;
        midLp.rightMargin = 4 * dpi;
        mid.setLayoutParams(midLp);
        titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setSingleLine(true);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        urlView = new TextView(this);
        urlView.setTextColor(Color.parseColor("#8A97AC"));
        urlView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10.5f);
        urlView.setSingleLine(true);
        urlView.setEllipsize(android.text.TextUtils.TruncateAt.START);
        mid.addView(titleView);
        mid.addView(urlView);

        bar.addView(back);
        bar.addView(fwd);
        bar.addView(reload);
        bar.addView(mid);
        bar.addView(home);
        bar.addView(ext);
        bar.addView(close);

        // 进度线压在工具条下沿（Chrome 式），不额外占高度、不抖动布局
        progressBar = new View(this);
        progressBar.setBackgroundColor(Color.parseColor("#4E8AE0"));
        FrameLayout.LayoutParams pbLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, (int) (3 * dp));
        pbLp.gravity = Gravity.BOTTOM;
        progressBar.setLayoutParams(pbLp);
        progressBar.setVisibility(View.GONE);
        barWrap.addView(progressBar);

        // ---------- 错误提示条 ----------
        errBox = new LinearLayout(this);
        errBox.setOrientation(LinearLayout.VERTICAL);
        errBox.setPadding(14 * dpi, 14 * dpi, 14 * dpi, 14 * dpi);
        errBox.setBackgroundColor(Color.parseColor("#FFF4F3"));
        errBox.setVisibility(View.GONE);
        errText = new TextView(this);
        errText.setTextColor(Color.parseColor("#7A1F1A"));
        errText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        errText.setLineSpacing(0, 1.25f);
        errBox.addView(errText, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams ebtnRow = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        ebtnRow.topMargin = 10 * dpi;
        LinearLayout er = new LinearLayout(this);
        er.setOrientation(LinearLayout.HORIZONTAL);
        er.setLayoutParams(ebtnRow);
        TextView retry = chip("重试");
        TextView ext2 = chip("用系统浏览器打开");
        er.addView(retry);
        er.addView(ext2);
        errBox.addView(er);

        // ---------- 内容区：WebView + 浮动圆点 ----------
        FrameLayout content = new FrameLayout(this);
        LinearLayout.LayoutParams contentLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        content.setLayoutParams(contentLp);

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setTextZoom(100);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(true);
        // 常规缓存策略：让浏览器自己按 HTTP 头决定，登录态页面不做激进的离线优先
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 这些能少掉一些无谓的开销与弹窗
        s.setGeolocationEnabled(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setLoadsImagesAutomatically(true);
        if (Build.VERSION.SDK_INT >= 23) s.setOffscreenPreRaster(true);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        try { WebView.setWebContentsDebuggingEnabled(false); } catch (Exception ignored) { }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setBackgroundColor(Color.WHITE);
        content.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        fab = new FabImportView(this);
        FrameLayout.LayoutParams fabLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        fabLp.gravity = Gravity.BOTTOM | Gravity.END;
        fabLp.bottomMargin = (int) (88 * dp);
        fabLp.rightMargin = (int) (10 * dp);
        fab.setLayoutParams(fabLp);
        fab.setListener(() -> runScrape());
        if (isExamMode() || isCampusMode()) {
            fab.setLabel(isExamMode() ? "识别考试" : actionLabel);
            fab.setVisibility(View.VISIBLE);   // 考试/校园数据模式常驻
        } else {
            fab.setVisibility(View.GONE);
        }
        content.addView(fab);

        root.addView(barWrap);
        root.addView(errBox);
        root.addView(content);
        setContentView(root);

        back.setOnClickListener(v -> { if (webView.canGoBack()) webView.goBack(); else finishWith("", "cancelled"); });
        fwd.setOnClickListener(v -> { if (webView.canGoForward()) webView.goForward(); });
        reload.setOnClickListener(v -> { errBox.setVisibility(View.GONE); webView.reload(); });
        home.setOnClickListener(v -> { errBox.setVisibility(View.GONE); webView.loadUrl(homeUrl); });
        ext.setOnClickListener(v -> openExternally(currentUrl()));
        close.setOnClickListener(v -> finishWith("", "cancelled"));
        retry.setOnClickListener(v -> { errBox.setVisibility(View.GONE); webView.reload(); });
        ext2.setOnClickListener(v -> openExternally(currentUrl()));

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
                if (request == null || !request.isForMainFrame()) return;
                int code = error == null ? -1 : error.getErrorCode();
                Uri u = request.getUrl();
                String host = u == null ? hostOf(currentUrl()) : String.valueOf(u.getHost());
                // 真机出现过同一域名一台手机能解析、另一台报 ERR_NAME_NOT_RESOLVED，
                // 多为对方所在网络的 DNS 抖动。先自己重试一次，别把抖动甩给用户。
                if (code == WebViewClient.ERROR_HOST_LOOKUP && !retriedOnce) {
                    retriedOnce = true;
                    errText.setText("正在重试「" + host + "」的地址解析…");
                    errBox.setVisibility(View.VISIBLE);
                    webView.postDelayed(() -> { errBox.setVisibility(View.GONE); webView.reload(); }, 900);
                    return;
                }
                String msg = "打不开 " + host + "\n原因：" + (error == null ? "未知错误" : error.getDescription());
                if (code == WebViewClient.ERROR_HOST_LOOKUP) {
                    msg += "\n这台设备现在解析不到该域名。可改用移动数据或校园 Wi-Fi 再试，"
                         + "或点「用系统浏览器打开」；若系统浏览器也打不开，说明该入口对你所在网络不可达。";
                } else if (u != null && "http".equalsIgnoreCase(u.getScheme())) {
                    msg += "\n（明文 HTTP 地址，已对 buct.edu.cn 放开，请重试或改用系统浏览器）";
                }
                showError(msg);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                errBox.setVisibility(View.GONE);
                progressBar.setVisibility(View.VISIBLE);
                progressBar.setAlpha(1f);
                urlView.setText(safeHost(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                flushCookies();
                decorate(url);
                // 登录后常有跳转或脚本补写 Cookie，稍后再刷一次盘
                progressBar.postDelayed(JwWebViewActivity.this::flushCookies, 1500);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 100) { progressBar.setVisibility(View.GONE); return; }
                if (progressBar.getVisibility() != View.VISIBLE) progressBar.setVisibility(View.VISIBLE);
                View pv = progressBar;
                if (pv == null) return;
                int total = barWidth;
                if (total <= 0) total = view.getWidth();
                android.view.ViewGroup.LayoutParams lp = pv.getLayoutParams();
                if (lp != null) { lp.width = total <= 0 ? 0 : (int) (total * newProgress / 100f); pv.setLayoutParams(lp); }
            }

            // 关键：不实现这个回调，网页上的"上传作业/选择文件"按钮点了完全没反应
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (uploadCallback != null) { try { uploadCallback.onReceiveValue(null); } catch (Exception ignored) { } }
                uploadCallback = callback;
                try {
                    Intent it = params.createIntent();
                    startActivityForResult(it, REQ_FILES);
                    return true;
                } catch (Exception e) {
                    uploadCallback = null;
                    return false;
                }
            }
        });

        homeUrl = url;
        urlView.setText(safeHost(url));
        webView.loadUrl(url);
    }

    /** 按当前页面决定浮动圆点要不要出现（只在教务课表页有意义）。 */
    private void decorate(String url) {
        String h = hostOf(url);
        boolean timetable = h.contains("jwglxt");
        // 考试模式：按钮常驻（学生要先自己点"查询"，那一刻页面还没到考试页，按钮就必须在场）
        if (fab != null) fab.setVisibility((isExamMode() || isCampusMode()) ? View.VISIBLE : (timetable ? View.VISIBLE : View.GONE));
        if (titleView != null && url != null && !url.isEmpty() && !url.equals("about:blank")) {
            String t = webView == null ? null : webView.getTitle();
            if (t != null && !t.trim().isEmpty()) titleView.setText(t.trim());
        }
    }

    private boolean isExamMode() { return "exam".equalsIgnoreCase(mode); }
    private boolean isCampusMode() { return "campus".equalsIgnoreCase(mode); }

    private TextView nav(String glyph) {
        TextView t = new TextView(this);
        t.setText(glyph);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        t.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams((int) (40 * density()), LinearLayout.LayoutParams.MATCH_PARENT);
        t.setLayoutParams(lp);
        t.setBackground(makeBg());
        return t;
    }

    private TextView chip(String label) {
        TextView t = new TextView(this);
        t.setText(label);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setGravity(Gravity.CENTER);
        t.setPadding(16, 12, 16, 12);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = 8;
        t.setLayoutParams(lp);
        t.setBackground(makeBg());
        return t;
    }

    /** 带按压态的纯色圆角背景：比 Button 的 ripple + 9-patch 便宜，也更适合深色工具条。 */
    private android.graphics.drawable.Drawable makeBg() {
        android.graphics.drawable.StateListDrawable d = new android.graphics.drawable.StateListDrawable();
        android.graphics.drawable.GradientDrawable normal = new android.graphics.drawable.GradientDrawable();
        normal.setColor(Color.parseColor("#223047"));
        normal.setCornerRadius(9f);
        android.graphics.drawable.GradientDrawable pressed = new android.graphics.drawable.GradientDrawable();
        pressed.setColor(Color.parseColor("#33445F"));
        pressed.setCornerRadius(9f);
        d.addState(new int[]{ android.R.attr.state_pressed }, pressed);
        d.addState(new int[]{}, normal);
        return d;
    }

    private float density() {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
    }

    private void runScrape() {
        if (fab == null || fab.getVisibility() != View.VISIBLE) return;
        fab.setBusy(true);
        errBox.setVisibility(View.GONE);
        scrape();
    }

    private static String safeHost(String url) {
        try {
            Uri u = Uri.parse(url);
            String h = u.getHost();
            if (h == null) return url;
            String p = u.getPath();
            return (p == null || p.isEmpty() || "/".equals(p)) ? h : h + "…" + (p.length() > 22 ? p.substring(0, 22) + "…" : p);
        } catch (Exception e) { return url; }
    }

    private static String hostOf(String url) {
        try { Uri u = Uri.parse(url); return u.getHost() == null ? "" : u.getHost().toLowerCase(); }
        catch (Exception e) { return ""; }
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
        if (fab != null) fab.setBusy(false);
    }

    private void openExternally(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (Exception e) { showError("系统浏览器也打不开：可能是这个地址在你当前网络下解析不到。"); }
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    /** 抓取：只读取指定表格的 outerHTML，不读表单值、不读 Cookie。 */
    private void scrape() {
        String css = selector == null || selector.isEmpty() ? "#kbgrid_table_0" : selector;
        // selector 支持逗号分隔的候选列表（考试页的表格 id 可能因版本而异，逐个试）
        StringBuilder arr = new StringBuilder("[");
        for (String s : css.split(",")) {
            String one = s.trim();
            if (one.isEmpty()) continue;
            arr.append(JSONObject.quote(one)).append(",");
        }
        arr.append("]");
        String js = "(function(){try{var sels=" + arr + ";var el=null;"
            + "for(var i=0;i<sels.length;i++){try{el=document.querySelector(sels[i]);}catch(e){}if(el){break;}}"
            + "if(!el){return JSON.stringify({error:'no-table',url:location.href});}"
            + "return JSON.stringify({html:el.outerHTML,url:location.href,title:document.title});}"
            + "catch(e){return JSON.stringify({error:'scrape-failed:'+e.message,url:location.href});}})()";
        webView.evaluateJavascript(js, value -> {
            String raw = value == null || value.equals("null") ? "{}" : value;
            try {
                String unwrapped = new JSONObject("{\"v\":" + raw + "}").getString("v");
                JSONObject obj = new JSONObject(unwrapped);
                if (obj.has("error")) finishWith("", obj.getString("error"));
                else finishWith(obj.getString("html"), "");
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
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILES) {
            ValueCallback<Uri[]> cb = uploadCallback;
            uploadCallback = null;
            if (cb == null) return;
            Uri[] uris = null;
            try {
                if (resultCode == RESULT_OK && data != null) {
                    java.util.ArrayList<Uri> list = new java.util.ArrayList<Uri>();
                    ClipData clip = data.getClipData();
                    if (clip != null) {
                        for (int i = 0; i < clip.getItemCount(); i++) {
                            Uri u = clip.getItemAt(i).getUri();
                            if (u != null) list.add(u);
                        }
                    } else if (data.getData() != null) {
                        list.add(data.getData());
                    }
                    if (!list.isEmpty()) uris = list.toArray(new Uri[0]);
                }
            } catch (Exception ignored) { }
            // 必须回调一次（哪怕是 null），否则网页端的文件框会永久卡住、再也点不开
            cb.onReceiveValue(uris);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finishWith("", "cancelled");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        // 停掉页面绘制与动画：后台空转是"越用越卡"和耗电的主要来源之一
        if (webView != null) webView.onPause();
        super.onPause();
        flushCookies();
    }

    @Override
    protected void onDestroy() {
        if (uploadCallback != null) { try { uploadCallback.onReceiveValue(null); } catch (Exception ignored) { } uploadCallback = null; }
        flushCookies();
        if (webView != null) {
            try {
                if (webView.getParent() != null) ((ViewGroup) webView.getParent()).removeView(webView);
                webView.loadUrl("about:blank");
                webView.destroy();
            } catch (Exception ignored) { }
            webView = null;
        }
        super.onDestroy();
    }
}
