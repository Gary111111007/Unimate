package com.unimate.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.LocalNotificationSchedule;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;
import com.getcapacitor.CapConfig;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 提醒兜底心跳（v2.30）。
 *
 * 为什么需要它：插件的排期完全依赖 AlarmManager。真机上"到点不响、一打开 App 全涌出来"的原因是
 * 系统把闹钟攒着，等应用被使用时才发放 —— 精确闹钟没授权（Android 12+ 默认不给）、Doze、
 * 待机桶（App Standby Bucket）/厂商冻结都会这样。
 *
 * 这条心跳**不依赖插件的排期**：
 *   1) 每 15 分钟（近期无排期时拉长到 60 分钟，别白耗电）用 setAndAllowWhileIdle 醒一次；
 *   2) 扫一遍插件持久化的排期，把"刚过期还没投递"的直接投出去，并取消它对应的那条闹钟；
 *   3) 只补"过期 30 分钟以内"的：更早的直接丢弃 —— 与 App 侧"错过的提醒不补发"口径一致，
 *      绝不制造"一打开就一股脑"的轰炸。
 *
 * 注意它的边界（写下来免得以后误判）：如果 ROM 把应用**明确冻结/限制**（后台限制、深度睡眠、
 * 强制停止），系统的闹钟同样不会放行 —— 那种情况只能靠用户在系统里给"精确闹钟 + 电池优化豁免 +
 * 自启动"三件套（App 的课表页与通知设置里会提示缺哪一项）。心跳覆盖的是 Doze / 待机桶 /
 * 进程被杀这些更常见的情况。
 */
public class ReminderHeartbeat extends BroadcastReceiver {

