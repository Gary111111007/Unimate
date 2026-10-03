package com.unimate.app;

import android.content.Context;
import android.content.Intent;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.provider.CalendarContract;
import android.os.PowerManager;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;

/**
 * 内嵌教务/在线平台 WebView。
 * 只读取指定容器的 outerHTML（默认 #kbgrid_table_0），不读取表单内容、不读取 Cookie 值、
 * 不代填账号密码 —— 对应 PRD 5.4.8 与第 10.8 节质量红线。
 *
 * v2.67：语音输入已下线（Uni 只做文字对话）。此处不再声明 microphone 权限，
 * 也不再包含任何语音识别/系统键盘桥方法；录音权限已从 AndroidManifest 同步移除。
 */
@CapacitorPlugin(name = "JwWebView", permissions = {
        // v2.56：**选择性**把提醒写进系统日历才需要这两个权限；默认关，用户点开关时才申请。
        @com.getcapacitor.annotation.Permission(alias = "calendar", strings = {
                android.Manifest.permission.READ_CALENDAR, android.Manifest.permission.WRITE_CALENDAR })
})
public class JwWebViewPlugin extends Plugin {

    public static final String EXTRA_URL = "unimate:url";
    public static final String EXTRA_TITLE = "unimate:title";
    public static final String EXTRA_SELECTOR = "unimate:selector";
    public static final String EXTRA_ALLOW_EXTERNAL = "unimate:allowExternal";
    /** timetable = 抓课表；exam = 抓考试（按钮常驻，叫「识别考试」）；campus = 校园数据；zfimport = 正方接口导入 */
    public static final String EXTRA_MODE = "unimate:mode";
    public static final String EXTRA_ACTION_LABEL = "unimate:actionLabel";
    /** zfimport 专用：课表接口参数（v2.68）。学期码由前端用 zfClient.xqmOf() 算好传入 */
    public static final String EXTRA_ZF_XNM = "unimate:zfXnm";
    public static final String EXTRA_ZF_XQM = "unimate:zfXqm";
    public static final String EXTRA_ZF_GNMKDM = "unimate:zfGnmkdm";
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
        intent.putExtra(EXTRA_ACTION_LABEL, call.getString("actionLabel", "读取当前结果"));
        intent.putExtra(EXTRA_ALLOW_EXTERNAL, Boolean.TRUE.equals(call.getBoolean("allowExternal", false)));
        // zfimport（v2.68）：正方课表接口参数，原样透传给 Activity
        intent.putExtra(EXTRA_ZF_XNM, call.getString("zfXnm", ""));
        intent.putExtra(EXTRA_ZF_XQM, call.getString("zfXqm", ""));
        intent.putExtra(EXTRA_ZF_GNMKDM, call.getString("zfGnmkdm", ""));
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
    /**
     * 通知渠道 + 待机状态自检（v2.53）。
     *
     * 为什么加这个：产品负责人多轮反馈"到点不响"，而自检报告里只有"系统通知权限 granted" ——
     * 那是**应用级**开关，**渠道**被系统或用户单独静音/降级时它照样是 granted。
     * Android 8+ 的横幅与声音完全由渠道重要性决定：IMPORTANCE_HIGH 才会横幅弹出，
     * DEFAULT 只是安静地躺进通知栏（用户会以为"根本没提醒"），NONE 则直接丢弃。
     * 所以这里把渠道的真实 importance / 有没有声音 / 是否被屏蔽读出来，再带上 Doze 待机状态。
     */
    /* ---------------------------------------------------------------------
     * v2.56：**选择性**把提醒写进系统日历
     *
     * 背景：产品负责人不愿意开"允许后台运行"，于是国产 ROM 会在后台把 App 冻住，
     * 连系统闹钟回调都要排队 —— 提醒只能等他打开 App 才补发。
     * 写进系统日历后，**闹钟由系统日历 App 持有**（那是系统应用，不受我们被冻结影响），
     * 到点由它弹通知。这是课程表类 App 通行的兜底做法。
     *
     * 三条纪律：默认关；每条都带 CUSTOM_APP_PACKAGE 标记；删除只删自己写的。
     * ------------------------------------------------------------------- */

    @PluginMethod
    public void calendarRequest(PluginCall call) {
        JSObject ret = new JSObject();
        if (getPermissionState("calendar") == com.getcapacitor.PermissionState.GRANTED) {
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("calendar", call, "calendarPermCallback");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void calendarPermCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("calendar") == com.getcapacitor.PermissionState.GRANTED);
        call.resolve(ret);
    }

