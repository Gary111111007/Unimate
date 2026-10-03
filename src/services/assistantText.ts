const LEADING_DECORATIVE_ICON = /^(\s*(?:(?:[-*+]|\d+[.)])\s+)?)(?:\p{Extended_Pictographic}[\uFE0E\uFE0F\u200D\p{Emoji_Modifier}\p{Extended_Pictographic}]*\s*)+/u;

/**
 * Uni 的正文保持与 App 相同的单色、内容优先风格。
 * 只移除每行开头（含 Markdown 列表符之后）的彩色 Emoji，句子正文中的 Emoji 不动。
 */
export function normalizeAssistantText(raw: unknown): string {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.replace(LEADING_DECORATIVE_ICON, '$1'))
    .join('\n')
    .trim();
}
