package com.lxmod.music.lyric;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.os.Looper;
import android.widget.TextView;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

/**
 * 桌面歌词渲染回归测试（1.22.40）
 *
 * 用 Robolectric 真实创建 View 树，锁住这次修复的核心不变量：
 * 「任何时刻屏幕上只存在一份歌词文本」。
 *
 * 旧实现是 TextSwitcher + 两个 TextView，换行时 outAnim / inAnim 同时播放，
 * 两个 View 都没有背景，于是新旧两句叠在一起 —— 用户看到的就是
 * 「红色歌词糊了一下，然后又重新渲染」。
 */
@RunWith(RobolectricTestRunner.class)
// 必须绕开项目的 MainApplication：它在 onCreate 里初始化 Hermes / RN 导航，
// JVM 单元测试没有 so 库，会在测试启动阶段就抛 NoClassDefFoundError。
@Config(sdk = 33, application = android.app.Application.class)
public class LyricRenderTest {

  private Context context() {
    return RuntimeEnvironment.getApplication();
  }

  private void idle() {
    Shadows.shadowOf(Looper.getMainLooper()).idle();
  }

  @Test
  public void containerHoldsExactlyOneTextChild() {
    LyricSwitchView view = new LyricSwitchView(context(), false, false);

    assertEquals("歌词容器只能有一个文本子视图，否则换行时必然出现两份文本", 1, view.getChildCount());
    assertTrue(view.getChildAt(0) instanceof LyricTextView);
  }

  @Test
  public void switchingLinesNeverCreatesSecondTextChild() {
    LyricSwitchView view = new LyricSwitchView(context(), false, true);

    view.setText("锐利伤悲");
    idle();
    assertEquals(1, view.getChildCount());
    assertEquals("锐利伤悲", view.getText().toString());

    // 切到下一句：旧的实现会在这里同时保留两行文本做交叉动画
    view.setText("我的心已经等你好好多年");
    idle();

    assertEquals("换行后仍然只允许一个文本子视图", 1, view.getChildCount());
    assertEquals("我的心已经等你好好多年", view.getText().toString());
    assertEquals("换行后透明度必须回到完整值，不能停在动画中间态", 1f, view.getChildAt(0).getAlpha(), 0.001f);
  }

  @Test
  public void sameLineRedeliveryDoesNotRestartRendering() {
    LyricSwitchView view = new LyricSwitchView(context(), false, true);
    view.setText("锐利伤悲");
    idle();

    TextView child = (TextView) view.getChildAt(0);
    // 暂停恢复、seek 回同一行时播放器会重复下发当前行
    view.setText("锐利伤悲");
    idle();

    assertEquals("同一句重复下发不应替换视图", child, view.getChildAt(0));
    assertEquals("锐利伤悲", view.getText().toString());
  }

  @Test
  public void alphaIsAppliedOnceNotMultiplied() {
    LyricSwitchView view = new LyricSwitchView(context(), false, false);
    view.setText("锐利伤悲");
    idle();
    view.setAlpha(0.6f);
    idle();

    assertEquals(1f, view.getAlpha(), 0.001f);
    assertEquals(0.6f, view.getChildAt(0).getAlpha(), 0.001f);
  }

  @Test
  public void translationEqualToMainLineIsDropped() {
    LyricPlayer player = new LyricPlayer();

    // 翻译文件经常直接把原文抄一遍，这是「红字和黑字一模一样」的来源
    String lrc = "[00:01.00]锐利伤悲\n[00:03.00]我的心已经等你好好多年";
    ArrayList<String> extended = new ArrayList<>();
    extended.add("[00:01.00]锐利伤悲\n[00:03.00]我的心已经等你好好多年");
    player.setLyric(lrc, extended);

    assertEquals(2, player.lines.size());
    for (Object line : player.lines) {
      ArrayList<String> extra = (ArrayList<String>) ((HashMap) line).get("extendedLyrics");
      assertNotNull(extra);
      assertTrue("译文与正文相同时不能挂到 extendedLyrics", extra.isEmpty());
    }
  }

  @Test
  public void distinctTranslationIsKeptOnce() {
    LyricPlayer player = new LyricPlayer();

    String lrc = "[00:01.00]Hello\n[00:03.00]World";
    ArrayList<String> extended = new ArrayList<>();
    extended.add("[00:01.00]你好\n[00:01.00]你好\n[00:03.00]世界");
    player.setLyric(lrc, extended);

    HashMap first = (HashMap) player.lines.get(0);
    ArrayList<String> extra = (ArrayList<String>) first.get("extendedLyrics");
    assertEquals("同一句译文重复出现只保留一份", 1, extra.size());
    assertEquals("你好", extra.get(0));
  }

  @Test
  public void placeholderTranslationIsDropped() {
    LyricPlayer player = new LyricPlayer();

    ArrayList<String> extended = new ArrayList<>();
    extended.add("[00:01.00]//\n[00:03.00]世界");
    player.setLyric("[00:01.00]Hello\n[00:03.00]World", extended);

    ArrayList<String> first = (ArrayList<String>) ((HashMap) player.lines.get(0)).get("extendedLyrics");
    assertEquals("`//` 是「无翻译」占位，不能渲染出来", 0, first.size());
  }

  @Test
  public void multiTimestampLineIsExpandedWithoutDuplicatingText() {
    LyricPlayer player = new LyricPlayer();

    // 副歌常用「一行挂多个时间标签」，展开后每处只应出现一次正文
    ArrayList<String> extended = new ArrayList<>();
    player.setLyric("[00:01.00][00:10.00]副歌", extended);

    assertEquals(2, player.lines.size());
    assertEquals("副歌", ((HashMap) player.lines.get(0)).get("text"));
    assertEquals("副歌", ((HashMap) player.lines.get(1)).get("text"));
    for (Object line : player.lines) {
      assertTrue(((ArrayList<String>) ((HashMap) line).get("extendedLyrics")).isEmpty());
    }
  }

  @Test
  public void linesAreSortedByTime() {
    LyricPlayer player = new LyricPlayer();
    ArrayList<String> extended = new ArrayList<>();
    player.setLyric("[00:05.00]third\n[00:01.00]first\n[00:03.00]second", extended);

    List<String> texts = new ArrayList<>();
    for (Object line : player.lines) texts.add(String.valueOf(((HashMap) line).get("text")));
    assertEquals("[first, second, third]", texts.toString());
  }
}
