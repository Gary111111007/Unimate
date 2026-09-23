package com.unimate.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * 提醒守护前台服务（v2.34）。
 *
 * 为什么需要它：产品负责人的手机（OPPO/ColorOS）在"通知权限 + 精确闹钟 + 电池优化豁免"+ 排期 21 条全部就绪的情况下，
 * 仍然"只有打开 App 才收到提醒"——说明 ColorOS 自己的**后台冻结/自启动**那一层还在拦（他明确不想动那些系统开关）。
 * 前台服务是 App 侧唯一还能做的事：只要进程带着一条前台通知活着，系统就不会把它冻结/进受限待机桶，
 * 插件的闹钟与被心跳补投的提醒都能按时投递。
 *
 * 代价（必须诚实写在界面上）：通知栏常驻一条**最低优先级、静音**的小通知；多一点点耗电。
 * 因此它是一个**开关**（默认开），关掉就回到原来的行为。
 */
public class ReminderGuardService extends Service {

    private static final String CHANNEL_ID = "unimate-guard-v1";
    private static final int NOTIFICATION_ID = 7001;
    private static final String PREFS = "unimate_guard";
    private static final String KEY_ENABLED = "enabled";
    /**
     * 前台服务不能只挂一条通知：那样系统扣住 AlarmManager 时，服务本身什么也不做。
     * 每 15 秒直接检查一次插件的持久化排期；页面和 WebView 都不需要处于打开状态。
     */
    private static final long SCAN_MS = 15_000L;
    /** 供"自检报告"显示：服务到底起没起来（进程内标记） */
    private static volatile boolean running = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable scan = new Runnable() {
        @Override public void run() {
            if (!running || !isEnabled(ReminderGuardService.this)) return;
            try { ReminderHeartbeat.runOnce(ReminderGuardService.this); } catch (Throwable ignored) { }
            handler.postDelayed(this, SCAN_MS);
        }
    };

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "提醒守护", NotificationManager.IMPORTANCE_MIN);
                ch.setDescription("保持 Unimate 的提醒准时送达（可在「我的 → 通知设置」里关闭）");
                ch.setShowBadge(false);
                ch.enableVibration(false);
                ch.setSound(null, null);
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) nm.createNotificationChannel(ch);
            }
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;
            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent content = PendingIntent.getActivity(this, 7001, open, piFlags);
            Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setContentTitle("Unimate 提醒运行中")
                    .setContentText("保持后台提醒准时送达；可在「我的 → 通知设置」关闭")
                    .setSmallIcon(R.drawable.ic_stat_icon)
                    .setOngoing(true)
                    .setShowWhen(false)
                    .setSilent(true)
                    .setPriority(NotificationCompat.PRIORITY_MIN)
                    .setContentIntent(content)
                    .build();
            startForeground(NOTIFICATION_ID, n);
            running = true;
            // 把插件原来的闹钟换成我们自己的防积压接收器；随后立即开始独立扫描。
            ReminderHeartbeat.hardenAll(this);
            handler.removeCallbacks(scan);
            handler.post(scan);
        } catch (Throwable t) {
            // 起不来就退化成普通后台（提醒会退回"打开 App 才补发"的老样子），不能因此崩掉 App
            running = false;
        }
        return START_STICKY;
    }

    /**
     * v2.55：用户从最近任务里**划掉 App** 时会被调用。
     *
     * 国产 ROM 上"划掉"往往等于把进程带走：前台服务虽然声明了 START_STICKY，但被强杀后
     * 系统不一定马上拉起来，而我们排的闹钟是挂在进程外的（AlarmManager 里还在），
     * 只要**再确认一次排期**，就不会出现"划掉之后再也不响"。
     * 这里顺手做两件事：① 重新硬化一遍排期（把最紧急的几条重新排到"下一个闹钟"通道）；
     * ② 显式再启动一次自己，尽量让守护服务活下来。
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        try { ReminderHeartbeat.hardenAll(this); } catch (Throwable ignored) { }
        try { start(this); } catch (Throwable ignored) { }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(scan);
        super.onDestroy();
    }

    // ---------------- 静态开关（App 与心跳都用这两个） ----------------

    public static boolean isEnabled(Context context) {
        try {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true);
        } catch (Throwable t) { return false; }
    }

    public static boolean isRunning() { return running; }

    /** 开/关提醒守护：写标记 + 起停服务（失败只返回 false，不影响其它功能） */
    public static boolean setEnabled(Context context, boolean on) {
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, on).apply();
            if (on) start(context); else stop(context);
            return true;
        } catch (Throwable t) { return false; }
    }

    /** 启动（App 在前台时调用一定成功；开机广播里调用可能被系统拒绝，忽略即可） */
    public static void start(Context context) {
        try {
            Intent i = new Intent(context, ReminderGuardService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(context, i);
            else context.startService(i);
        } catch (Throwable ignored) { }
    }

    public static void stop(Context context) {
        try { context.stopService(new Intent(context, ReminderGuardService.class)); } catch (Throwable ignored) { }
    }
}
