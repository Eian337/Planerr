// 색상(테마) — 배경·강조·글자 기본색과 표시용 색(포인트·마감·지남·넘어옴)에서 나머지 색을 계산해 앱 전체에 적용합니다.
// mode가 'custom'이 아니면 styles.css의 기본 색(기기 라이트/다크 설정을 따라감)을 씁니다.

const THEME_KEY = 'planner.theme.v1';

// due(마감)는 처음엔 포인트색과 같게 두고, late(마감 지남)·carry(넘어온 과제)는 강조·포인트색과 겹치지 않는 색으로
const c = (r, g, b) => ({ r, g, b });
const P = (id, label, bg, accent, text, warm, late, carry) => ({ id, label, bg, accent, text, warm, due: { ...warm }, late, carry });
export const PRESETS = [
  P('forest', '숲', c(245, 242, 236), c(47, 93, 80), c(31, 28, 24), c(194, 95, 54), c(196, 32, 72), c(111, 82, 190)),
  P('forest-dark', '숲 다크', c(20, 19, 17), c(127, 187, 167), c(236, 231, 222), c(227, 140, 96), c(255, 102, 128), c(176, 150, 255)),
  P('amber', '앰버', c(11, 11, 18), c(240, 165, 0), c(232, 228, 217), c(255, 112, 90), c(245, 70, 160), c(120, 170, 255)),
  P('cyan', '시안', c(8, 14, 18), c(0, 200, 200), c(220, 235, 235), c(255, 150, 90), c(255, 85, 120), c(180, 140, 255)),
  P('violet', '바이올렛', c(14, 10, 20), c(170, 120, 255), c(228, 222, 240), c(255, 160, 110), c(255, 85, 120), c(90, 200, 230)),
  P('crimson', '크림슨', c(16, 9, 11), c(230, 70, 90), c(235, 220, 222), c(255, 190, 90), c(255, 110, 200), c(110, 190, 255)),
  P('mono', '모노', c(14, 14, 16), c(200, 200, 205), c(230, 230, 233), c(235, 150, 110), c(255, 95, 115), c(165, 150, 255)),
];

// group: 설정 화면에서 묶어 보여 주는 단위(base 기본 색, mark 표시 색)
export const COLOR_DEFS = [
  { id: 'bg', label: '배경색', group: 'base' },
  { id: 'accent', label: '강조색', hint: '버튼·타이머 링·시작한 날', group: 'base' },
  { id: 'text', label: '글자색', group: 'base' },
  { id: 'warm', label: '포인트색', hint: '오늘·지금 표시, 알림 시각, 알람 타이머', group: 'mark' },
  { id: 'due', label: '마감색', hint: '오늘·내일 마감, 달력과 목록의 마감 표시', group: 'mark' },
  { id: 'late', label: '지남색', hint: '마감이 지난 과제·단계', group: 'mark' },
  { id: 'carry', label: '넘어옴색', hint: '4일째 넘어온 과제', group: 'mark' },
];
export const COLOR_KEYS = COLOR_DEFS.map(d => d.id);

const VARS = ['--bg', '--surface', '--surface-2', '--text', '--muted', '--line', '--accent', '--accent-ink', '--accent-soft', '--warm', '--warm-soft', '--due', '--due-soft', '--late', '--late-soft', '--carry', '--carry-soft', '--danger', '--shadow'];
const WHITE = { r: 255, g: 255, b: 255 };

export const rgb = c => `rgb(${c.r}, ${c.g}, ${c.b})`;
const mix = (a, b, t) => ({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) });
const lum = c => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
export const isDark = th => lum(th.bg) < 0.5;
const same = (a, b) => !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;

// v1.10 이전에 저장한 색(배경·강조·글자·포인트 4가지)에 새 색을 채움: 같은 프리셋이면 그 값, 아니면 마감=포인트색, 나머지는 밝기에 맞는 기본값
export function fillTheme(th) {
  if (!th || !th.bg || COLOR_KEYS.every(k => th[k])) return th;
  const base = ['bg', 'accent', 'text', 'warm'];
  const p = PRESETS.find(x => base.every(k => same(x[k], th[k]))) || PRESETS.find(x => x.id === (isDark(th) ? 'forest-dark' : 'forest'));
  const out = { ...th };
  for (const k of COLOR_KEYS) if (!out[k]) out[k] = k === 'due' && th.warm ? { ...th.warm } : { ...p[k] };
  return out;
}

export function themeVars(th) {
  th = fillTheme(th);
  const dark = isDark(th);
  const soft = k => rgb(mix(th.bg, th[k], dark ? 0.2 : 0.14));
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
    '--warm-soft': soft('warm'),
    '--due': rgb(th.due),
    '--due-soft': soft('due'),
    '--late': rgb(th.late),
    '--late-soft': soft('late'),
    '--carry': rgb(th.carry),
    '--carry-soft': soft('carry'),
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
