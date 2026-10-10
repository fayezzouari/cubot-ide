import type { CSSProperties } from 'react';

// The app's theme stores bare RGB triples (`--accent: 59 130 246`), and the
// Tailwind colour tokens (`--color-accent: var(--accent)`) are resolved on the
// `.dark` element, so every token-based class gets an invalid colour: the
// shared Button's `hover:text-accent-foreground` falls back to black. The
// Blocks IDE sets valid dark-theme colours (both the base and the `--color-*`
// names) on its root and on its dialogs, which render in a portal. Hover is a
// subtle white wash with bright white text.
const COLORS: Record<string, string> = {
  background: 'transparent',
  foreground: 'rgb(237 237 237)',
  card: 'rgb(10 10 10)',
  'card-foreground': 'rgb(237 237 237)',
  popover: 'rgb(14 14 14)',
  'popover-foreground': 'rgb(237 237 237)',
  primary: 'rgb(59 130 246)',
  'primary-foreground': 'rgb(255 255 255)',
  secondary: 'rgb(255 255 255 / 0.06)',
  'secondary-foreground': 'rgb(255 255 255)',
  muted: 'rgb(255 255 255 / 0.05)',
  'muted-foreground': 'rgb(160 160 160)',
  accent: 'rgb(255 255 255 / 0.09)',
  'accent-foreground': 'rgb(255 255 255)',
  destructive: 'rgb(239 68 68)',
  'destructive-foreground': 'rgb(255 255 255)',
  border: 'rgb(255 255 255 / 0.1)',
  input: 'rgb(255 255 255 / 0.12)',
  ring: 'rgb(255 255 255 / 0.3)',
};

export const BLOCKS_THEME = Object.fromEntries(
  Object.entries(COLORS).flatMap(([name, value]) => [
    [`--${name}`, value],
    [`--color-${name}`, value],
  ]),
) as CSSProperties;
