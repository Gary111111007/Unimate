package com.unimate.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Unimate 自己的单条提醒接收器。
 *
 * Capacitor 原接收器不判断迟到多久：ROM 把闹钟扣住几小时后，只要应用被打开，旧提醒就会全部弹出。
 * 这里先按原计划时刻验迟到窗口，再决定投递或丢弃，因此既能锁屏到点提醒，也不会启动时轰炸。
 */
public class ReminderAlarmReceiver extends BroadcastReceiver {
    public static final String ACTION = "com.unimate.app.REMINDER_DELIVER";
    public static final String EXTRA_ID = "unimate_notification_id";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        int id = intent.getIntExtra(EXTRA_ID, Integer.MIN_VALUE);
        if (id == Integer.MIN_VALUE) return;
        try { ReminderHeartbeat.deliverById(context, id); } catch (Throwable ignored) { }
        try { ReminderHeartbeat.arm(context); } catch (Throwable ignored) { }
    }
}