    /** 找一个可写入的日历（优先主日历）。找不到返回 -1。 */
    private long pickWritableCalendarId() {
        try {
            Cursor c = getContext().getContentResolver().query(
                    CalendarContract.Calendars.CONTENT_URI,
                    new String[] { CalendarContract.Calendars._ID, CalendarContract.Calendars.IS_PRIMARY },
                    CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + " >= ?",
                    new String[] { String.valueOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) },
                    CalendarContract.Calendars.IS_PRIMARY + " DESC");
            if (c == null) return -1;
            try {
                if (c.moveToFirst()) return c.getLong(0);
            } finally { c.close(); }
        } catch (Throwable ignored) { }
        return -1;
    }

    private String calendarName(long id) {
        try {
            Cursor c = getContext().getContentResolver().query(
                    ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, id),
                    new String[] { CalendarContract.Calendars.CALENDAR_DISPLAY_NAME }, null, null, null);
            if (c == null) return "";
            try { if (c.moveToFirst()) return c.getString(0) == null ? "" : c.getString(0); }
            finally { c.close(); }
        } catch (Throwable ignored) { }
        return "";
    }

    /** 已经写进去多少条（按 CUSTOM_APP_PACKAGE 认领，绝不会数到用户自己的日程） */
    private int countOwnEvents() {
        try {
            Cursor c = getContext().getContentResolver().query(
                    CalendarContract.Events.CONTENT_URI, new String[] { CalendarContract.Events._ID },
                    CalendarContract.Events.CUSTOM_APP_PACKAGE + " = ?",
                    new String[] { getContext().getPackageName() }, null);
            if (c == null) return 0;
            try { return c.getCount(); } finally { c.close(); }
        } catch (Throwable ignored) { return 0; }
    }

    private int deleteOwnEvents() {
        try {
            return getContext().getContentResolver().delete(
                    CalendarContract.Events.CONTENT_URI,
                    CalendarContract.Events.CUSTOM_APP_PACKAGE + " = ?",
                    new String[] { getContext().getPackageName() });
        } catch (Throwable ignored) { return 0; }
    }

    @PluginMethod
    public void calendarStatus(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            boolean granted = getPermissionState("calendar") == com.getcapacitor.PermissionState.GRANTED;
            long id = granted ? pickWritableCalendarId() : -1;
            ret.put("permission", granted ? "granted" : "denied");
            ret.put("available", id > 0);
            ret.put("calendar", id > 0 ? calendarName(id) : "");
            ret.put("written", granted ? countOwnEvents() : 0);
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("error", e.getMessage() == null ? "查询失败" : e.getMessage());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void calendarClear(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("removed", deleteOwnEvents());
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("error", e.getMessage() == null ? "清空失败" : e.getMessage());
        }
        call.resolve(ret);
    }

    /**
     * 把一批提醒写进系统日历：**先删掉我们上次写的全部**，再写新的（全量覆盖，避免残留旧课）。
     * 每条事件：开始=提醒时刻、时长 10 分钟、HAS_ALARM=1、并在 Reminders 里加一条"准点提醒"。
     */
    @PluginMethod
    public void calendarSync(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            if (getPermissionState("calendar") != com.getcapacitor.PermissionState.GRANTED) {
                ret.put("ok", false);
                ret.put("error", "没有日历权限");
                call.resolve(ret);
                return;
            }
            long calId = pickWritableCalendarId();
            if (calId <= 0) {
                ret.put("ok", false);
                ret.put("error", "没有可写入的日历");
                call.resolve(ret);
                return;
            }
            ContentResolver cr = getContext().getContentResolver();
            deleteOwnEvents();
            com.getcapacitor.JSArray events = call.getArray("events", new com.getcapacitor.JSArray());
            int written = 0;
            for (int i = 0; i < events.length(); i++) {
                com.getcapacitor.JSObject e;
                try { e = com.getcapacitor.JSObject.fromJSONObject(events.getJSONObject(i)); } catch (Throwable t) { continue; }
                Long at = e.getLong("at");
                String title = e.getString("title");
                Long duration = e.getLong("durationMin");
                if (at == null || title == null) continue;
                long end = at + (duration == null ? 10 : duration) * 60 * 1000L;
                ContentValues v = new ContentValues();
                v.put(CalendarContract.Events.CALENDAR_ID, calId);
                v.put(CalendarContract.Events.TITLE, title);
                v.put(CalendarContract.Events.DESCRIPTION, "由 Unimate 写入（「我的 → 通知设置 → 同步到系统日历」）；关掉那个开关会自动清空");
                v.put(CalendarContract.Events.DTSTART, at);
                v.put(CalendarContract.Events.DTEND, end);
                v.put(CalendarContract.Events.EVENT_TIMEZONE, java.util.TimeZone.getDefault().getID());
                v.put(CalendarContract.Events.HAS_ALARM, 1);
                // 标记：删除时靠它认领，绝不会碰用户自己的日程
                v.put(CalendarContract.Events.CUSTOM_APP_PACKAGE, getContext().getPackageName());
                v.put(CalendarContract.Events.CUSTOM_APP_URI, "unimate://reminder/" + (e.getInteger("id") == null ? i : e.getInteger("id")));
                android.net.Uri uri = cr.insert(CalendarContract.Events.CONTENT_URI, v);
                if (uri == null) continue;
                long eventId = ContentUris.parseId(uri);
                ContentValues r = new ContentValues();
                r.put(CalendarContract.Reminders.EVENT_ID, eventId);
                r.put(CalendarContract.Reminders.MINUTES, 0);
                r.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                cr.insert(CalendarContract.Reminders.CONTENT_URI, r);
                written++;
            }
            ret.put("written", written);
            ret.put("calendar", calendarName(calId));
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("error", e.getMessage() == null ? "写入失败" : e.getMessage());
        }
        call.resolve(ret);
    }

    /**
     * 闹钟条目自检（v2.55）。
     *
     * 为什么需要："排期列表里有 17 条"只能证明**插件数据库**里有，不能证明 **AlarmManager 里还挂着闹钟** ——
     * 被 ROM 清掉、被系统回收、PendingIntent 被替换，都会让排期"看起来在、实际不会响"。
     * `PendingIntent.getBroadcast(..., FLAG_NO_CREATE)` 在条目不存在时返回 null，正好用来验证这一层。
     */
    @PluginMethod
    public void alarmDiagnostics(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            boolean exact = am == null || android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S || am.canScheduleExactAlarms();
            ret.put("exactAllowed", exact);
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                ret.put("useExactAlarm", getContext().checkSelfPermission("android.permission.USE_EXACT_ALARM")
                        == android.content.pm.PackageManager.PERMISSION_GRANTED);
            }
            android.app.AlarmManager.AlarmClockInfo info = am == null ? null : am.getNextAlarmClock();
            ret.put("nextAlarmAt", info == null ? 0L : info.getTriggerTime());
            JSArray ids = call.getArray("ids", new JSArray());
            JSObject entries = new JSObject();
            int alive = 0;
            for (int i = 0; i < ids.length(); i++) {
                // JSArray 继承 org.json.JSONArray：只有 getInt/getString，没有 getInteger（v2.55 编译时被抓出来）
                int id = ids.getInt(i);
                Intent it = new Intent(getContext(), ReminderAlarmReceiver.class)
                        .setAction(ReminderAlarmReceiver.ACTION)
                        .putExtra(ReminderAlarmReceiver.EXTRA_ID, id);
                int flags = PendingIntent.FLAG_NO_CREATE;
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
                PendingIntent pi = PendingIntent.getBroadcast(getContext(), id, it, flags);
                boolean exists = pi != null;
                if (exists) alive++;
                entries.put(Integer.toString(id), exists);
            }
            ret.put("entries", entries);
            ret.put("aliveCount", alive);
            ret.put("checkedCount", ids.length());
            // v2.57：顺带数一数"补位闹钟"（+2 分钟那条）还在不在 —— 它是冻结场景下的第二道保险
            int backup = 0;
            for (int i = 0; i < ids.length(); i++) {
                int id = ids.getInt(i);
                Intent it = new Intent(getContext(), ReminderAlarmReceiver.class)
                        .setAction(ReminderAlarmReceiver.ACTION)
                        .putExtra(ReminderAlarmReceiver.EXTRA_ID, id);
                int flags = PendingIntent.FLAG_NO_CREATE;
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
                if (PendingIntent.getBroadcast(getContext(), id + ReminderHeartbeat.BACKUP_OFFSET, it, flags) != null) backup++;
            }
            ret.put("backupCount", backup);
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("error", e.getMessage() == null ? "查询失败" : e.getMessage());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void notifyChannelStatus(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            ret.put("enabled", nm != null && nm.areNotificationsEnabled());
            JSObject channels = new JSObject();
            JSArray ids = call.getArray("ids", new JSArray());
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.getString(i);
                if (id == null) continue;
                JSObject info = new JSObject();
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O && nm != null) {
                    NotificationChannel ch = nm.getNotificationChannel(id);
                    if (ch == null) {
                        info.put("exists", false);
                    } else {
                        info.put("exists", true);
                        info.put("importance", ch.getImportance());
                        info.put("sound", ch.getSound() != null);
                        info.put("vibration", ch.shouldVibrate());
                        info.put("blocked", ch.getImportance() == NotificationManager.IMPORTANCE_NONE);
                    }
                } else {
                    info.put("exists", true);   // Android 8 以下没有渠道概念
                }
                channels.put(id, info);
            }
            ret.put("channels", channels);
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            ret.put("dozing", pm != null && pm.isDeviceIdleMode());
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("error", e.getMessage() == null ? "查询渠道失败" : e.getMessage());
        }
        call.resolve(ret);
    }

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
     * 读插件里**真正排着**的通知（v2.32）。
     *
     * 为什么必须自己做：Capacitor 的 `LocalNotifications.scheduled()` **在 Android 上没实现**，
     * 调用会直接抛 "not implemented on android" —— 于是 v2.28/v2.30 写的"清理过期排期""投递自检"
     * 在安卓上全是空转（读到空数组 → 什么也不清、missed 永远是 0），"系统已排期 0 条"也是这么来的。
     * 这里直接读插件的 NotificationStorage（它才是排期的真相）。
     */
    @PluginMethod
    public void pendingNotifications(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray arr = new JSArray();
        try {
            NotificationStorage storage = new NotificationStorage(getContext());
            for (String id : storage.getSavedNotificationIds()) {
                LocalNotification n = storage.getSavedNotification(id);
                if (n == null || n.getId() == null) continue;
                JSObject o = new JSObject();
                o.put("id", n.getId());
                o.put("title", n.getTitle() == null ? "" : n.getTitle());
                o.put("body", n.getBody() == null ? "" : n.getBody());
                o.put("channelId", n.getChannelId() == null ? "" : n.getChannelId());
                if (n.getSchedule() != null && n.getSchedule().getAt() != null) {
                    o.put("at", n.getSchedule().getAt().getTime());
                }
                arr.put(o);
            }
            ret.put("items", arr);
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("items", arr);
            ret.put("ok", false);
            ret.put("error", e.getMessage() == null ? "读取失败" : e.getMessage());
        }
        call.resolve(ret);
    }

    /** 将插件排期替换成带“迟到丢弃”保护的原生闹钟。 */
    @PluginMethod
    public void hardenNotifications(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("count", ReminderHeartbeat.hardenAll(getContext()));
            ret.put("ok", true);
            ret.put("error", "");
        } catch (Exception e) {
            ret.put("count", 0);
            ret.put("ok", false);
            ret.put("error", e.getMessage() == null ? "接管排期失败" : e.getMessage());
        }
        call.resolve(ret);
    }

    /**
     * 提醒守护前台服务（v2.34）：开关它。
     * 产品负责人手机上三项系统开关全就绪仍"只有打开 App 才收到提醒"——ColorOS 的后台冻结只能靠前台服务化解。
     */
    @PluginMethod
    public void setReminderGuard(PluginCall call) {
        JSObject ret = new JSObject();
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        try {
            boolean ok = ReminderGuardService.setEnabled(getContext(), on);
            ret.put("ok", ok);
            ret.put("enabled", on);
            ret.put("running", ReminderGuardService.isRunning());
            ret.put("error", ok ? "" : "系统不允许启动前台服务");
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("enabled", on);
            ret.put("running", false);
            ret.put("error", e.getMessage() == null ? "设置失败" : e.getMessage());
        }
        call.resolve(ret);
    }

    /** 提醒守护状态（自检报告用） */
    @PluginMethod
    public void reminderGuardStatus(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("ok", true);
            ret.put("enabled", ReminderGuardService.isEnabled(getContext()));
            ret.put("running", ReminderGuardService.isRunning());
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("enabled", false);
            ret.put("running", false);
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
