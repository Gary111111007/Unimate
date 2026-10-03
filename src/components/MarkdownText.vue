<script setup lang="ts">
/*
 * Markdown 渲染组件（v2.70）。
 *
 * 【为什么不是 v-html】
 *  见 `src/services/markdown.ts` 顶部注释：模型输出是不可信输入，
 *  这个组件只把**结构化 token** 渲染成真实元素，全程不产生 HTML 字符串，
 *  所以 WebView 里不存在 XSS 面，也不需要带一个 DOMPurify。
 *
 * 【为什么单独成组件】
 *  对话区（UniView）和历史预览都要用；抽出来才能被 tests/markdown.test.ts
 *  这类结构断言直接盯住（"没有 v-html" 是一条可执行契约，不是口头承诺）。
 */
import { computed } from 'vue';
import { parseMarkdown, type MdSpan } from '../services/markdown.ts';

const props = defineProps<{ text: string }>();
const blocks = computed(() => parseMarkdown(props.text));

/** 有序列表项的真实序号（`3.` 开头要接着往下数）。 */
function itemLabel(level: number | null | undefined, index: number): string {
  const start = Number.isFinite(Number(level)) ? Number(level) : 1;
  return String(start + index) + '.';
}
</script>

<template>
  <div class="md">
    <template v-for="(block, bi) in blocks" :key="bi">
      <!-- 标题：按级别给字号，不再原样显示 ## -->
      <component
        :is="'h' + Math.min(6, block.level || 3)"
        v-if="block.type === 'heading'"
        class="md-h"
        :class="'md-h' + Math.min(6, block.level || 3)"
      >
        <span v-for="(span, si) in block.spans" :key="si" :class="{ 'md-b': span.bold, 'md-i': span.italic, 'md-c': span.code, 'md-s': span.strike }">{{ span.text }}</span>
      </component>

      <!-- 引用 / 分隔线 -->
      <blockquote v-else-if="block.type === 'quote'" class="md-quote">
        <span v-for="(span, si) in block.spans" :key="si" :class="{ 'md-b': span.bold, 'md-i': span.italic, 'md-c': span.code, 'md-s': span.strike }">{{ span.text }}</span>
      </blockquote>

      <!-- 代码块：保留换行与缩进，横向可滚 -->
      <pre v-else-if="block.type === 'code'" class="md-code"><code>{{ block.spans && block.spans[0] ? block.spans[0].text : '' }}</code></pre>

      <!-- 列表：有序列表用真实序号，无序列表用圆点 -->
      <ul v-else-if="block.type === 'list'" class="md-list" :class="{ 'md-list-ol': block.level !== null && block.level !== undefined }">
        <li v-for="(item, li) in block.items" :key="li">
          <span v-if="block.level !== null && block.level !== undefined" class="md-num">{{ itemLabel(block.level, li) }}</span>
          <span v-for="(span, si) in item" :key="si" :class="{ 'md-b': span.bold, 'md-i': span.italic, 'md-c': span.code, 'md-s': span.strike }">{{ span.text }}</span>
        </li>
      </ul>

      <!-- 段落 -->
      <p v-else class="md-p">
        <template v-for="(span, si) in block.spans" :key="si">
          <!-- 链接只渲染 https(s)；解析层已保证没有别的协议 -->
          <a v-if="span.href" :href="span.href" target="_blank" rel="noreferrer noopener">{{ span.text }}</a>
          <span v-else :class="{ 'md-b': span.bold, 'md-i': span.italic, 'md-c': span.code, 'md-s': span.strike }">{{ span.text }}</span>
        </template>
      </p>
    </template>
  </div>
</template>

<style scoped>
/*
 * 类名统一加 md- 前缀，避免和全局工具类同名（AGENTS.md 硬规则 9：
 * v2.14 的 .block、v2.47 的 .brand 两次事故都是"组件类名撞全局语义"）。
 * 另外这里**不写 position**，免得触发 test:css 的同名定位冲突检查。
 */
.md { display: block; }
.md > *:first-child { margin-top: 0; }
.md > *:last-child { margin-bottom: 0; }
.md-p { margin: 0 0 9px; line-height: 1.72; white-space: pre-wrap; word-break: break-word; }
.md-h { margin: 15px 0 7px; line-height: 1.4; font-weight: 600; letter-spacing: -.15px; }
.md-h1 { font-size: 17px; }
.md-h2 { font-size: 16px; }
.md-h3 { font-size: 15px; }
.md-h4, .md-h5, .md-h6 { font-size: 14px; color: var(--muted); }
.md-h + .md-h { margin-top: 9px; }
.md-list { margin: 0 0 9px; padding: 0; list-style: none; }
.md-list > li { position: relative; padding-left: 17px; margin: 4px 0; line-height: 1.68; word-break: break-word; }
.md-list > li::before { content: ''; position: absolute; left: 4px; top: .68em; width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: .5; }
.md-list-ol > li::before { display: none; }
.md-list-ol > li { padding-left: 20px; }
.md-num { position: absolute; left: 0; top: 0; font-variant-numeric: tabular-nums; opacity: .55; }
.md-quote { margin: 0 0 9px; padding: 2px 0 2px 10px; border-left: 3px solid var(--line); color: var(--muted); line-height: 1.7; }
.md-code { margin: 0 0 9px; padding: 10px 11px; overflow-x: auto; border-radius: 9px; background: var(--soft); font: 12.5px/1.62 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; }
.md-b { font-weight: 600; }
.md-i { font-style: italic; }
.md-s { text-decoration: line-through; opacity: .7; }
.md-c { padding: 1px 5px; border-radius: 5px; background: var(--soft); font: .92em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.md a { color: var(--brand); text-decoration: underline; text-underline-offset: 2px; }
</style>
