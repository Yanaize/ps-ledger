export const THEMES = [
  'signature',
  'oled',
  'midnight',
  'graphite',
  'aurora',
  'light',
  'playstation',
] as const;

export type ThemeId = (typeof THEMES)[number];

export const ACCENTS = ['theme', 'blue', 'indigo', 'purple', 'cyan', 'emerald', 'orange', 'rose'] as const;
export type AccentId = (typeof ACCENTS)[number];

export const THEME_META: Record<ThemeId, { name: string; bg: string; surface: string; accent: string; text: string }> = {
  signature: { name: 'Signature', bg: '#090b10', surface: '#12151c', accent: '#9eb0c8', text: '#f4f1ea' },
  oled: { name: 'OLED', bg: '#000000', surface: '#0c0c0c', accent: '#7eb6ff', text: '#f7f7f5' },
  midnight: { name: 'Midnight', bg: '#070b16', surface: '#10182a', accent: '#8fd0e8', text: '#e7eefc' },
  graphite: { name: 'Graphite', bg: '#121212', surface: '#1a1a1a', accent: '#b7c0cc', text: '#eceae6' },
  aurora: { name: 'Aurora', bg: '#0b1020', surface: '#14182a', accent: '#b7a0e8', text: '#f3f0ff' },
  light: { name: 'Light', bg: '#f4f1ea', surface: '#fffcf7', accent: '#2c4c8c', text: '#1c1915' },
  playstation: { name: 'PlayStation', bg: '#061428', surface: '#0c2244', accent: '#4aa3ff', text: '#f4f7ff' },
};

const KEYS = {
  theme: 'ps-ledger-theme',
  accent: 'ps-ledger-accent',
  follow: 'ps-ledger-follow-system',
  contrast: 'ps-ledger-contrast',
  custom: 'ps-ledger-custom-accent',
};

export function isTheme(value: string | null | undefined): value is ThemeId {
  return !!value && (THEMES as readonly string[]).includes(value);
}

export function isAccent(value: string | null | undefined): value is AccentId {
  return !!value && (ACCENTS as readonly string[]).includes(value);
}

export function systemTheme(): ThemeId {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'playstation';
}

function contrastOk(hex: string, against: string): boolean {
  const l1 = luminance(hex);
  const l2 = luminance(against);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return ratio >= 3;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function mix(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyCustomAccent(hex: string): boolean {
  const root = document.documentElement;
  const bg = getComputedStyle(root).getPropertyValue('--bg-app').trim() || '#090b10';
  const normalized = hex.startsWith('#') ? hex : `#${hex}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized) || !contrastOk(normalized, bg)) return false;
  const on = luminance(normalized) > 0.55 ? '#121212' : '#f4f1ea';
  root.style.setProperty('--accent', normalized);
  root.style.setProperty('--accent-muted', mix(normalized, 0.16));
  root.style.setProperty('--accent-border', mix(normalized, 0.5));
  root.style.setProperty('--ivory', normalized);
  root.style.setProperty('--ivory-muted', mix(normalized, 0.14));
  root.style.setProperty('--best-border', mix(normalized, 0.45));
  root.style.setProperty('--on-accent', on);
  root.dataset.accent = 'custom';
  localStorage.setItem(KEYS.custom, normalized);
  return true;
}

export function clearCustomAccent() {
  const root = document.documentElement;
  for (const name of ['--accent', '--accent-muted', '--accent-border', '--ivory', '--ivory-muted', '--best-border', '--on-accent']) {
    root.style.removeProperty(name);
  }
}

export function applyAppearance(input: {
  theme?: string | null;
  accent?: string | null;
  followSystem?: boolean;
  highContrast?: boolean;
  customAccent?: string | null;
}) {
  const follow = Boolean(input.followSystem);
  const theme: ThemeId = follow ? systemTheme() : isTheme(input.theme) ? input.theme : 'playstation';
  const accent: AccentId = isAccent(input.accent) ? input.accent : 'theme';
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.contrast = input.highContrast ? 'high' : 'off';
  clearCustomAccent();
  if (input.accent === 'custom' && input.customAccent && applyCustomAccent(input.customAccent)) {
    root.dataset.accent = 'custom';
  } else {
    root.dataset.accent = accent;
  }
  localStorage.setItem(KEYS.theme, theme);
  localStorage.setItem(KEYS.accent, root.dataset.accent);
  localStorage.setItem(KEYS.follow, follow ? '1' : '0');
  localStorage.setItem(KEYS.contrast, input.highContrast ? '1' : '0');
}

export function readStoredAppearance() {
  return {
    theme: localStorage.getItem(KEYS.theme),
    accent: localStorage.getItem(KEYS.accent),
    followSystem: localStorage.getItem(KEYS.follow) === '1',
    highContrast: localStorage.getItem(KEYS.contrast) === '1',
    customAccent: localStorage.getItem(KEYS.custom),
  };
}
