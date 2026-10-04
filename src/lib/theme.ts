import type { Theme } from '@/lib/settings-core';

// Keep in sync with the `--moli-bg` tokens in src/app/moli-tokens.css.
// tests/theme-shell.test.mjs asserts both sides still agree.
export const LIGHT_BACKGROUND = '#fafafa';
export const DARK_BACKGROUND = '#0a0a0a';

export type ThemeColor = { color: string; media?: string };

/**
 * The browser UI color for a saved theme. `system` defers to the OS, so it
 * needs both values behind media queries; an explicit choice is a single color.
 */
export function themeBackgroundColor(theme: Theme): ThemeColor | ThemeColor[] {
  if (theme === 'light') return { color: LIGHT_BACKGROUND };
  if (theme === 'dark') return { color: DARK_BACKGROUND };
  return [
    { media: '(prefers-color-scheme: light)', color: LIGHT_BACKGROUND },
    { media: '(prefers-color-scheme: dark)', color: DARK_BACKGROUND },
  ];
}
