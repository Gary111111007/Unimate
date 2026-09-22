package com.unimate.app;

import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;
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
    /** timetable = 抓课表；exam = 抓考试（按钮常驻，叫「识别考试」） */
    public static final String EXTRA_MODE = "unimate:mode";
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
        intent.putExtra(EXTRA_MODE, call.getString("mode", "timetable"));
        intent.putExtra(EXTRA_ALLOW_EXTERNAL, Boolean.TRUE.equals(call.getBoolean("allowExternal", false)));
        startActivityForResult(call, intent, "handleOpenResult");
    }

/**
     * Cookie 诊断探针：只回答"这个域名当前有没有 Cookie、几条"，
     * 绝不返回 Cookie 内容本身 —— PRD 5.4.8 红线（不读取 Cookie 值）。
     * 用途：区分"登录态没落盘"与"学校服务端会话本身过期"两种情况。
     */
    @PluginMethod
    public void cookieProbe(PluginCall call) {
        String url = call.getString("url", "");
        int count = 0;
        try {
            String ck = CookieManager.getInstance().getCookie(url);
            if (ck != null && !ck.isEmpty()) {
                for (String part : ck.split(";")) {
                    if (!part.trim().isEmpty()) count++;
                }
            }
        } catch (Exception ignored) { }
        JSObject ret = new JSObject();
        ret.put("present", count > 0);
        ret.put("count", count);
        call.resolve(ret);
    }

    /**
     * 用系统里合适的 App 打开课程资料（PPT / Word / PDF / 图片等）。
     * 文件在本机应用私有目录，经 FileProvider 换成 content:// 再交给外部应用，
     * 因此不需要存储权限，也不会暴露原始路径。
     */
    @PluginMethod
    public void openFile(PluginCall call) {
        String rel = call.getString("path", "");
        String name = call.getString("name", "");
        JSObject ret = new JSObject();
        if (rel.isEmpty()) { ret.put("ok", false); ret.put("error", "缺少文件路径"); call.resolve(ret); return; }
        try {
            java.io.File f = new java.io.File(getContext().getFilesDir(), rel);
            if (!f.exists()) {
                ret.put("ok", false);
                ret.put("error", "文件不在本机（可能被清理或属于另一个账号）");
                call.resolve(ret);
                return;
            }
            String mime = call.getString("mime", "");
            if (mime == null || mime.isEmpty()) {
                String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
                String guessed = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
                mime = guessed == null ? "*/*" : guessed;
            }
            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", f);
            android.content.Intent it = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            it.setDataAndType(uri, mime);
            it.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            it.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(it);
            ret.put("ok", true);
            ret.put("error", "");
            ret.put("mime", mime);
        } catch (android.content.ActivityNotFoundException e) {
            ret.put("ok", false);
            ret.put("error", "这台手机上没有能打开 " + (name.isEmpty() ? "该文件" : name) + " 的应用");
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("error", "打开失败：" + e.getMessage());
        }
        call.resolve(ret);
    }

    /**
     * 电池优化 / 精确闹钟状态。查证过多方成功案例：不加入白名单时，国产 ROM（小米/OPPO/vivo/华为）
     * 会冻结后台，AlarmManager 排的本地通知根本不弹。这是"到点不提醒"最常见的真因。
     */
    @PluginMethod
    public void powerStatus(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            ret.put("ignoring", pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
            ret.put("exactAlarm", canExact());
            String m = android.os.Build.MANUFACTURER == null ? "" : android.os.Build.MANUFACTURER.toLowerCase();
            ret.put("manufacturer", android.os.Build.MANUFACTURER);
            ret.put("model", android.os.Build.MODEL);
            ret.put("rom", romName(m));
            ret.put("hint", hint(m));
            ret.put("error", "");
            /*
             * 这个 ok 以前漏了（v2.31 修）：前端按 `ps.ok` 判断"这次查询成不成功"，
             * 少了它就一直显示"未检测"，还会把「去允许后台运行」按钮藏起来 ——
             * 真机截图里就是这个现象（机型/路径都查到了，却显示未检测）。
             */
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ignoring", false);
            ret.put("exactAlarm", false);
            ret.put("manufacturer", ""); ret.put("model", ""); ret.put("rom", ""); ret.put("hint", "");
            ret.put("error", e.getMessage() == null ? "查询失败" : e.getMessage());
            ret.put("ok", false);
        }
        call.resolve(ret);
    }

    private static String romName(String m) {
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("blackshark")) return "小米 / Redmi";
        if (m.contains("oppo") || m.contains("realme") || m.contains("oneplus") || m.contains("coloros")) return "OPPO / 一加 / realme";
        if (m.contains("vivo") || m.contains("iqoo")) return "vivo / iQOO";
        if (m.contains("huawei") || m.contains("honor")) return "华为 / 荣耀";
        if (m.contains("samsung")) return "三星";
        if (m.contains("meizu")) return "魅族";
        return android.os.Build.MANUFACTURER;
    }

    /** 各厂商自启动 / 后台常驻入口，来源见 PRD 11.19（小米社区、OPPO 与 vivo 开放平台省电策略文档）。 */
    private static String hint(String m) {
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("blackshark"))
            return "小米/Redmi：设置 → 应用设置 → 应用管理 → Unimate → 省电策略选「无限制」，并允许「自启动」";
        if (m.contains("oppo") || m.contains("realme") || m.contains("oneplus") || m.contains("coloros"))
            return "OPPO/一加：设置 → 应用 → 应用管理 → Unimate → 打开「允许自动启动」与「允许后台活动」；再在「手机管家 → 权限隐私」里解除省电限制";
        if (m.contains("vivo") || m.contains("iqoo"))
            return "vivo/iQOO：i管家 → 应用管理 → Unimate → 允许「自启动」；电池 → 后台耗电管理选「允许后台高耗电」；并在最近任务里把本应用下拉锁定";
        if (m.contains("huawei") || m.contains("honor"))
            return "华为/荣耀：设置 → 应用 → 启动管理 → Unimate 关闭「自动管理」并打开全部开关；电池 → 更多电池设置关闭「智能省电模式」";
        if (m.contains("samsung"))
            return "三星：设置 → 常规管理 → 电池 → 后台使用限制，确认 Unimate 不在「让应用休眠」列表里";
        return "如长时间不提醒，请到系统「设置 → 电池 / 应用管理」里允许 Unimate 自启动与后台运行";
    }

    private boolean canExact() {
        try {
            if (android.os.Build.VERSION.SDK_INT < 31) return true;
            android.app.AlarmManager am = (android.app.AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            return am == null || am.canScheduleExactAlarms();
        } catch (Exception e) { return false; }
    }

    /** 申请加入电池优化白名单：先试系统直连弹窗（一键允许），被拒时退回设置列表页。 */
    @PluginMethod
    public void requestIgnoreBattery(PluginCall call) {
        JSObject ret = new JSObject();
        String pkg = getContext().getPackageName();
        try {
            android.content.Intent it = new android.content.Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    android.net.Uri.parse("package:" + pkg));
            it.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(it);
            ret.put("ok", true); ret.put("mode", "dialog"); ret.put("error", "");
        } catch (Exception e) {
            try {
                android.content.Intent it2 = new android.content.Intent(
                        android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                it2.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(it2);
                ret.put("ok", true); ret.put("mode", "list"); ret.put("error", "");
            } catch (Exception e2) {
                ret.put("ok", false); ret.put("mode", "");
                ret.put("error", "系统未提供该入口，请到 设置 → 电池 → 应用启动管理 里手动允许 Unimate 后台运行");
            }
        }
        call.resolve(ret);
    }

    /** 跳系统"闹钟和提醒"授权页（Android 12+ 精确闹钟可能被拒）。 */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                android.content.Intent it = new android.content.Intent(
                        android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        android.net.Uri.parse("package:" + getContext().getPackageName()));
                it.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(it);
                ret.put("ok", true);
            } else { ret.put("ok", true); }
            ret.put("error", "");
        } catch (Exception e) { ret.put("ok", false); ret.put("error", e.getMessage()); }
        call.resolve(ret);
    }

    /**
     * 提醒兜底心跳的状态（v2.31）：让 App 能显示"心跳到底排上了没、上次补投了几条"。
     * 光有代码不算数 —— 真机上要先能证明它真的在跑。
     */
    @PluginMethod
    public void heartbeatStatus(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            // JSObject 没有 putAll（第一次写就踩了，编译直接红）：逐个键拷过去
            for (java.util.Map.Entry<String, Object> e : ReminderHeartbeat.status(getContext()).entrySet()) {
                ret.put(e.getKey(), e.getValue());
            }
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("error", e.getMessage() == null ? "查询失败" : e.getMessage());
        }
        call.resolve(ret);
    }

    /**
     * 界面字号。用 WebView 原生 textZoom 而不是 CSS zoom：
     * 只放大文字、不改变布局坐标系，课表拖动/抓取那些按像素算的交互不会被缩放带偏。
     */
    @PluginMethod
    public void setTextZoom(PluginCall call) {
        JSObject ret = new JSObject();
        int percent = 100;
        try {
            Integer req = call.getInt("percent");
            if (req != null) percent = req;
            if (percent < 70) percent = 70;
            if (percent > 180) percent = 180;
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().getSettings().setTextZoom(percent);
                ret.put("ok", true);
                ret.put("applied", percent);
                ret.put("error", "");
            } else {
                ret.put("ok", false);
                ret.put("applied", 0);
                ret.put("error", "主 WebView 尚未就绪");
            }
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("applied", 0);
            ret.put("error", e.getMessage() == null ? "设置失败" : e.getMessage());
        }
        call.resolve(ret);
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
