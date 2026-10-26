// 색상(테마) — 배경·강조·글자·포인트 4가지 기본색에서 나머지 색을 계산해 앱 전체에 적용합니다.
// mode가 'custom'이 아니면 styles.css의 기본 색(기기 라이트/다크 설정을 따라감)을 씁니다.

const THEME_KEY = 'planner.theme.v1';

export const PRESETS = [
  { id: 'forest', label: '숲', bg: { r: 245, g: 242, b: 236 }, accent: { r: 47, g: 93, b: 80 }, text: { r: 31, g: 28, b: 24 }, warm: { r: 194, g: 95, b: 54 } },
  { id: 'forest-dark', label: '숲 다크', bg: { r: 20, g: 19, b: 17 }, accent: { r: 127, g: 187, b: 167 }, text: { r: 236, g: 231, b: 222 }, warm: { r: 227, g: 140, b: 96 } },
  { id: 'amber', label: '앰버', bg: { r: 11, g: 11, b: 18 }, accent: { r: 240, g: 165, b: 0 }, text: { r: 232, g: 228, b: 217 }, warm: { r: 255, g: 112, b: 90 } },
  { id: 'cyan', label: '시안', bg: { r: 8, g: 14, b: 18 }, accent: { r: 0, g: 200, b: 200 }, text: { r: 220, g: 235, b: 235 }, warm: { r: 255, g: 150, b: 90 } },
  { id: 'violet', label: '바이올렛', bg: { r: 14, g: 10, b: 20 }, accent: { r: 170, g: 120, b: 255 }, text: { r: 228, g: 222, b: 240 }, warm: { r: 255, g: 160, b: 110 } },
  { id: 'crimson', label: '크림슨', bg: { r: 16, g: 9, b: 11 }, accent: { r: 230, g: 70, b: 90 }, text: { r: 235, g: 220, b: 222 }, warm: { r: 255, g: 190, b: 90 } },
  { id: 'mono', label: '모노', bg: { r: 14, g: 14, b: 16 }, accent: { r: 200, g: 200, b: 205 }, text: { r: 230, g: 230, b: 233 }, warm: { r: 235, g: 150, b: 110 } },
];

export const COLOR_DEFS = [
  { id: 'bg', label: '배경색' },
  { id: 'accent', label: '강조색', hint: '버튼·타이머 링·시작한 날' },
  { id: 'text', label: '글자색' },
  { id: 'warm', label: '포인트색', hint: '마감·오늘 표시' },
];

const VARS = ['--bg', '--surface', '--surface-2', '--text', '--muted', '--line', '--accent', '--accent-ink', '--accent-soft', '--warm', '--warm-soft', '--danger', '--shadow'];
const WHITE = { r: 255, g: 255, b: 255 };

export const rgb = c => `rgb(${c.r}, ${c.g}, ${c.b})`;
const mix = (a, b, t) => ({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) });
const lum = c => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
export const isDark = th => lum(th.bg) < 0.5;

export function themeVars(th) {
  const dark = isDark(th);
  return {
    '--bg': rgb(th.bg),
    '--surface': rgb(dark ? mix(th.bg, th.text, 0.055) : mix(th.bg, WHITE, 0.6)),
    '--surface-2': rgb(mix(th.bg, th.text, dark ? 0.11 : 0.05)),
    '--line': rgb(mix(th.bg, th.text, dark ? 0.16 : 0.1)),
    '--text': rgb(th.text),
    '--muted': rgb(mix(th.text, th.bg, 0.42)),
    '--accent': rgb(th.accent),
    '--accent-ink': lum(th.accent) > 0.55 ? 'rgb(17, 17, 17)' : 'rgb(255, 255, 255)',
    '--accent-soft': rgb(mix(th.bg, th.accent, dark ? 0.2 : 0.14)),
    '--warm': rgb(th.warm),
    '--warm-soft': rgb(mix(th.bg, th.warm, dark ? 0.2 : 0.14)),
    '--danger': dark ? 'rgb(229, 125, 106)' : 'rgb(179, 65, 47)',
    '--shadow': dark ? 'none' : '0 1px 2px rgba(31, 28, 24, .04), 0 6px 18px rgba(31, 28, 24, .04)',
  };
}

let metaDefaults = null;
export function applyTheme(th) {
  const root = document.documentElement;
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  if (!metaDefaults) metaDefaults = metas.map(m => m.getAttribute('content'));
  if (!th || th.mode !== 'custom' || !th.bg) {
    VARS.forEach(v => root.style.removeProperty(v));
    root.style.removeProperty('color-scheme');
    metas.forEach((m, i) => m.setAttribute('content', metaDefaults[i]));
    return;
  }
  for (const [k, v] of Object.entries(themeVars(th))) root.style.setProperty(k, v);
  root.style.setProperty('color-scheme', isDark(th) ? 'dark' : 'light');
  metas.forEach(m => m.setAttribute('content', rgb(th.bg)));
}

export function cachedTheme() {
  try { return JSON.parse(localStorage.getItem(THEME_KEY)) || null; } catch { return null; }
}
export function cacheTheme(th) {
  try { th ? localStorage.setItem(THEME_KEY, JSON.stringify(th)) : localStorage.removeItem(THEME_KEY); } catch { /* 무시 */ }
}
