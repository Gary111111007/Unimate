package com.unimate.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;

/**
 * 可随手指拖动的小圆钮：点一下 = 自动导入课表；按住拖 = 挪到不挡内容的位置。
 *
 * 区分"点击"与"拖动"用的是位移阈值而不是时间，所以慢慢按住不动也算点击；
 * 松手后自动吸到左右两边，避免悬在屏幕中间挡住课件文字。
 */
public class FabImportView extends View {

    public interface Listener { void onTap(); }

    private final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Listener listener;

    private float downX, downY, startTX, startTY;
    private float slop;
    private boolean dragging;
    private boolean busy;
    private boolean pressed;

    public FabImportView(Context c) {
        super(c);
        float dp = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, c.getResources().getDisplayMetrics());
        slop = 8 * dp;
        bg.setColor(Color.parseColor("#2E5AAC"));
        ring.setColor(Color.WHITE);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(2.2f * dp);
        text.setColor(Color.WHITE);
        text.setTextAlign(Paint.Align.CENTER);
        text.setTypeface(Typeface.DEFAULT_BOLD);
        text.setTextSize(12.5f * dp);
        setClickable(true);
    }

    public void setListener(Listener l) { listener = l; }

    public void setBusy(boolean b) {
        if (busy == b) return;
        busy = b;
        invalidate();
    }

    @Override
    protected void onMeasure(int wSpec, int hSpec) {
        float dp = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
        int size = Math.round(52 * dp);
        setMeasuredDimension(size, size);
    }

    @Override
    protected void onDraw(Canvas c) {
        float r = getWidth() / 2f;
        bg.setColor(pressed ? Color.parseColor("#254A8F") : Color.parseColor("#2E5AAC"));
        c.drawCircle(r, r, r - 3f, bg);
        c.drawCircle(r, r, r - 3f, ring);
        String label = busy ? "···" : "导入";
        c.drawText(label, r, r - (text.ascent() + text.descent()) / 2f, text);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        float dp = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = e.getRawX(); downY = e.getRawY();
                startTX = getTranslationX(); startTY = getTranslationY();
                dragging = false; pressed = true;
                invalidate();
                if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                return true;
            case MotionEvent.ACTION_MOVE: {
                float dx = e.getRawX() - downX;
                float dy = e.getRawY() - downY;
                if (!dragging && (Math.abs(dx) > slop || Math.abs(dy) > slop)) dragging = true;
                if (dragging) {
                    ViewGroup p = (ViewGroup) getParent();
                    if (p != null) {
                        float m = 4 * dp;
                        float left = m - getLeft();
                        float right = p.getWidth() - m - getRight();
                        float top = m - getTop();
                        float bottom = p.getHeight() - m - getBottom();
                        setTranslationX(Math.max(left, Math.min(right, startTX + dx)));
                        setTranslationY(Math.max(top, Math.min(bottom, startTY + dy)));
                    }
                }
                return true;
            }
            case MotionEvent.ACTION_UP: {
                pressed = false;
                invalidate();
                if (dragging) { dragging = false; snapToEdge(); }
                else if (listener != null && !busy) { listener.onTap(); }
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
                pressed = false;
                dragging = false;
                invalidate();
                snapToEdge();
                return true;
            default:
                return super.onTouchEvent(e);
        }
    }

    /** 松手后吸到最近的一边，留 10dp 边距，带一点回弹。 */
    private void snapToEdge() {
        final ViewGroup p = (ViewGroup) getParent();
        if (p == null || p.getWidth() == 0) return;
        float dp = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
        float margin = 10 * dp;
        float centerX = getLeft() + getTranslationX() + getWidth() / 2f;
        boolean toLeft = centerX < p.getWidth() / 2f;
        float target = toLeft ? (margin - getLeft()) : (p.getWidth() - margin - getRight());
        float from = getTranslationX();
        if (Math.abs(target - from) < 0.5f) return;
        ValueAnimator a = ValueAnimator.ofFloat(from, target);
        a.setDuration(180);
        a.setInterpolator(new DecelerateInterpolator(1.6f));
        a.addUpdateListener(an -> setTranslationX((Float) an.getAnimatedValue()));
        a.start();
    }
}