    /** 只给自己用的动作（manifest 里注册，exported=false） */
    public static final String ACTION = "com.unimate.app.REMINDER_TICK";
    private static final int REQUEST_CODE = 20260921;
    /**
     * 有近期排期时的跳频。取 10 分钟：Android 在 Doze 下对"允许待机"的闹钟限制是**每 9 分钟一条**，
     * 再密也不会更快；而 10 分钟能把"最多晚 15 分钟"压到"最多晚 10 分钟"。
     */
    private static final long TICK_MS = 10 * 60 * 1000L;
    private static final long TICK_IDLE_MS = 60 * 60 * 1000L;   // 没有近期排期：一小时一跳（省电）
    private static final long CATCHUP_MS = 30 * 60 * 1000L;     // 只补 30 分钟内错过的
    private static final String INTENT_ID_KEY = "LocalNotificationId";
    private static final String INTENT_OBJ_KEY = "LocalNotficationObject";
    private static final String INTENT_ACTION_KEY = "LocalNotificationUserAction";
    private static final String INTENT_REMOVABLE_KEY = "LocalNotificationRepeating";
    /** 心跳自己的运行痕迹（供"一键自检报告"用） */
    private static final String PREFS = "unimate_heartbeat";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        boolean boot = action != null && (
                Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action));
        try {
            /*
             * 开机走"清场"而不是"补投"（v2.33）。
             *
             * 插件自己的 LocalNotificationRestoreReceiver 也会收到开机广播，它把所有**已过期**的排期
             * 改写成"now + 15 秒"再排出去 —— 真机反馈的"一打开/一开机所有提醒一股脑出来"就是它。
             * 我们的口径是"错过的提醒不补发"，所以开机时：
             *   · 已过期的 → 直接丢掉（连闹钟一起撤）；
             *   · 计划时刻在 20 秒内的 → 也丢掉（这正是被插件改写成 now+15s 的那批；正常排期不会刚好卡在开机那一瞬）；
             * 未来的排期一律不动，交给插件按点投递。
             */
            if (boot) dropOverdueOnBoot(context);
            else runOnce(context);
        } catch (Throwable t) {
            // 心跳绝不能因为异常把整条链路带崩：下一跳照排
        }
        arm(context);
    }

    /**
     * 开机清场：丢掉"已过期"以及"20 秒内就要响"的排期（后者是被插件恢复广播改写成 now+15s 的那批）。
     * 返回丢掉的条数，并记账给 App 看。
     */
    public static int dropOverdueOnBoot(Context context) {
        NotificationStorage storage = new NotificationStorage(context);
        long now = System.currentTimeMillis();
        long soon = now + 20_000L;
        int dropped = 0;
        for (String idStr : new ArrayList<>(storage.getSavedNotificationIds())) {
            LocalNotification n = storage.getSavedNotification(idStr);
            if (n == null || n.getId() == null) continue;
            LocalNotificationSchedule s = n.getSchedule();
            Date at = s == null ? null : s.getAt();
            if (at == null) continue;              // every / on 型排期不归它管
            if (at.getTime() > soon) continue;     // 未来的不动
            cancelPluginAlarm(context, n.getId());
            storage.deleteNotification(idStr);
            dropped++;
        }
        if (dropped > 0) {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit()
                    .putLong("lastDroppedAt", System.currentTimeMillis())
                    .putInt("lastDroppedCount", dropped)
                    .putInt("totalDropped", sp.getInt("totalDropped", 0) + dropped)
                    .apply();
        }
        return dropped;
    }

    /**
     * 扫一遍插件持久化的排期并补投。返回真正投出去的条数（供自检/日志）。
     * 投过的条目会从插件存储里删掉，所以 App 打开时不会重复看到。
     */
    public static int runOnce(Context context) {
        NotificationStorage storage = new NotificationStorage(context);
        CapConfig config = CapConfig.loadDefault(context);
        NotificationManagerCompat nm = NotificationManagerCompat.from(context);
        long now = System.currentTimeMillis();
        int posted = 0;

        List<String> ids = new ArrayList<>(storage.getSavedNotificationIds());
        for (String idStr : ids) {
            LocalNotification n = storage.getSavedNotification(idStr);
            if (n == null || n.getId() == null) continue;
            LocalNotificationSchedule schedule = n.getSchedule();
            Date at = schedule == null ? null : schedule.getAt();
            if (at == null) continue;                       // every / on 型排期不归心跳管
            long t = at.getTime();
            if (t > now) continue;                          // 还没到点
            if (now - t > CATCHUP_MS) {
                // 过期太久：直接丢弃（不补发），同时把那条闹钟也撤掉
                cancelPluginAlarm(context, n.getId());
                storage.deleteNotification(idStr);
                continue;
            }
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) continue;
            if (post(context, nm, config, n)) posted++;
            cancelPluginAlarm(context, n.getId());          // 避免插件那条闹钟稍后再投一次
            storage.deleteNotification(idStr);
        }
        SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor ed = sp.edit().putLong("lastScanAt", System.currentTimeMillis());
        if (posted > 0) {
            ed.putLong("lastPostedAt", System.currentTimeMillis())
              .putInt("lastPostedCount", posted)
              .putInt("totalPosted", sp.getInt("totalPosted", 0) + posted);
        }
        ed.apply();
        return posted;
    }

    /**
     * 心跳状态（给 App 的"自检报告"用）：有没有排上、下一跳什么时候、上次补投了几条、累计几条。
     * 没有这些数字的话，"心跳到底跑没跑"就只能靠猜。
     */
    public static Map<String, Object> status(Context context) {
        Map<String, Object> o = new LinkedHashMap<>();
        try {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            long armedAt = sp.getLong("armedAt", 0);
            long nextAt = sp.getLong("nextAt", 0);
            long lastScanAt = sp.getLong("lastScanAt", 0);
            long lastPostedAt = sp.getLong("lastPostedAt", 0);
            o.put("armedAt", armedAt);
            o.put("nextAt", nextAt);
            o.put("lastScanAt", lastScanAt);
            o.put("lastRunAt", lastScanAt);   // 兼容旧字段名
            o.put("lastPostedAt", lastPostedAt);
            o.put("lastPostedCount", sp.getInt("lastPostedCount", 0));
            o.put("totalPosted", sp.getInt("totalPosted", 0));
            o.put("lastDroppedAt", sp.getLong("lastDroppedAt", 0));
            o.put("lastDroppedCount", sp.getInt("lastDroppedCount", 0));
            o.put("totalDropped", sp.getInt("totalDropped", 0));
            o.put("armed", armedAt > 0);
            o.put("pendingNext", nextAt > System.currentTimeMillis());
        } catch (Throwable t) {
            o.put("armed", false);
        }
        return o;
    }

    /** 用与插件一致的渠道/图标/点击载荷投一条通知 */
    private static boolean post(Context context, NotificationManagerCompat nm, CapConfig config, LocalNotification n) {
        try {
            String channelId = n.getChannelId() != null
                    ? n.getChannelId()
                    : LocalNotificationManager.DEFAULT_NOTIFICATION_CHANNEL_ID;
            Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (open == null) return false;
            open.setAction(Intent.ACTION_MAIN);
            open.addCategory(Intent.CATEGORY_LAUNCHER);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            // 这三个 extra 就是插件点通知时读的那几个：App 侧据此切页并弹出对应课程/记事
            open.putExtra(INTENT_ID_KEY, n.getId());
            open.putExtra(INTENT_ACTION_KEY, "tap");
            try {
                if (n.getSource() != null) open.putExtra(INTENT_OBJ_KEY, n.getSource().toString());
            } catch (Throwable ignored) { }
            open.putExtra(INTENT_REMOVABLE_KEY, true);

            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent content = PendingIntent.getActivity(context, n.getId(), open, piFlags);

            NotificationCompat.Builder b = new NotificationCompat.Builder(context, channelId)
                    .setContentTitle(n.getTitle())
                    .setContentText(n.getBody())
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setSmallIcon(R.drawable.ic_stat_icon)
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setContentIntent(content);
            nm.notify(n.getId(), b.build());
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 撤掉插件给这条通知排的闹钟（PendingIntent 匹配只看组件+请求码，所以能精确撤掉） */
    private static void cancelPluginAlarm(Context context, int id) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent(context, TimedNotificationPublisher.class);
            i.putExtra(INTENT_ID_KEY, id);
            int flags = PendingIntent.FLAG_CANCEL_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(context, id, i, flags);
            am.cancel(pi);
        } catch (Throwable ignored) { }
    }

    /** 排下一跳。近期有排期就 15 分钟一跳，否则一小时一跳（省电）。 */
    public static void arm(Context context) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long now = System.currentTimeMillis();
            long nearest = Long.MAX_VALUE;
            NotificationStorage storage = new NotificationStorage(context);
            for (String idStr : storage.getSavedNotificationIds()) {
                LocalNotification n = storage.getSavedNotification(idStr);
                if (n == null || n.getSchedule() == null || n.getSchedule().getAt() == null) continue;
                long t = n.getSchedule().getAt().getTime();
                if (t > now && t < nearest) nearest = t;
            }
            long delay = (nearest - now <= 60 * 60 * 1000L) ? TICK_MS : TICK_IDLE_MS;
            Intent i = new Intent(context, ReminderHeartbeat.class).setAction(ACTION);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(context, REQUEST_CODE, i, flags);
            long next = now + delay;
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
            } catch (Throwable t) {
                am.set(AlarmManager.RTC_WAKEUP, next, pi);
            }
            // 记下"什么时候排的、下一跳在什么时候"——自检报告里要显示出来
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putLong("armedAt", now)
                    .putLong("nextAt", next)
                    .apply();
        } catch (Throwable ignored) { }
    }
}
