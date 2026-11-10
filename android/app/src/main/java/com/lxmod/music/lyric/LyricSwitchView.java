package com.lxmod.music.lyric;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Typeface;
import android.text.TextPaint;
import android.widget.FrameLayout;
import android.widget.TextView;


import java.util.ArrayList;

/**
 * 桌面歌词的文本容器（1.22.40 重写）
 *
 * 原实现继承 TextSwitcher，内部两个 TextView 交替显示。换行时 TextSwitcher 会把
 * 「旧文本 outAnim + 新文本 inAnim」同时播放 300ms：两个 View 都没有背景，于是
 * 新旧两句歌词在同一位置叠加渲染，逐字高亮还会在动画期间继续推进。
 * 用户看到的就是「字糊了一下、然后又重新出现」，也就是反馈里的
 * 「红色歌词渲染卡一点然后重新渲染」。
 *
 * 现在改为单个 LyricTextView：
 * - setText 直接生效，任何时刻屏幕上只有一份文本，物理上不可能叠字；
 * - 需要过渡时只对这一个 View 做整体淡入（alpha 0.85 → 1，90ms），
 *   不做位移、不做双 View 交叉，所以不会有重影；
 * - 对外方法名与原来保持一致，LyricView 的调用点无需改动。
 */
@SuppressLint({"ViewConstructor", "AppCompatCustomView"})
public final class LyricSwitchView extends FrameLayout {
  private final LyricTextView textView;

  private boolean isShowAnima;
  private boolean isSingleLine;
  /** LyricView.setAlpha 设置的整体透明度。淡入动画以它为上限，避免覆盖用户在设置里的透明度 */
  private float baseAlpha = 1f;
  /** 每次换行自增，用来丢弃上一次淡入动画的残留回调 */
  private int animToken = 0;
  private ValueAnimator fadeAnim;

  public LyricSwitchView(Context context, boolean isSingleLine, boolean isShowAnima) {
    super(context);
    this.isShowAnima = isShowAnima;
    this.isSingleLine = isSingleLine;

    textView = new LyricTextView(context);
    addView(textView, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
  }

  /**
   * 设置歌词文本。
   *
   * 只在内容真的变化时才重设，避免同一句重复下发时白跑一次淡入 ——
   * 播放器在暂停恢复、seek 回同一行时都会重复下发当前行。
   */
  public void setText(CharSequence str) {
    CharSequence next = str == null ? "" : str;
    CharSequence current = textView.getText();
    if (current != null && current.toString().contentEquals(next)) return;
    textView.setText(next);
    playFadeIn();
  }

  /** 整窗淡入：只改一个 View 的 alpha，不会有第二份文本参与合成 */
  private void playFadeIn() {
    cancelFade();
    if (!isShowAnima) {
      textView.setAlpha(baseAlpha);
      return;
    }
    final int token = ++animToken;
    ValueAnimator anim = ValueAnimator.ofFloat(0.85f, 1f);
    anim.setDuration(90L);
    anim.addUpdateListener(animation -> {
      if (token != animToken) return;
      textView.setAlpha(baseAlpha * (float) animation.getAnimatedValue());
    });
    anim.addListener(new AnimatorListenerAdapter() {
      @Override
      public void onAnimationEnd(Animator animation) {
        if (token != animToken) return;
        textView.setAlpha(baseAlpha);
      }
    });
    fadeAnim = anim;
    anim.start();
  }

  private void cancelFade() {
    animToken++;
    if (fadeAnim != null) {
      fadeAnim.cancel();
      fadeAnim = null;
    }
    textView.setAlpha(baseAlpha);
  }

  public void setShowAnima(boolean showAnima) {
    isShowAnima = showAnima;
    if (!showAnima) cancelFade();
  }

  public CharSequence getText() {
    CharSequence text = textView.getText();
    return text == null ? "" : text;
  }

  public TextPaint getPaint() {
    return textView.getPaint();
  }

  public void setWidth(int i) {
    textView.setWidth(i);
  }

  public void setHeight(int i) {
    textView.setHeight(i);
  }

  public void setTextColor(int i) {
    textView.setTextColor(i);
  }

  public void setKaraokeWords(ArrayList<long[]> words) {
    textView.setKaraokeWords(words);
  }

  /** 末行唱完 / 换行重新开始：同步到当前显示的歌词 View */
  public void setLineFinished(boolean finished) {
    textView.setLineFinished(finished);
  }

  public void setKaraokeClock(LyricTextView.KaraokeClock clock) {
    textView.setKaraokeClock(clock);
  }

  public void setPlayedPaintColor(int color) {
    textView.setPlayedPaintColor(color);
  }

  public void setUnplayedPaintColor(int color) {
    textView.setUnplayedPaintColor(color);
  }

  public void setShadowColor(int i) {
    // https://stackoverflow.com/a/28367917
    textView.setShadowLayer(1.6f, 1.5f, 1.3f, i);
  }

  public void setSourceText(CharSequence str) {
    textView.setText(str);
  }

  public void setLetterSpacings(float letterSpacing) {
    textView.setLetterSpacing(letterSpacing);
  }

  public void setTypeface(Typeface typeface) {
    textView.setTypeface(typeface);
  }

  public void setSingleLine(boolean bool) {
    isSingleLine = bool;
    textView.setSingleLine(bool);
  }

  public void setMaxLines(int i) {
    textView.setMaxLines(i);
  }

  /**
   * 整体透明度只作用在子 View 上。
   *
   * 不能同时给容器 super.setAlpha(alpha)：两层 alpha 会相乘（0.8 × 0.8 = 0.64），
   * 用户把透明度调到 60% 时会看起来像 36%。
   */
  @Override
  public void setAlpha(float alpha) {
    baseAlpha = alpha;
    cancelFade();
    textView.setAlpha(alpha);
  }

  public void setTextSize(float f) {
    textView.setTextSize(f);
  }

  public void setGravity(int i) {
    textView.setGravity(i);
  }

  /** 兼容旧调用：TextSwitcher 时代的「当前视图」概念现在已经不存在 */
  public int getDisplayedChild() {
    return 0;
  }

  /** 供 LyricView 获取实际绘制的文本视图（单视图下始终存在） */
  public TextView getCurrentTextView() {
    return textView;
  }

  public boolean isSingleLine() {
    return isSingleLine;
  }
}
