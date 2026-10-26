// 학업 플래너 — 화면과 동작
import { Store } from './store.js';
import { applyTheme, cachedTheme, cacheTheme, PRESETS, COLOR_DEFS, rgb } from './theme.js';
import { Music } from './music.js';

applyTheme(cachedTheme()); // 화면이 그려지기 전에 저장된 색을 먼저 적용

const APP_VERSION = '1.2.1';
const BASE_TITLE = '학업 플래너';
const DEFAULT_STEPS = ['주제·범위 확정', '자료 조사·준비', '초안 작성', '수정·보완', '최종 점검'];
const RING_C = 2 * Math.PI * 54;

const store = new Store();
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

/* ───────── 날짜·문자열 유틸 (모두 기기의 현지 시간 기준) ───────── */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const todayStr = () => ymd(new Date());
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000); // b - a
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const weekStart = s => addDays(s, -((parse(s).getDay() + 6) % 7)); // 월요일 시작
const fmtMD = s => { const d = parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const fmtMDW = s => `${fmtMD(s)} (${DOW[parse(s).getDay()]})`;
const dday = s => { const n = diffDays(todayStr(), s); return n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}`; };
const relLabel = n => n === -1 ? '어제' : n === 1 ? '내일' : `${Math.abs(n)}일 ${n < 0 ? '전' : '후'}`;
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = (ms, ceil = false) => {
  const t = Math.max(0, ceil ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/* ───────── 화면 상태 ───────── */
const ui = {
  view: 'day',
  day: todayStr(),
  week: weekStart(todayStr()),
  month: todayStr().slice(0, 7),
  openProject: null,
  newProject: false,
  showArchived: false,
  editTask: null,
  musicOpen: false,
  themeDraft: null,
};

/* ───────── 데이터 조회 ───────── */
const dayRec = s => store.data.days[s] || {};
const settings = () => store.data.meta.settings || {};
const timerMin = () => {
  const n = Number(settings().timerMin);
  return Number.isFinite(n) && n >= 1 ? Math.min(120, Math.round(n)) : 10;
};
const projectList = () => Object.entries(store.data.projects)
  .map(([id, p]) => ({ ...p, id }))
  .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
const activeProjects = () => projectList().filter(p => !p.archived);
const sortedMs = p => [...(p.milestones || [])].sort((a, b) => (a.due || '').localeCompare(b.due || ''));

function eventsBetween(a, b) {
  const out = [];
  for (const p of activeProjects()) {
    for (const m of p.milestones || []) {
      if (m.due && m.due >= a && m.due <= b) out.push({ kind: 'ms', date: m.due, title: m.title, project: p.name, pid: p.id, mid: m.id, done: !!m.done });
    }
    if (p.deadline && p.deadline >= a && p.deadline <= b) out.push({ kind: 'deadline', date: p.deadline, project: p.name, pid: p.id });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || (x.kind === 'deadline') - (y.kind === 'deadline'));
}

function streaks() {
  const t = todayStr();
  const started = new Set(Object.keys(store.data.days).filter(k => store.data.days[k]?.started && k <= t));
  let cur = 0;
  let d = started.has(t) ? t : addDays(t, -1);
  while (started.has(d)) { cur++; d = addDays(d, -1); }
  let best = 0, run = 0, prev = null;
  for (const s of [...started].sort()) {
    run = prev && diffDays(prev, s) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = s;
  }
  return { cur, best, todayDone: started.has(t) };
}

/* ───────── 마감 역산 ───────── */
// 시작일부터 (마감 - 여유 기간)까지 단계들을 고르게 배치
function distribute(start, deadline, buffer, titles) {
  let end = addDays(deadline, -buffer);
  if (diffDays(start, end) < 1) end = deadline;
  const span = Math.max(0, diffDays(start, end));
  const n = titles.length;
  return titles.map((title, i) => ({ id: uid(), title, due: addDays(start, Math.round(span * (i + 1) / n)), done: false }));
}

// 끝나지 않은 단계만 오늘(또는 시작일)부터 다시 배치, 순서는 유지
function redistribute(p) {
  const t = todayStr();
  const from = p.start && p.start > t ? p.start : t;
  const undone = sortedMs(p).filter(m => !m.done);
  if (!undone.length) return p.milestones;
  const re = distribute(from, p.deadline, Number(p.buffer ?? 3), undone.map(m => m.title));
  const dueById = Object.fromEntries(undone.map((m, i) => [m.id, re[i].due]));
  return (p.milestones || []).map(m => (m.id in dueById ? { ...m, due: dueById[m.id] } : m));
}

/* ───────── 타이머 (기기별로 저장) ───────── */
const TKEY = 'planner.timer.v1';
let timer = (() => { try { return JSON.parse(localStorage.getItem(TKEY)) || null; } catch { return null; } })();
const saveTimer = () => { try { timer ? localStorage.setItem(TKEY, JSON.stringify(timer)) : localStorage.removeItem(TKEY); } catch { /* 무시 */ } };
const elapsed = () => (timer ? (timer.accMs || 0) + (timer.segStart ? Date.now() - timer.segStart : 0) : 0);

let actx = null;
function ensureAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { /* 소리 없이 진행 */ }
}
function chime() {
  try { navigator.vibrate?.([180, 90, 180]); } catch { /* 무시 */ }
  if (!actx) return;
  try {
    const t0 = actx.currentTime;
    [660, 880, 990].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), at = t0 + i * 0.22;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      o.connect(g).connect(actx.destination);
      o.start(at); o.stop(at + 0.22);
    });
  } catch { /* 무시 */ }
}

function tick() {
  if (mtRunning() && mtRemain() <= 0) mtFinish();
  else updateMainTimerDom();
  if (timer && timer.phase === 'warm' && elapsed() >= timer.warmMs) {
    timer.accMs = timer.warmMs; timer.segStart = null; timer.phase = 'prompt';
    if (document.hidden) timer.chimePending = true; else chime();
    saveTimer();
    scheduleRender();
  }
  updateTimerDom();
}

function updateTimerDom() {
  if (!timer) { updateTitle(); return; }
  const e = elapsed();
  let text;
  if (timer.phase === 'warm') {
    const rem = Math.max(0, timer.warmMs - e);
    text = mmss(rem, true);
    const ring = document.getElementById('ring-fg');
    if (ring) ring.style.strokeDashoffset = String(RING_C * (1 - rem / timer.warmMs));
  } else if (timer.phase === 'flow') {
    text = mmss(e);
  } else {
    text = '완료';
  }
  const disp = document.getElementById('timer-display');
  if (disp) disp.textContent = text;
  const mini = document.getElementById('timer-mini-text');
  if (mini) mini.textContent = text;
  updateTitle(text);
}

/* ───────── 타이머 탭 (기존 Personal-Timer 기능 이식) ───────── */
const fmtT = s => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
const music = new Music({
  onChange: () => scheduleRender(),
  onTime: (cur, dur) => {
    const ok = Number.isFinite(dur) && dur > 0;
    const seek = document.getElementById('music-seek');
    if (seek && ok && document.activeElement !== seek) seek.value = String(Math.round((cur / dur) * 1000));
    const c = document.getElementById('music-cur');
    if (c) c.textContent = fmtT(cur);
    const d = document.getElementById('music-dur');
    if (d && ok) d.textContent = fmtT(dur);
  },
  onError: msg => toast(msg),
});

const MKEY = 'planner.mtimer.v1';
const MT_R = 108, MT_C = 2 * Math.PI * MT_R;
const MT_DEFAULT = 5 * 60000;
const MT_CAP = (23 * 3600 + 59 * 60 + 59) * 1000;
const MT_LABEL = { ready: '준비', running: '진행 중', paused: '일시정지', done: '종료' };
const mtFresh = () => ({ totalMs: MT_DEFAULT, remainMs: MT_DEFAULT, setMs: MT_DEFAULT, endTime: null, status: 'ready', accMs: 0, segStart: null, sessionDate: null, alarm: false, offer: null });
let mt = (() => { try { return { ...mtFresh(), ...(JSON.parse(localStorage.getItem(MKEY)) || {}) }; } catch { return mtFresh(); } })();
const mtSave = () => { try { localStorage.setItem(MKEY, JSON.stringify(mt)); } catch { /* 무시 */ } };
const mtRunning = () => mt.status === 'running';
const mtRemain = () => (mtRunning() ? Math.max(0, mt.endTime - Date.now()) : Math.max(0, mt.remainMs));
const mtSession = () => mt.accMs + (mt.segStart ? Date.now() - mt.segStart : 0);
const fmtClock = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${pad(h)}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICON_RESET = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v4h4"/></svg>';

function mtCloseSeg(until = Date.now()) {
  if (mt.segStart) { mt.accMs += Math.max(0, until - mt.segStart); mt.segStart = null; }
}
function mtEndSession() { mt.accMs = 0; mt.segStart = null; mt.sessionDate = null; }

// 기록할지 물어볼 시간을 쌓아 둠(같은 날짜면 합산). 1분 미만은 묻지 않음
function mtOffer(ms, date) {
  const min = Math.round(ms / 60000);
  if (min < 1) return;
  const d = date || todayStr();
  mt.offer = { min: (mt.offer && mt.offer.date === d ? mt.offer.min : 0) + min, date: d };
}

function mtToggle() {
  if (mtRunning()) {
    mt.remainMs = mtRemain(); mt.endTime = null; mt.status = 'paused';
    mtCloseSeg();
  } else {
    if (mt.remainMs <= 0) {
      if (mt.setMs <= 0) { toast('시간을 먼저 정해 주세요.'); return; }
      mt.totalMs = mt.setMs; mt.remainMs = mt.setMs;
    }
    ensureAudio(); music.unlock(); askNotify();
    mtStopAlarm(); mt.alarm = false;
    mt.endTime = Date.now() + mt.remainMs; mt.status = 'running'; mt.segStart = Date.now();
    if (!mt.sessionDate) mt.sessionDate = todayStr();
  }
  mtSave(); scheduleRender(); pipRefresh();
}

function mtReset() {
  mtStopAlarm();
  mtOffer(mtSession(), mt.sessionDate);
  mtEndSession();
  const t = mt.setMs > 0 ? mt.setMs : MT_DEFAULT;
  Object.assign(mt, { status: 'ready', endTime: null, alarm: false, totalMs: t, remainMs: t });
  mtSave(); scheduleRender(); pipRefresh();
}

function mtAdd(sec) {
  const add = sec * 1000;
  if (mt.status === 'done') {
    mtStopAlarm();
    Object.assign(mt, { status: 'ready', alarm: false, totalMs: add, remainMs: add });
  } else if (mtRunning()) {
    const a = Math.min(add, Math.max(0, MT_CAP - mtRemain()));
    mt.endTime += a; mt.totalMs += a;
  } else {
    mt.remainMs = Math.min(MT_CAP, mt.remainMs + add);
    mt.totalMs = Math.min(MT_CAP, mt.totalMs + add);
  }
  mtSave(); scheduleRender(); pipRefresh();
}

// 진행 중이면 남은 시간에 더하고, 멈춘 상태면 표시된 시간에 더해 새로 맞춤(23:59:59까지)
function mtPreset(min) {
  if (mtRunning()) { mtAdd(min * 60); return; }
  const ms = Math.min(Math.floor(mt.remainMs / 1000) * 1000 + min * 60000, MT_CAP);
  mtStopAlarm();
  Object.assign(mt, { status: 'ready', alarm: false, totalMs: ms, remainMs: ms, setMs: ms });
  mtSave(); scheduleRender(); pipRefresh();
}

function mtFromInputs() {
  if (mtRunning()) return;
  const v = (id, max) => Math.min(max, Math.max(0, parseInt(document.getElementById(id)?.value, 10) || 0));
  const ms = (v('mt-h', 23) * 3600 + v('mt-m', 59) * 60 + v('mt-s', 59)) * 1000;
  const hadAlarm = mt.alarm;
  if (hadAlarm) mtStopAlarm();
  Object.assign(mt, { status: 'ready', alarm: false, totalMs: ms, remainMs: ms, setMs: ms });
  mtSave(); updateMainTimerDom(); pipRefresh();
  if (hadAlarm) scheduleRender();
}

let melody = [];
function playMelody() {
  ensureAudio();
  if (!actx) return;
  const t0 = actx.currentTime + 0.05;
  melody = [[0, 880, 0.3], [0.38, 1047, 0.3], [0.76, 1175, 0.3], [1.3, 880, 0.3], [1.68, 1047, 0.3], [2.06, 1319, 0.55]].map(([t, f, d]) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.32, t0 + t);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + t + d);
    o.connect(g).connect(actx.destination);
    o.start(t0 + t); o.stop(t0 + t + d + 0.05);
    return o;
  });
}
function mtStopAlarm() {
  melody.forEach(o => { try { o.stop(); } catch { /* 이미 끝남 */ } });
  melody = [];
  music.stopAlarm();
}

function askNotify() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* 무시 */ }
}
async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, { body, icon: './icons/icon-192.png', tag: 'planner-timer' }); return; }
  } catch { /* 아래 방식으로 */ }
  try { new Notification(title, { body }); } catch { /* 무시 */ }
}

// silent: 앱이 꺼져 있는 동안 끝난 경우(소리 없이 종료 처리하고 기록 여부만 물음)
function mtFinish(silent = false) {
  mtCloseSeg(mt.endTime || Date.now());
  Object.assign(mt, { status: 'done', remainMs: 0, endTime: null, alarm: !silent });
  if (silent) {
    mtOffer(mtSession(), mt.sessionDate);
    mtEndSession();
  } else {
    music.playAlarm().then(ok => { if (!ok) playMelody(); });
    const task = topTask(todayStr())?.text;
    notify('⏰ 타이머 종료', task ? `${task} — 설정한 시간이 됐어요.` : '설정한 시간이 됐어요.');
    try { navigator.vibrate?.([300, 150, 300]); } catch { /* 무시 */ }
  }
  mtSave(); scheduleRender(); pipRefresh();
}

function mtDismiss(record) {
  mtStopAlarm();
  const min = Math.round(mtSession() / 60000), date = mt.sessionDate || todayStr();
  if (record && min >= 1) recordFocus(min, date);
  mtEndSession();
  mt.alarm = false;
  mtSave(); scheduleRender(); pipRefresh();
}

function recordFocus(min, date) {
  const r = dayRec(date);
  store.set('days', date, { focusMin: (r.focusMin || 0) + min, started: true, ...(r.startedAt ? {} : { startedAt: Date.now() }) });
  toast(`${min}분을 ${date === todayStr() ? '오늘' : fmtMD(date)} 집중 시간에 기록했습니다.`);
}

function updateMainTimerDom() {
  const rem = mtRemain(), txt = fmtClock(rem), ratio = mt.totalMs > 0 ? rem / mt.totalMs : 0;
  const d = document.getElementById('mt-display');
  if (d) d.textContent = txt;
  const r = document.getElementById('mt-ring');
  if (r) r.style.strokeDashoffset = String(MT_C * (1 - ratio));
  const l = document.getElementById('mt-label');
  if (l) l.textContent = MT_LABEL[mt.status];
  const mini = document.getElementById('mt-mini-text');
  if (mini) mini.textContent = txt;
  pipUpdate(txt, ratio);
}

function updateTitle(startText) {
  const t = startText ? `${startText} · ${BASE_TITLE}` : mtRunning() ? `${fmtClock(mtRemain())} · 타이머` : BASE_TITLE;
  if (document.title !== t) document.title = t;
}

/* 미니 창(Document Picture-in-Picture, 크롬 계열 전용) */
let pipWin = null;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
async function togglePip() {
  if (!('documentPictureInPicture' in window)) { toast('이 브라우저에서는 미니 창을 쓸 수 없습니다.'); return; }
  if (pipWin) { pipWin.close(); pipWin = null; scheduleRender(); return; }
  try {
    pipWin = await window.documentPictureInPicture.requestWindow({ width: 280, height: 360 });
  } catch {
    toast('미니 창을 열 수 없었습니다.');
    return;
  }
  pipWin.addEventListener('pagehide', () => { pipWin = null; scheduleRender(); });
  pipBuild();
  scheduleRender();
}
function pipBuild() {
  if (!pipWin) return;
  const d = pipWin.document;
  const c = { bg: cssVar('--bg'), track: cssVar('--surface-2'), accent: cssVar('--accent'), ink: cssVar('--accent-ink'), text: cssVar('--text'), muted: cssVar('--muted'), danger: cssVar('--danger') };
  const rem = mtRemain(), ratio = mt.totalMs > 0 ? rem / mt.totalMs : 0, task = topTask(todayStr())?.text || '';
  d.title = '타이머';
  d.head.innerHTML = `<style>
    *{box-sizing:border-box} html,body{margin:0;height:100%}
    body{background:${c.bg};color:${c.text};font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;display:flex;flex-direction:column;user-select:none;overflow:hidden}
    .task{padding:12px 14px 0;font-size:13px;color:${c.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
    .task b{color:${c.text};font-weight:600}
    .ring{flex:1;min-height:0;position:relative}
    .ring>svg{position:absolute;inset:8px;width:calc(100% - 16px);height:calc(100% - 16px)}
    button svg{flex:none}
    .btns{display:flex;gap:14px;justify-content:center;align-items:center;padding:4px 8px 14px}
    button{border-radius:50%;border:1px solid ${c.track};background:${c.track};color:${c.text};display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;font:700 12px system-ui,sans-serif}
    button.sm{width:40px;height:40px} button.main{width:52px;height:52px;background:${c.accent};color:${c.ink};border-color:${c.accent}}
  </style>`;
  d.body.innerHTML = `<div class="task">${task ? `<b>${esc(task)}</b>` : '오늘 과제 없음'}</div>
    <div class="ring"><svg viewBox="0 0 256 256" preserveAspectRatio="xMidYMid meet">
      <g transform="rotate(-90 128 128)">
        <circle cx="128" cy="128" r="${MT_R}" fill="none" stroke="${c.track}" stroke-width="10"/>
        <circle id="pr" cx="128" cy="128" r="${MT_R}" fill="none" stroke="${mt.status === 'done' ? c.danger : c.accent}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${MT_C}" style="stroke-dashoffset:${MT_C * (1 - ratio)};transition:stroke-dashoffset .3s linear"/>
      </g>
      <text id="pt" x="128" y="126" font-size="46" font-weight="600" fill="${c.text}" text-anchor="middle" dominant-baseline="middle" style="font-variant-numeric:tabular-nums">${fmtClock(rem)}</text>
      <text id="ps" x="128" y="168" font-size="13" fill="${c.muted}" text-anchor="middle" dominant-baseline="middle" letter-spacing="2">${MT_LABEL[mt.status]}</text>
    </svg></div>
    <div class="btns">
      <button class="sm" id="pReset" title="리셋">${ICON_RESET}</button>
      <button class="main" id="pMain" title="시작/일시정지">${mtRunning() ? ICON_PAUSE : ICON_PLAY}</button>
      <button class="sm" id="pAdd" title="1분 추가">+1m</button>
    </div>`;
  d.getElementById('pReset').onclick = () => mtReset();
  d.getElementById('pMain').onclick = () => mtToggle();
  d.getElementById('pAdd').onclick = () => mtAdd(60);
}
const pipRefresh = () => { if (pipWin) pipBuild(); };
function pipUpdate(txt, ratio) {
  if (!pipWin) return;
  const d = pipWin.document;
  const pt = d.getElementById('pt');
  if (pt) pt.textContent = txt;
  const pr = d.getElementById('pr');
  if (pr) pr.style.strokeDashoffset = String(MT_C * (1 - ratio));
  const ps = d.getElementById('ps');
  if (ps) ps.textContent = MT_LABEL[mt.status];
}

/* ───────── 색상 ───────── */
let appliedThemeKey = JSON.stringify(cachedTheme() || null);
function syncTheme() {
  if (ui.themeDraft) return; // 조정 중에는 덮어쓰지 않음
  const th = settings().theme || null;
  const key = JSON.stringify(th);
  if (key === appliedThemeKey) return;
  appliedThemeKey = key;
  applyTheme(th); cacheTheme(th); pipRefresh();
}
function saveTheme(th) {
  appliedThemeKey = JSON.stringify(th);
  applyTheme(th); cacheTheme(th);
  store.set('meta', 'settings', { theme: th });
  pipRefresh();
}
function currentTheme() {
  const th = ui.themeDraft || settings().theme;
  if (th && th.mode === 'custom' && th.bg) return th;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const p = PRESETS.find(x => x.id === (dark ? 'forest-dark' : 'forest'));
  return { mode: 'auto', bg: { ...p.bg }, accent: { ...p.accent }, text: { ...p.text }, warm: { ...p.warm } };
}
function themeInput(el) {
  const id = el.dataset.color, ch = el.dataset.ch;
  const v = Math.max(0, Math.min(255, parseInt(el.value, 10) || 0));
  if (!ui.themeDraft) ui.themeDraft = JSON.parse(JSON.stringify({ ...currentTheme(), mode: 'custom' }));
  ui.themeDraft[id][ch] = v;
  const pair = document.getElementById(`${el.type === 'range' ? 'cn' : 'cr'}-${id}-${ch}`);
  if (pair) pair.value = v;
  const sw = document.getElementById(`sw-${id}`);
  if (sw) sw.style.background = rgb(ui.themeDraft[id]);
  applyTheme(ui.themeDraft);
}
function commitThemeDraft() {
  if (!ui.themeDraft) return;
  const th = ui.themeDraft;
  ui.themeDraft = null;
  saveTheme(th);
}

/* ───────── 아이콘 ───────── */
const ICON = {
  day: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5L7 17M17 7l1.5-1.5"/></svg>',
  week: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4M7 14.5h10"/></svg>',
  month: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4M7.5 13.5h.01M12 13.5h.01M16.5 13.5h.01M7.5 17h.01M12 17h.01"/></svg>',
  projects: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11.5l-2.2 3.8 2.2 3.8H5"/></svg>',
  timer: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.8v3.9l2.4 1.8M9.5 2.8h5M12 2.8V6M18.3 6.8l1.4-1.4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

/* ───────── 공통 조각 ───────── */
const center = html => `<div class="center-screen">${html}</div>`;

function syncBadge(id = 'sync-badge') {
  const s = store.status;
  let cls, text, title;
  if (s.mode === 'local') { cls = 'local'; text = '로컬 모드'; title = '이 기기에만 저장됩니다'; }
  else if (!s.online) { cls = 'off'; text = '오프라인'; title = '기기에 저장해 두었다가 연결되면 올립니다'; }
  else if (s.pending) { cls = 'pend'; text = '동기화 대기'; title = '서버에 올리는 중입니다'; }
  else { cls = 'ok'; text = '동기화됨'; title = '모든 기록이 서버와 맞춰져 있습니다'; }
  return `<span ${id ? `id="${id}"` : ''} class="badge ${cls}" title="${title}"><i></i>${text}</span>`;
}

function timerMini() {
  let html = '';
  if (timer && !(ui.view === 'day' && ui.day === todayStr())) html += `<button class="timer-mini" data-action="goto-day" data-date="${todayStr()}" aria-label="시작 타이머로 이동"><span id="timer-mini-text"></span></button>`;
  if (mtRunning() && ui.view !== 'timer') html += `<button class="timer-mini alt" data-action="nav" data-view="timer" aria-label="타이머로 이동"><span id="mt-mini-text">${fmtClock(mtRemain())}</span></button>`;
  return html;
}

function dateHeader(title, sub, kind, showReset, resetLabel) {
  return `<header class="vhead">
    <button class="icon-btn" data-action="${kind}-prev" aria-label="이전">‹</button>
    <div class="vtitle"><h1>${title}</h1>${sub ? `<span class="sub">${sub}</span>` : ''}</div>
    <button class="icon-btn" data-action="${kind}-next" aria-label="다음">›</button>
    ${showReset ? `<button class="chip-btn reset" data-action="${kind}-reset">${resetLabel}</button>` : ''}
  </header>`;
}

function evItem(e) {
  const t = todayStr();
  if (e.kind === 'deadline') {
    return `<li class="ev deadline"><span class="ev-mark">!</span><span class="ev-main"><b>${esc(e.project)}</b> 공식 마감</span><span class="ev-date">${fmtMD(e.date)} · ${dday(e.date)}</span></li>`;
  }
  const late = !e.done && e.date < t;
  return `<li class="ev ${e.done ? 'done' : ''} ${late ? 'late' : ''}">
    <span class="ev-check"><input type="checkbox" data-change="ms-toggle" data-p="${e.pid}" data-m="${e.mid}" ${e.done ? 'checked' : ''} aria-label="${esc(e.title)} 완료"></span>
    <span class="ev-main">${esc(e.title)}<small>${esc(e.project)}</small></span>
    <span class="ev-date">${fmtMD(e.date)} · ${late ? '지남' : dday(e.date)}</span>
  </li>`;
}

function goalItem(ws, g, editable) {
  const p = g.projectId && store.data.projects[g.projectId];
  return `<li class="goal ${g.done ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-change="goal-toggle" data-w="${ws}" data-id="${g.id}" ${g.done ? 'checked' : ''}><span>${esc(g.text)}</span></label>
    ${p ? `<small class="tag">${esc(p.name)}</small>` : ''}
    ${editable ? `<button class="icon-btn sm" data-action="goal-del" data-w="${ws}" data-id="${g.id}" aria-label="삭제">×</button>` : ''}
  </li>`;
}

function linkOptions(r, projects) {
  let html = `<option value="">연결 안 함</option>`;
  for (const p of projects) {
    html += `<optgroup label="${esc(p.name)}"><option value="${p.id}::" ${r.projectId === p.id && !r.milestoneId ? 'selected' : ''}>${esc(p.name)} (전체)</option>`;
    for (const m of sortedMs(p).filter(m => !m.done || m.id === r.milestoneId)) {
      html += `<option value="${p.id}::${m.id}" ${r.milestoneId === m.id ? 'selected' : ''}>${esc(m.title)} · ${fmtMD(m.due)}</option>`;
    }
    html += `</optgroup>`;
  }
  return html;
}

/* ───────── 하루 과제 목록 (배열 순서 = 우선순위) ───────── */
// 예전 버전(하루 과제 하나)으로 저장된 기록은 1순위 과제 하나로 읽어 옴.
// 예전의 '첫 행동'(action)은 '뭘 할지' 메모(memo)로 읽음
function getTasks(s) {
  const r = dayRec(s);
  if (Array.isArray(r.tasks)) return r.tasks.map(t => (t.memo === undefined && t.action ? { ...t, memo: t.action } : t));
  if (r.task) return [{ id: 'legacy', text: r.task, memo: r.action || '', cue: r.cue || '', done: !!r.done, projectId: r.projectId || null, milestoneId: r.milestoneId || null }];
  return [];
}
const memoLine = t => (t.memo || '').split('\n')[0];
const topTask = s => getTasks(s).find(t => !t.done) || null;
const setTasks = (s, tasks) => store.set('days', s, { tasks });
const updateTask = (s, id, patch) => setTasks(s, getTasks(s).map(t => (t.id === id ? { ...t, ...patch } : t)));
const carryTarget = s => (s < todayStr() ? todayStr() : addDays(s, 1));
const carryLabel = s => (s < todayStr() ? '오늘로 가져오기' : s === todayStr() ? '내일로 넘기기' : '다음 날로 넘기기');

function carryTasks(date, ids) {
  if (!ids.length) return;
  const target = carryTarget(date), src = getTasks(date), dest = getTasks(target);
  const destIds = new Set(dest.map(t => t.id));
  const moved = src.filter(t => ids.includes(t.id)).map(t => ({ ...t, id: destIds.has(t.id) ? uid() : t.id, from: date }));
  setTasks(target, [...dest, ...moved]);
  setTasks(date, src.filter(t => !ids.includes(t.id)));
  ui.editTask = null;
  toast(`${moved.length}개 과제를 ${target === todayStr() ? '오늘' : fmtMD(target)}로 옮겼습니다.`);
}

function dayTaskLabel(d) {
  const list = getTasks(d), top = list.find(t => !t.done);
  if (top) return esc(top.text) + (list.length > 1 ? ` <span class="muted">외 ${list.length - 1}개</span>` : '');
  return list.length ? `<span class="muted">✓ ${list.length}개 모두 완료</span>` : '<span class="muted">—</span>';
}

function taskBlock(date) {
  const tasks = getTasks(date), top = tasks.find(t => !t.done), projects = activeProjects();
  const undone = tasks.filter(t => !t.done).length;
  const field = (t, f, label, ph) => `<label class="field"><span>${label}</span><input data-tfield="${f}" data-date="${date}" data-id="${t.id}" data-key="t|${date}|${t.id}|${f}" value="${esc(t[f] || '')}" placeholder="${ph}" maxlength="120" autocomplete="off"></label>`;
  // 메모는 모든 과제에, 시작 시점은 맨 위 과제(지금 할 과제)에만
  const details = (t, isTop) => `<div class="fields">
      ${field(t, 'text', '과제', '과제 이름')}
      <label class="field"><span>뭘 할지</span><textarea rows="2" data-tfield="memo" data-date="${date}" data-id="${t.id}" data-key="t|${date}|${t.id}|memo" maxlength="500" placeholder="예: 문제집 42쪽부터 3문제 풀기">${esc(t.memo || '')}</textarea></label>
      ${isTop ? field(t, 'cue', '시작 시점 (선택)', '예: 점심 먹고 책상에 앉으면') : ''}
      ${projects.length ? `<label class="field"><span>장기 과제</span><select data-change="tlink" data-date="${date}" data-id="${t.id}" data-key="tl|${date}|${t.id}">${linkOptions(t, projects)}</select></label>` : ''}
    </div>
    ${isTop && t.cue ? `<p class="plan-line"><span>${esc(t.cue)}</span><i>→</i><span>${esc(t.text)}</span></p>` : ''}`;
  const focus = top
    ? `<div class="now-task">
        <div class="now-head"><span class="now-label">${date === todayStr() ? '지금 할 과제' : '먼저 할 과제'} · ${tasks.indexOf(top) + 1}순위</span><label class="check"><input type="checkbox" data-change="tdone" data-date="${date}" data-id="${top.id}" aria-label="지금 할 과제 완료"><span>완료</span></label></div>
        ${details(top, true)}
      </div>`
    : tasks.length ? `<p class="all-done">✓ 모든 과제를 끝냈습니다</p>` : '';
  const rows = tasks.map((t, i) => {
    const editing = ui.editTask === `${date}|${t.id}`, isTop = t === top;
    return `<li class="task-row ${t.done ? 'done' : ''} ${isTop ? 'is-top' : ''}">
      <div class="tr-main">
        <span class="rank">${i + 1}</span>
        <input type="checkbox" data-change="tdone" data-date="${date}" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="${esc(t.text)} 완료">
        <span class="tr-text">${esc(t.text)}${t.from ? `<small class="muted"> · ${fmtMD(t.from)}에서 넘어옴</small>` : ''}${memoLine(t) && !isTop && !editing ? `<small class="tr-memo">${esc(memoLine(t))}</small>` : ''}</span>
        <span class="tr-btns">
          <button class="icon-btn sm" data-action="t-move" data-date="${date}" data-id="${t.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="우선순위 올리기">↑</button>
          <button class="icon-btn sm" data-action="t-move" data-date="${date}" data-id="${t.id}" data-dir="1" ${i === tasks.length - 1 ? 'disabled' : ''} aria-label="우선순위 내리기">↓</button>
          <button class="icon-btn sm ${editing ? 'on' : ''}" data-action="t-edit" data-date="${date}" data-id="${t.id}" aria-label="자세히" aria-expanded="${editing}">⋯</button>
        </span>
      </div>
      ${editing ? `<div class="tr-edit">
        ${isTop ? '' : details(t, false)}
        <div class="btn-row wrap">
          ${t.done ? '' : `<button class="btn sm" data-action="t-carry" data-date="${date}" data-id="${t.id}">${carryLabel(date)}</button>`}
          <button class="btn sm danger" data-action="t-del" data-date="${date}" data-id="${t.id}">삭제</button>
          <button class="btn sm" data-action="t-edit" data-date="${date}" data-id="${t.id}">닫기</button>
        </div>
      </div>` : ''}
    </li>`;
  }).join('');
  return `${focus}
    ${tasks.length ? `<div class="task-list-head"><span>우선순위</span>${undone ? `<button class="link-btn" data-action="t-carry-all" data-date="${date}">남은 ${undone}개 ${carryLabel(date)}</button>` : ''}</div>
    <ol class="task-list">${rows}</ol>` : ''}
    <div class="add-row">
      <input id="t-new-${date}" data-enter="t-add" data-date="${date}" placeholder="${tasks.length ? '과제 추가 (맨 아래 순위로)' : '예: 보고서 서론 쓰기'}" maxlength="120" autocomplete="off" aria-label="과제 추가">
      <button class="btn primary" data-action="t-add" data-date="${date}">추가</button>
    </div>
    ${tasks.length ? '' : `<p class="muted small">우선순위 순서대로 추가하세요. 맨 위의 끝나지 않은 과제가 '지금 할 과제'가 됩니다.</p>`}`;
}

/* ───────── 오늘(일) 화면 ───────── */
function timerCard(r) {
  const m = timerMin();
  if (!timer) {
    return `<article class="card timer-card">
      <button class="start-btn" data-action="timer-start"><span class="big">시작</span><span class="small">${m}분만 하고 그만둬도 됩니다</span></button>
      ${r.started ? '' : `<button class="link-btn" data-action="mark-started">타이머 없이 시작했어요</button>`}
    </article>`;
  }
  const stale = timer.date !== todayStr() ? `<p class="muted small center">${fmtMD(timer.date)}에 시작한 타이머입니다.</p>` : '';
  if (timer.phase === 'prompt') {
    return `<article class="card timer-card">
      <div class="timer-done"><b>${Math.round(timer.warmMs / 60000)}분 완료</b><span class="muted">더 이어 갈지, 여기서 끝낼지 고르세요.</span></div>
      ${stale}
      <div class="btn-row"><button class="btn primary" data-action="timer-continue">계속하기</button><button class="btn" data-action="timer-stop">여기까지</button></div>
    </article>`;
  }
  const warm = timer.phase === 'warm';
  return `<article class="card timer-card">
    <div class="ring-wrap">
      <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="ring-bg" cx="60" cy="60" r="54"/>
        ${warm
          ? `<circle id="ring-fg" class="ring-fg" cx="60" cy="60" r="54" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="0"/>`
          : `<circle class="ring-fg flow" cx="60" cy="60" r="54"/>`}
      </svg>
      <div class="ring-center"><span id="timer-display" class="timer-num">--:--</span><span class="muted small">${warm ? '남은 시간' : '총 집중 시간'}</span></div>
    </div>
    ${stale}
    <div class="btn-row"><button class="btn" data-action="timer-stop">${warm ? '그만두기' : '끝내기'}</button></div>
  </article>`;
}

function upcomingCard(s) {
  const t = todayStr(), until = addDays(s, 14);
  const ev = eventsBetween('0000-00-00', until)
    .filter(e => e.date >= s || (s === t && e.kind === 'ms' && !e.done));
  if (!ev.length) return '';
  return `<article class="card">
    <div class="card-head"><h2>다가오는 일정</h2><span class="muted small">2주 이내</span></div>
    <ul class="ev-list">${ev.slice(0, 8).map(evItem).join('')}</ul>
  </article>`;
}

function weekGoalsMini(s) {
  const ws = weekStart(s);
  const goals = store.data.weeks[ws]?.goals || [];
  if (!goals.length) return '';
  const label = ws === weekStart(todayStr()) ? '이번 주 결과물' : '이 주의 결과물';
  return `<article class="card">
    <div class="card-head"><h2>${label}</h2><button class="link-btn" data-action="goto-week" data-date="${ws}">주 화면</button></div>
    <ul class="goal-list">${goals.map(g => goalItem(ws, g, false)).join('')}</ul>
  </article>`;
}

function viewDay() {
  const s = ui.day, t = todayStr(), isToday = s === t, r = dayRec(s), st = streaks();
  const tomorrow = addDays(t, 1);
  return `<section class="view">
    ${dateHeader(fmtMDW(s), isToday ? '오늘' : relLabel(diffDays(t, s)), 'day', !isToday, '오늘로')}
    <div class="streak-strip">
      <div><b>${st.cur}</b><span>일 연속 시작</span></div>
      <div><b>${st.best}</b><span>최장 기록</span></div>
      <div class="${st.todayDone ? 'ok' : ''}"><b>${st.todayDone ? '✓' : '–'}</b><span>오늘 시작</span></div>
    </div>
    <article class="card">
      <div class="card-head"><h2>${isToday ? '오늘의 과제' : '이 날의 과제'}</h2><span class="head-right">${r.focusMin ? `<span class="muted small">집중 ${r.focusMin}분</span>` : ''}<span class="pill ${r.started ? 'on' : ''}">${r.started ? '시작함' : '시작 전'}</span></span></div>
      ${taskBlock(s)}
    </article>
    ${isToday
      ? timerCard(r)
      : `<article class="card slim"><label class="check"><input type="checkbox" data-bind="days|${s}|started" data-key="days|${s}|started" ${r.started ? 'checked' : ''}><span>이 날 시작한 것으로 표시</span></label></article>`}
    ${isToday ? `<article class="card">
      <div class="card-head"><h2>내일 과제 정하기</h2><span class="muted small">${fmtMDW(tomorrow)}</span></div>
      ${taskBlock(tomorrow)}
    </article>` : ''}
    ${upcomingCard(s)}
    ${weekGoalsMini(s)}
  </section>`;
}

/* ───────── 주 화면 ───────── */
function viewWeek() {
  const ws = ui.week, we = addDays(ws, 6), t = todayStr();
  const curWs = weekStart(t), isCur = ws === curWs;
  const goals = store.data.weeks[ws]?.goals || [];
  const ev = eventsBetween(ws, we);
  const projects = activeProjects();
  const doneN = goals.filter(g => g.done).length;
  const n = Math.round(diffDays(curWs, ws) / 7);
  const rows = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i), r = dayRec(d), dayEv = ev.filter(e => e.date === d);
    const evText = dayEv.map(e => (e.kind === 'deadline' ? `${esc(e.project)} 마감` : esc(e.title))).join(' · ');
    return `<li><button class="day-row ${d === t ? 'today' : ''}" data-action="goto-day" data-date="${d}">
      <span class="dr-date"><b>${DOW[parse(d).getDay()]}</b>${parse(d).getDate()}</span>
      <span class="dr-main">${dayTaskLabel(d)}${evText ? `<small>${evText}</small>` : ''}</span>
      <span class="dr-side">${r.focusMin ? `<small class="muted">${r.focusMin}분</small>` : ''}<i class="dot ${r.started ? 'on' : d < t ? 'miss' : ''}" title="${r.started ? '시작함' : ''}"></i></span>
    </button></li>`;
  }).join('');
  return `<section class="view">
    ${dateHeader(`${fmtMD(ws)} – ${fmtMD(we)}`, isCur ? '이번 주' : `${Math.abs(n)}주 ${n < 0 ? '전' : '후'}`, 'week', !isCur, '이번 주로')}
    <article class="card">
      <div class="card-head"><h2>이 주에 끝낼 결과물</h2>${goals.length ? `<span class="muted small">${doneN}/${goals.length}</span>` : ''}</div>
      ${goals.length ? `<ul class="goal-list">${goals.map(g => goalItem(ws, g, true)).join('')}</ul>` : `<p class="muted small">한 주에 한두 개면 충분합니다.</p>`}
      <div class="add-row">
        <input id="goal-new" data-enter="goal-add" placeholder="예: 실험 방법 초안 완성" maxlength="120" autocomplete="off">
        ${projects.length ? `<select id="goal-proj" aria-label="장기 과제 연결"><option value="">연결 안 함</option>${projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>` : ''}
        <button class="btn primary" data-action="goal-add">추가</button>
      </div>
    </article>
    ${ev.length ? `<article class="card">
      <div class="card-head"><h2>장기 과제 일정</h2><span class="muted small">마감에서 역산</span></div>
      <ul class="ev-list">${ev.map(evItem).join('')}</ul>
    </article>` : ''}
    <article class="card">
      <div class="card-head"><h2>요일별 과제</h2></div>
      <ul class="day-rows">${rows}</ul>
    </article>
  </section>`;
}

/* ───────── 달 화면 ───────── */
function viewMonth() {
  const [y, m] = ui.month.split('-').map(Number);
  const first = `${ui.month}-01`, daysIn = new Date(y, m, 0).getDate(), last = `${ui.month}-${pad(daysIn)}`;
  const lead = (parse(first).getDay() + 6) % 7;
  const t = todayStr(), st = streaks(), ev = eventsBetween(first, last);
  const isCur = ui.month === t.slice(0, 7);
  const passed = t < first ? 0 : t > last ? daysIn : parse(t).getDate();
  let startedN = 0;
  let cells = '<span class="cal-cell blank"></span>'.repeat(lead);
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${ui.month}-${pad(d)}`, started = !!dayRec(ds).started && ds <= t;
    if (started) startedN++;
    const de = ev.filter(e => e.date === ds);
    const marks = de.length ? `<span class="cal-marks">${de.slice(0, 3).map(e => `<i class="mk-${e.kind}${e.done ? ' done' : ''}"></i>`).join('')}</span>` : '';
    cells += `<button class="cal-cell ${started ? 'started' : ''} ${ds === t ? 'today' : ''} ${ds > t ? 'future' : ''}" data-action="goto-day" data-date="${ds}" aria-label="${m}월 ${d}일${started ? ', 시작함' : ''}"><span class="n">${d}</span>${marks}</button>`;
  }
  return `<section class="view">
    ${dateHeader(`${y}년 ${m}월`, isCur ? '이번 달' : '', 'month', !isCur, '이번 달로')}
    <div class="streak-strip">
      <div><b>${st.cur}</b><span>일 연속 시작</span></div>
      <div><b>${st.best}</b><span>최장 기록</span></div>
      <div><b>${startedN}<small>/${passed}</small></b><span>${isCur ? '이번 달' : '이 달'} 시작한 날</span></div>
    </div>
    <article class="card">
      <div class="cal-head">${['월', '화', '수', '목', '금', '토', '일'].map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend"><span><i class="lg lg-start"></i>시작한 날</span><span><i class="lg lg-ms"></i>중간 지점</span><span><i class="lg lg-dl"></i>공식 마감</span></div>
    </article>
    ${ev.length ? `<article class="card"><div class="card-head"><h2>이 달의 일정</h2></div><ul class="ev-list">${ev.map(evItem).join('')}</ul></article>` : ''}
  </section>`;
}

/* ───────── 장기 과제 화면 ───────── */
function newProjectForm() {
  const t = todayStr();
  return `<article class="card">
    <div class="card-head"><h2>새 장기 과제</h2></div>
    <div class="fields">
      <label class="field"><span>이름</span><input id="np-name" placeholder="예: 화학 IA" maxlength="80" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>시작일</span><input id="np-start" type="date" value="${t}"></label>
        <label class="field"><span>공식 마감</span><input id="np-deadline" type="date"></label>
      </div>
      <label class="field"><span>여유 기간 — 마감 며칠 전까지 끝낼지</span><input id="np-buffer" type="number" min="0" max="60" value="3" inputmode="numeric"></label>
      <label class="field"><span>단계 — 한 줄에 하나씩, 순서대로</span><textarea id="np-steps" rows="5">${DEFAULT_STEPS.join('\n')}</textarea></label>
    </div>
    <p class="muted small">단계는 시작일부터 '공식 마감 − 여유 기간'까지 고르게 나뉘어 배치됩니다. 만든 뒤에 날짜를 직접 고칠 수 있습니다.</p>
    <div class="btn-row"><button class="btn primary" data-action="proj-create">역산해서 만들기</button><button class="btn" data-action="proj-cancel">취소</button></div>
  </article>`;
}

function projectDetail(p, ms) {
  const t = todayStr();
  const b = f => `data-bind="projects|${p.id}|${f}" data-key="projects|${p.id}|${f}"`;
  return `<div class="proj-detail">
    <ul class="ms-list">${ms.map(m => `
      <li class="ms ${m.done ? 'done' : ''} ${!m.done && m.due < t ? 'late' : ''}">
        <input type="checkbox" data-change="ms-toggle" data-p="${p.id}" data-m="${m.id}" ${m.done ? 'checked' : ''} aria-label="${esc(m.title)} 완료">
        <input class="ms-title" data-change="ms-title" data-p="${p.id}" data-m="${m.id}" data-key="mst|${m.id}" value="${esc(m.title)}" maxlength="80" aria-label="단계 이름">
        <input class="ms-due" type="date" data-change="ms-due" data-p="${p.id}" data-m="${m.id}" data-key="msd|${m.id}" value="${m.due || ''}" aria-label="단계 날짜">
        <button class="icon-btn sm" data-action="ms-del" data-p="${p.id}" data-m="${m.id}" aria-label="단계 삭제">×</button>
      </li>`).join('')}
    </ul>
    <div class="add-row">
      <input id="ms-new-${p.id}" data-enter="ms-add" data-p="${p.id}" placeholder="단계 추가" maxlength="80" autocomplete="off">
      <input id="ms-new-date-${p.id}" type="date" value="${p.deadline ? addDays(p.deadline, -Number(p.buffer ?? 3)) : t}" aria-label="새 단계 날짜">
      <button class="btn" data-action="ms-add" data-p="${p.id}">추가</button>
    </div>
    <div class="fields two">
      <label class="field"><span>이름</span><input ${b('name')} value="${esc(p.name)}" maxlength="80"></label>
      <label class="field"><span>공식 마감</span><input type="date" ${b('deadline')} value="${p.deadline || ''}"></label>
      <label class="field"><span>여유 기간(일)</span><input type="number" min="0" max="60" inputmode="numeric" ${b('buffer')} value="${p.buffer ?? 3}"></label>
    </div>
    <div class="btn-row wrap">
      <button class="btn" data-action="proj-redistribute" data-id="${p.id}">남은 단계 다시 역산</button>
      <button class="btn" data-action="proj-archive" data-id="${p.id}">보관</button>
      <button class="btn danger" data-action="proj-del" data-id="${p.id}">삭제</button>
    </div>
  </div>`;
}

function projectCard(p) {
  const ms = sortedMs(p), done = ms.filter(m => m.done).length, open = ui.openProject === p.id;
  const next = ms.find(m => !m.done), t = todayStr();
  const pct = ms.length ? Math.round((done / ms.length) * 100) : 0;
  return `<article class="card project ${open ? 'open' : ''}">
    <button class="proj-head" data-action="proj-open" data-id="${p.id}" aria-expanded="${open}">
      <span class="proj-title"><b>${esc(p.name)}</b><small>${p.deadline ? `${fmtMD(p.deadline)} 마감 · ${dday(p.deadline)}` : '마감 미정'}</small></span>
      <span class="proj-count">${done}/${ms.length}<i class="chev">${open ? '−' : '+'}</i></span>
    </button>
    <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    ${next
      ? `<p class="proj-next ${next.due < t ? 'late' : ''}">다음: ${esc(next.title)} · ${fmtMD(next.due)} (${next.due < t ? '지남' : dday(next.due)})</p>`
      : ms.length ? `<p class="proj-next ok">모든 단계를 끝냈습니다</p>` : '<p class="proj-next">단계가 없습니다</p>'}
    ${open ? projectDetail(p, ms) : ''}
  </article>`;
}

function viewProjects() {
  const all = projectList(), active = all.filter(p => !p.archived), archived = all.filter(p => p.archived);
  const empty = `<article class="card"><p class="muted">아직 장기 과제가 없습니다. IA나 EE처럼 마감이 먼 과제를 등록하면, 마감에서 거꾸로 계산한 중간 지점이 오늘·주·달 화면에 자동으로 표시됩니다.</p></article>`;
  return `<section class="view">
    <header class="vhead plain">
      <div class="vtitle"><h1>장기 과제</h1><span class="sub">마감에서 거꾸로 중간 지점을 잡습니다</span></div>
      ${ui.newProject ? '' : `<button class="btn primary" data-action="proj-new">새 장기 과제</button>`}
    </header>
    ${ui.newProject ? newProjectForm() : ''}
    ${active.length ? active.map(projectCard).join('') : ui.newProject ? '' : empty}
    ${archived.length ? `<button class="link-btn" data-action="toggle-archived">${ui.showArchived ? '보관함 접기' : `보관된 과제 ${archived.length}개 보기`}</button>
      ${ui.showArchived ? archived.map(p => `<article class="card slim archived">
        <span>${esc(p.name)} <small class="muted">${p.deadline ? `${fmtMD(p.deadline)} 마감` : ''}</small></span>
        <span class="btn-row tight"><button class="btn sm" data-action="proj-restore" data-id="${p.id}">복원</button><button class="btn sm danger" data-action="proj-del" data-id="${p.id}">삭제</button></span>
      </article>`).join('') : ''}` : ''}
  </section>`;
}

/* ───────── 타이머 화면 ───────── */
function offerCard() {
  const o = mt.offer;
  return `<article class="card offer">
    <p><b>${o.min}분</b> 집중했습니다. ${o.date === todayStr() ? '오늘' : fmtMD(o.date)} 집중 시간에 기록할까요?</p>
    <div class="btn-row tight"><button class="btn primary" data-action="mt-record">기록</button><button class="btn" data-action="mt-norecord">기록 안 함</button></div>
  </article>`;
}

function musicCard() {
  const L = music.list, open = ui.musicOpen;
  const tracks = L.map((t, i) => `<li class="track ${i === music.cur ? 'active' : ''}">
      <span class="tn">${i + 1}</span><span class="tname" title="${esc(t.name)}">${esc(t.name)}</span>
      <span class="tbtns">
        <button class="icon-btn sm" data-action="music-move" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="위로">↑</button>
        <button class="icon-btn sm" data-action="music-move" data-i="${i}" data-dir="1" ${i === L.length - 1 ? 'disabled' : ''} aria-label="아래로">↓</button>
        <button class="icon-btn sm" data-action="music-play" data-i="${i}" aria-label="재생">▶</button>
        <button class="icon-btn sm" data-action="music-del" data-i="${i}" aria-label="삭제">×</button>
      </span></li>`).join('');
  return `<article class="card music">
    <button class="music-head" data-action="music-open" aria-expanded="${open}"><span aria-hidden="true">🎵</span><b>알람 음악</b><span class="muted small">${L.length ? `${L.length}곡` : '기본 알림음'}</span><i class="chev">${open ? '−' : '+'}</i></button>
    ${open ? `<div class="music-body">
      <p class="muted small">타이머가 끝나면 첫 곡부터 재생됩니다. 비워 두면 기본 알림음이 울립니다. 올린 음악은 이 기기에 저장됩니다.</p>
      <div class="btn-row tight wrap">
        <label class="btn file-btn">+ 파일 추가<input type="file" id="music-file" accept="audio/*" multiple hidden></label>
        <button class="btn" data-action="music-repeat">${music.repeat ? '반복 켜짐' : '반복 꺼짐'}</button>
      </div>
      ${L.length ? `<ul class="track-list">${tracks}</ul>
      <div class="player">
        <div class="player-btns">
          <button class="round-btn sm" data-action="music-prev" aria-label="이전 곡">⏮</button>
          <button class="round-btn main sm" data-action="music-toggle" aria-label="재생/일시정지">${music.playing ? ICON_PAUSE : ICON_PLAY}</button>
          <button class="round-btn sm" data-action="music-next" aria-label="다음 곡">⏭</button>
        </div>
        <div class="now">${music.cur >= 0 && L[music.cur] ? esc(L[music.cur].name) : '트랙 없음'}</div>
        <input type="range" id="music-seek" min="0" max="1000" value="0" aria-label="재생 위치">
        <div class="time-row"><span id="music-cur">0:00</span><span id="music-dur">0:00</span></div>
      </div>` : `<p class="muted small">파일을 추가하면 여기에 표시됩니다.</p>`}
    </div>` : ''}
  </article>`;
}

function viewTimer() {
  const rem = mtRemain(), ratio = mt.totalMs > 0 ? rem / mt.totalMs : 0, run = mtRunning();
  const set = Math.round(mt.setMs / 1000), h = Math.floor(set / 3600), m = Math.floor((set % 3600) / 60), s = set % 60;
  const task = topTask(todayStr())?.text;
  const pipOk = 'documentPictureInPicture' in window;
  const fields = [['h', h, 23, '시간'], ['m', m, 59, '분'], ['s', s, 59, '초']]
    .map(([k, v, max, lb], i) => `${i ? '<span class="mt-colon">:</span>' : ''}<label class="mt-in"><input id="mt-${k}" type="number" inputmode="numeric" min="0" max="${max}" value="${v}" ${run ? 'disabled' : ''} data-mt-input aria-label="${lb}"><span>${lb}</span></label>`).join('');
  return `<section class="view">
    <header class="vhead plain">
      <div class="vtitle"><h1>타이머</h1><span class="sub">${task ? `오늘: ${esc(task)}` : '오늘 과제를 정하면 여기와 미니 창에 표시됩니다'}</span></div>
      ${pipOk ? `<button class="btn ${pipWin ? 'primary' : ''}" data-action="mt-pip">${pipWin ? '미니 창 닫기' : '미니 창'}</button>` : ''}
    </header>
    ${mt.offer ? offerCard() : ''}
    <article class="card mt-card">
      <div class="mt-ring-wrap">
        <svg class="mt-ring" viewBox="0 0 256 256" aria-hidden="true">
          <circle class="mt-track" cx="128" cy="128" r="${MT_R}"/>
          <circle id="mt-ring" class="mt-prog ${mt.status === 'done' ? 'done' : ''}" cx="128" cy="128" r="${MT_R}" stroke-dasharray="${MT_C.toFixed(2)}" style="stroke-dashoffset:${(MT_C * (1 - ratio)).toFixed(2)}"/>
        </svg>
        <div class="mt-center"><span id="mt-display" class="mt-num">${fmtClock(rem)}</span><span id="mt-label" class="mt-label">${MT_LABEL[mt.status]}</span></div>
      </div>
      <div class="mt-inputs ${run ? 'dim' : ''}">${fields}</div>
      <div class="mt-presets">${[[1, '+1분'], [5, '+5분'], [10, '+10분'], [30, '+30분'], [60, '+1시간']].map(([n, l]) => `<button class="chip-btn" data-action="mt-preset" data-min="${n}">${l}</button>`).join('')}</div>
      <div class="mt-controls">
        <button class="round-btn" data-action="mt-reset" aria-label="리셋">${ICON_RESET}</button>
        <button class="round-btn main" data-action="mt-toggle" aria-label="${run ? '일시정지' : '시작'}">${run ? ICON_PAUSE : ICON_PLAY}</button>
        <button class="round-btn" data-action="mt-add" aria-label="1분 추가">+1m</button>
      </div>
    </article>
    ${musicCard()}
  </section>`;
}

function alarmOverlay() {
  if (!mt.alarm) return '';
  const min = Math.round(mtSession() / 60000);
  return `<div class="alarm-ov" role="alertdialog" aria-label="타이머 종료"><div class="alarm-box">
    <div class="alarm-icon" aria-hidden="true">⏰</div>
    <b>타이머 종료</b>
    ${min >= 1
      ? `<p class="muted">이번에 ${min}분 집중했습니다. 집중 시간에 기록할까요?</p>
         <div class="btn-col"><button class="btn primary" data-action="mt-dismiss" data-rec="1">기록하고 닫기</button><button class="btn" data-action="mt-dismiss" data-rec="0">기록 없이 닫기</button></div>`
      : `<div class="btn-col"><button class="btn primary" data-action="mt-dismiss" data-rec="0">확인</button></div>`}
  </div></div>`;
}

/* ───────── 색상 설정 카드 ───────── */
function colorEditor(def, c) {
  return `<div class="color-ed">
    <div class="ce-head"><span>${def.label}${def.hint ? `<small class="muted"> · ${def.hint}</small>` : ''}</span><i class="swatch" id="sw-${def.id}" style="background:${rgb(c)}"></i></div>
    ${['r', 'g', 'b'].map(ch => `<div class="rgb-row"><span>${ch.toUpperCase()}</span>
      <input type="range" min="0" max="255" value="${c[ch]}" data-color="${def.id}" data-ch="${ch}" id="cr-${def.id}-${ch}" aria-label="${def.label} ${ch.toUpperCase()}">
      <input type="number" min="0" max="255" inputmode="numeric" value="${c[ch]}" data-color="${def.id}" data-ch="${ch}" id="cn-${def.id}-${ch}" aria-label="${def.label} ${ch.toUpperCase()} 값"></div>`).join('')}
  </div>`;
}

function colorCard() {
  const th = currentTheme(), custom = th.mode === 'custom';
  const same = p => custom && ['bg', 'accent', 'text', 'warm'].every(k => JSON.stringify(p[k]) === JSON.stringify({ r: th[k].r, g: th[k].g, b: th[k].b }));
  return `<article class="card">
    <div class="card-head"><h2>색상</h2><span class="muted small">${custom ? '직접 지정' : '기기 설정 따라감'}</span></div>
    <div class="theme-row">${PRESETS.map(p => `<button class="theme-chip ${same(p) ? 'active' : ''}" data-action="theme-preset" data-id="${p.id}" style="--c-bg:${rgb(p.bg)};--c-ac:${rgb(p.accent)}"><i></i><span>${p.label}</span></button>`).join('')}</div>
    <div class="color-editors">${COLOR_DEFS.map(d => colorEditor(d, th[d.id])).join('')}</div>
    ${custom ? `<div class="btn-row"><button class="btn" data-action="theme-auto">기본값(라이트·다크 자동)으로 되돌리기</button></div>` : ''}
    <p class="muted small">플래너·타이머·미니 창 전체에 적용되고, 같은 계정으로 로그인한 기기에도 동기화됩니다.</p>
  </article>`;
}

/* ───────── 설정 화면 ───────── */
function viewSettings() {
  const s = store.status;
  const local = s.mode === 'cloud' ? store.localBackup() : null;
  const hasLocal = !!local && Object.values(local).some(c => c && Object.keys(c).length);
  return `<section class="view">
    <header class="vhead plain"><div class="vtitle"><h1>설정</h1></div></header>
    <article class="card">
      <div class="card-head"><h2>계정과 동기화</h2>${syncBadge('sync-badge-2')}</div>
      ${s.mode === 'cloud'
        ? `<p class="account">${esc(s.user?.email || '')}</p>
           <p class="muted small">같은 계정으로 로그인한 모든 기기에서 기록이 이어집니다. 오프라인에서 입력한 내용은 기기에 저장해 두었다가 연결되면 올립니다.</p>
           <div class="btn-row"><button class="btn" data-action="logout">로그아웃</button></div>`
        : `<p class="muted small">Firebase 설정 전이라 이 기기에만 저장됩니다. 설정 안내(README)의 단계를 마치면 기기 간 연동이 켜지고, 그때 이 기기의 기록을 계정으로 옮길 수 있습니다.</p>`}
    </article>
    <article class="card">
      <div class="card-head"><h2>오늘 화면의 시작 타이머</h2></div>
      <label class="field inline"><span>시작 타이머 길이(분)</span><input type="number" min="1" max="120" inputmode="numeric" data-bind="meta|settings|timerMin" data-key="meta|settings|timerMin" value="${timerMin()}"></label>
    </article>
    ${colorCard()}
    <article class="card">
      <div class="card-head"><h2>데이터</h2></div>
      <div class="btn-row wrap tight">
        <button class="btn" data-action="export">백업 파일 내보내기</button>
        ${hasLocal ? `<button class="btn" data-action="import-local">이 기기의 로컬 기록 가져오기</button>` : ''}
      </div>
    </article>
    <p class="muted small center">학업 플래너 v${APP_VERSION}</p>
  </section>`;
}

/* ───────── 로그인 화면 ───────── */
const AUTH_ERR = {
  'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
  'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않습니다.',
  'auth/wrong-password': '이메일 또는 비밀번호가 맞지 않습니다.',
  'auth/user-not-found': '가입되지 않은 이메일입니다. 먼저 계정을 만들어 주세요.',
  'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인해 주세요.',
  'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
  'auth/missing-password': '비밀번호를 입력해 주세요.',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요. 로그인은 온라인에서만 됩니다.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  'auth/operation-not-allowed': 'Firebase 콘솔에서 이메일/비밀번호 로그인이 켜져 있는지 확인해 주세요.',
  'auth/configuration-not-found': 'Firebase 콘솔에서 Authentication을 시작하고 이메일/비밀번호 로그인을 켜 주세요.',
};

function viewAuth() {
  const off = !store.status.online;
  return center(`<section class="auth card">
    <h1>학업 플래너</h1>
    <p class="muted small">모든 기기에서 같은 계정으로 로그인하면 기록이 이어집니다. 한 번 로그인한 기기는 오프라인에서도 열립니다.</p>
    ${off ? `<p class="notice">지금은 오프라인입니다. 처음 로그인할 때는 인터넷 연결이 필요합니다.</p>` : ''}
    <form id="auth-form" class="fields" novalidate>
      <label class="field"><span>이메일</span><input id="auth-email" type="email" autocomplete="username" inputmode="email" required></label>
      <label class="field"><span>비밀번호 (6자 이상)</span><input id="auth-pw" type="password" autocomplete="current-password" minlength="6" required></label>
      <button class="btn primary" type="submit">로그인</button>
      <button class="btn" type="button" data-action="auth-signup">계정 만들기</button>
      <button class="link-btn" type="button" data-action="auth-reset">비밀번호 재설정 메일 받기</button>
    </form>
    <p class="auth-msg" role="alert"></p>
  </section>`);
}

// 로그인 처리는 화면을 다시 그리지 않고 직접 갱신(입력값 보존)
async function doAuth(kind) {
  const email = document.getElementById('auth-email')?.value.trim() || '';
  const pw = document.getElementById('auth-pw')?.value || '';
  const msg = document.querySelector('.auth-msg');
  const setMsg = (t, ok = false) => { if (msg) { msg.textContent = t; msg.classList.toggle('ok', ok); } };
  if (!email) return setMsg('이메일을 입력해 주세요.');
  if (kind !== 'reset' && pw.length < 6) return setMsg('비밀번호는 6자 이상이어야 합니다.');
  const btns = [...document.querySelectorAll('#auth-form button')];
  btns.forEach(b => { b.disabled = true; });
  setMsg(kind === 'reset' ? '메일을 보내는 중…' : '확인하는 중…', true);
  try {
    if (kind === 'login') await store.login(email, pw);
    else if (kind === 'signup') await store.signup(email, pw);
    else { await store.resetPassword(email); setMsg('재설정 메일을 보냈습니다. 메일함을 확인해 주세요.', true); }
  } catch (e) {
    setMsg(AUTH_ERR[e.code] || `오류가 났습니다: ${e.code || e.message}`);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

/* ───────── 전체 틀과 렌더링 ───────── */
function shell() {
  const s = store.status;
  if (s.phase === 'error') return center(`<h1>열 수 없습니다</h1><p class="muted">${esc(s.error)}</p>`);
  if (s.phase === 'loading' || s.phase === 'syncing') return center(`<p class="muted">불러오는 중…</p>`);
  if (s.phase === 'login') return viewAuth();
  const tabs = [['day', '오늘'], ['week', '주'], ['month', '달'], ['projects', '장기 과제'], ['timer', '타이머']];
  const views = { day: viewDay, week: viewWeek, month: viewMonth, projects: viewProjects, timer: viewTimer, settings: viewSettings };
  return `<div class="layout">
    <header class="topbar">
      <span class="brand">학업 플래너</span>
      <span class="top-right">${timerMini()}${syncBadge()}<button class="icon-btn gear ${ui.view === 'settings' ? 'active' : ''}" data-action="nav" data-view="settings" aria-label="설정">${ICON.settings}</button></span>
    </header>
    <nav class="tabs" aria-label="화면 전환">
      ${tabs.map(([v, label]) => `<button class="tab ${ui.view === v ? 'active' : ''}" data-action="nav" data-view="${v}" ${ui.view === v ? 'aria-current="page"' : ''}>${ICON[v]}<span>${label}</span></button>`).join('')}
    </nav>
    ${s.error ? `<div class="banner" role="alert"><span>${esc(s.error)}</span><button class="link-btn" data-action="dismiss-error">닫기</button></div>` : ''}
    <main class="main">${views[ui.view]()}</main>
    ${alarmOverlay()}
  </div>`;
}

let rafId = 0, composing = false, renderQueued = false;
function scheduleRender() {
  if (composing) { renderQueued = true; return; } // 한글 입력 조합 중에는 미룸
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; render(); });
}

function render() {
  // 입력 중이던 칸의 포커스·커서·아직 저장 안 된 값을 보존
  const a = document.activeElement;
  let sel = null, val = null, key = null;
  if (a && $app.contains(a) && (a.dataset.key || a.id)) {
    key = a.dataset.key ? `[data-key="${CSS.escape(a.dataset.key)}"]` : `#${CSS.escape(a.id)}`;
    if ('value' in a && a.type !== 'checkbox') val = a.value;
    try { sel = [a.selectionStart, a.selectionEnd]; } catch { sel = null; }
  }
  $app.innerHTML = shell();
  if (key) {
    const el = $app.querySelector(key);
    if (el) {
      if (val !== null && el.value !== val) el.value = val;
      el.focus({ preventScroll: true });
      try { if (sel && sel[0] != null && el.setSelectionRange) el.setSelectionRange(sel[0], sel[1]); } catch { /* 날짜 칸 등 */ }
    }
  }
  updateTimerDom();
}

function updateBadge() {
  for (const id of ['sync-badge', 'sync-badge-2']) {
    const el = document.getElementById(id);
    if (el) el.outerHTML = syncBadge(id);
  }
}

let toastTimer = 0;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}

const scrollTop = () => window.scrollTo({ top: 0 });

/* ───────── 동작 ───────── */
function updateMs(pid, mid, patch) {
  const p = store.data.projects[pid];
  if (!p) return;
  store.set('projects', pid, { milestones: (p.milestones || []).map(m => (m.id === mid ? { ...m, ...patch } : m)) });
}
function updateGoals(ws, fn) {
  store.set('weeks', ws, { goals: fn([...(store.data.weeks[ws]?.goals || [])]) });
}
const shiftMonth = (ym, delta) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

const actions = {
  nav(el) {
    const v = el.dataset.view, t = todayStr();
    if (v === 'day') ui.day = t;
    if (v === 'week') ui.week = weekStart(t);
    if (v === 'month') ui.month = t.slice(0, 7);
    ui.view = v; render(); scrollTop();
  },
  'day-prev'() { ui.day = addDays(ui.day, -1); render(); },
  'day-next'() { ui.day = addDays(ui.day, 1); render(); },
  'day-reset'() { ui.day = todayStr(); render(); },
  'week-prev'() { ui.week = addDays(ui.week, -7); render(); },
  'week-next'() { ui.week = addDays(ui.week, 7); render(); },
  'week-reset'() { ui.week = weekStart(todayStr()); render(); },
  'month-prev'() { ui.month = shiftMonth(ui.month, -1); render(); },
  'month-next'() { ui.month = shiftMonth(ui.month, 1); render(); },
  'month-reset'() { ui.month = todayStr().slice(0, 7); render(); },
  'goto-day'(el) { ui.view = 'day'; ui.day = el.dataset.date; render(); scrollTop(); },
  'goto-week'(el) { ui.view = 'week'; ui.week = weekStart(el.dataset.date); render(); scrollTop(); },

  'timer-start'() {
    ensureAudio();
    const t = todayStr();
    timer = { date: t, phase: 'warm', warmMs: timerMin() * 60000, accMs: 0, segStart: Date.now() };
    saveTimer();
    if (!dayRec(t).started) store.set('days', t, { started: true, startedAt: Date.now() });
    else render();
  },
  'timer-continue'() {
    if (!timer) return;
    ensureAudio();
    timer.phase = 'flow'; timer.segStart = Date.now(); timer.chimePending = false;
    saveTimer(); render();
  },
  'timer-stop'() {
    if (!timer) return;
    const min = Math.round(elapsed() / 60000), d = timer.date;
    timer = null; saveTimer();
    if (min > 0) store.set('days', d, { focusMin: (dayRec(d).focusMin || 0) + min });
    else render();
    toast(min > 0 ? `${min}분을 기록했습니다.` : '시작한 것으로 기록했습니다.');
  },
  'mark-started'() { store.set('days', todayStr(), { started: true, startedAt: Date.now() }); },

  'goal-add'() {
    const inp = document.getElementById('goal-new');
    const text = inp?.value.trim();
    if (!text) { inp?.focus(); return; }
    const projectId = document.getElementById('goal-proj')?.value || null;
    inp.value = '';
    updateGoals(ui.week, g => [...g, { id: uid(), text, done: false, projectId }]);
  },
  'goal-del'(el) { updateGoals(el.dataset.w, g => g.filter(x => x.id !== el.dataset.id)); },

  'ms-add'(el) {
    const pid = el.dataset.p, p = store.data.projects[pid];
    const inp = document.getElementById(`ms-new-${pid}`), dateInp = document.getElementById(`ms-new-date-${pid}`);
    const title = inp?.value.trim();
    if (!p || !title) { inp?.focus(); return; }
    const due = dateInp?.value || todayStr();
    inp.value = '';
    store.set('projects', pid, { milestones: [...(p.milestones || []), { id: uid(), title, due, done: false }] });
  },
  'ms-del'(el) {
    const p = store.data.projects[el.dataset.p];
    if (!p || !confirm('이 단계를 삭제할까요?')) return;
    store.set('projects', el.dataset.p, { milestones: (p.milestones || []).filter(m => m.id !== el.dataset.m) });
  },

  'proj-new'() { ui.newProject = true; render(); document.getElementById('np-name')?.focus(); },
  'proj-cancel'() { ui.newProject = false; render(); },
  'proj-create'() {
    const v = id => document.getElementById(id)?.value.trim() || '';
    const name = v('np-name'), start = v('np-start') || todayStr(), deadline = v('np-deadline');
    const buffer = Math.max(0, Math.min(60, Number(v('np-buffer')) || 0));
    const steps = v('np-steps').split('\n').map(s => s.trim()).filter(Boolean);
    if (!name) return toast('과제 이름을 입력해 주세요.');
    if (!deadline) return toast('공식 마감일을 입력해 주세요.');
    if (deadline < start) return toast('마감일이 시작일보다 앞설 수 없습니다.');
    const id = uid();
    store.set('projects', id, {
      name, start, deadline, buffer, archived: false, createdAt: Date.now(),
      milestones: distribute(start, deadline, buffer, steps.length ? steps : DEFAULT_STEPS),
    });
    ui.newProject = false; ui.openProject = id; render();
    toast('마감에서 거꾸로 단계를 배치했습니다.');
  },
  'proj-open'(el) { ui.openProject = ui.openProject === el.dataset.id ? null : el.dataset.id; render(); },
  'proj-archive'(el) { if (ui.openProject === el.dataset.id) ui.openProject = null; store.set('projects', el.dataset.id, { archived: true }); toast('보관했습니다.'); },
  'proj-restore'(el) { store.set('projects', el.dataset.id, { archived: false }); },
  'proj-del'(el) {
    const p = store.data.projects[el.dataset.id];
    if (!p || !confirm(`'${p.name}'을(를) 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return;
    if (ui.openProject === el.dataset.id) ui.openProject = null;
    store.remove('projects', el.dataset.id);
  },
  'proj-redistribute'(el) {
    const p = store.data.projects[el.dataset.id];
    if (!p) return;
    if (!p.deadline) return toast('공식 마감일을 먼저 입력해 주세요.');
    store.set('projects', el.dataset.id, { milestones: redistribute(p) });
    toast('끝나지 않은 단계를 오늘부터 다시 배치했습니다.');
  },
  'toggle-archived'() { ui.showArchived = !ui.showArchived; render(); },

  'auth-signup'() { doAuth('signup'); },
  'auth-reset'() { doAuth('reset'); },
  logout() { if (confirm('로그아웃할까요?')) store.logout(); },
  export() {
    const blob = new Blob([JSON.stringify({ app: 'study-planner', version: APP_VERSION, exportedAt: new Date().toISOString(), data: store.data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `planner-backup-${todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  'import-local'() {
    const n = store.importData(store.localBackup());
    toast(n ? `${n}개 항목을 가져왔습니다.` : '가져올 새 항목이 없습니다.');
  },
  'dismiss-error'() { store.clearError(); },

  't-add'(el) {
    const date = el.dataset.date, inp = document.getElementById(`t-new-${date}`), text = inp?.value.trim();
    if (!text) { inp?.focus(); return; }
    inp.value = '';
    setTasks(date, [...getTasks(date), { id: uid(), text, memo: '', cue: '', done: false, projectId: null, milestoneId: null }]);
  },
  't-move'(el) {
    const { date, id } = el.dataset, list = [...getTasks(date)];
    const i = list.findIndex(t => t.id === id), j = i + Number(el.dataset.dir);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setTasks(date, list);
  },
  't-edit'(el) { const k = `${el.dataset.date}|${el.dataset.id}`; ui.editTask = ui.editTask === k ? null : k; render(); },
  't-del'(el) {
    const { date, id } = el.dataset, t = getTasks(date).find(x => x.id === id);
    if (!t || !confirm(`'${t.text}'을(를) 삭제할까요?`)) return;
    ui.editTask = null;
    setTasks(date, getTasks(date).filter(x => x.id !== id));
  },
  't-carry'(el) { carryTasks(el.dataset.date, [el.dataset.id]); },
  't-carry-all'(el) { const date = el.dataset.date; carryTasks(date, getTasks(date).filter(t => !t.done).map(t => t.id)); },

  'mt-toggle'() { mtToggle(); },
  'mt-reset'() { mtReset(); },
  'mt-add'() { mtAdd(60); },
  'mt-preset'(el) { mtPreset(Number(el.dataset.min)); },
  'mt-dismiss'(el) { mtDismiss(el.dataset.rec === '1'); },
  'mt-record'() { if (!mt.offer) return; recordFocus(mt.offer.min, mt.offer.date); mt.offer = null; mtSave(); scheduleRender(); },
  'mt-norecord'() { mt.offer = null; mtSave(); scheduleRender(); },
  'mt-pip'() { togglePip(); },
  'music-open'() { ui.musicOpen = !ui.musicOpen; render(); },
  'music-repeat'() { music.toggleRepeat(); },
  'music-move'(el) { music.move(Number(el.dataset.i), Number(el.dataset.dir)); },
  'music-play'(el) { music.play(Number(el.dataset.i)); },
  'music-del'(el) {
    const i = Number(el.dataset.i), t = music.list[i];
    if (t && confirm(`'${t.name}'을(를) 목록에서 지울까요?`)) music.remove(i);
  },
  'music-toggle'() { music.toggle(); },
  'music-prev'() { music.prev(); },
  'music-next'() { music.next(); },
  'theme-preset'(el) {
    const p = PRESETS.find(x => x.id === el.dataset.id);
    if (!p) return;
    ui.themeDraft = null;
    saveTheme({ mode: 'custom', bg: { ...p.bg }, accent: { ...p.accent }, text: { ...p.text }, warm: { ...p.warm } });
  },
  'theme-auto'() { ui.themeDraft = null; saveTheme({ mode: 'auto' }); },
};

const changeActions = {
  tfield(el) {
    const { date, id } = el.dataset, f = el.dataset.tfield, v = el.value.trim();
    const t = getTasks(date).find(x => x.id === id);
    if (!t) return;
    if (f === 'text' && !v) { render(); return; } // 과제 이름은 비울 수 없음
    if ((t[f] || '') === v) return;
    updateTask(date, id, { [f]: v });
  },
  tdone(el) { updateTask(el.dataset.date, el.dataset.id, { done: el.checked }); },
  tlink(el) {
    const { date, id } = el.dataset, [pid, mid] = el.value.split('::');
    updateTask(date, id, { projectId: pid || null, milestoneId: mid || null });
  },
  'goal-toggle'(el) { updateGoals(el.dataset.w, g => g.map(x => (x.id === el.dataset.id ? { ...x, done: el.checked } : x))); },
  'ms-toggle'(el) { updateMs(el.dataset.p, el.dataset.m, { done: el.checked }); },
  'ms-title'(el) { const v = el.value.trim(); if (v) updateMs(el.dataset.p, el.dataset.m, { title: v }); else render(); },
  'ms-due'(el) { if (el.value) updateMs(el.dataset.p, el.dataset.m, { due: el.value }); else render(); },
};

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !$app.contains(el)) return;
  actions[el.dataset.action]?.(el, e);
});

$app.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'music-file') { if (el.files?.length) music.add([...el.files]); el.value = ''; return; }
  if (el.dataset.color) { commitThemeDraft(); return; }
  if ('mtInput' in el.dataset) return;
  if (el.dataset.tfield) { changeActions.tfield(el); return; }
  if (el.dataset.bind) {
    const [col, id, field] = el.dataset.bind.split('|');
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) || 0 : el.value.trim();
    if ((dayRecLike(col, id)[field] ?? '') === v) return; // 바뀐 게 없으면 저장하지 않음
    store.set(col, id, { [field]: v });
    return;
  }
  if (el.dataset.change) changeActions[el.dataset.change]?.(el);
});
const dayRecLike = (col, id) => store.data[col]?.[id] || {};

$app.addEventListener('input', e => {
  const el = e.target;
  if ('mtInput' in el.dataset) { mtFromInputs(); return; }
  if (el.dataset.color) { themeInput(el); return; }
  if (el.id === 'music-seek') music.seek(Number(el.value) / 1000);
});

$app.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const el = e.target;
  if (el.dataset.enter) { e.preventDefault(); actions[el.dataset.enter]?.(el); }
  else if ((el.dataset.bind || el.dataset.tfield) && el.tagName === 'INPUT') { e.preventDefault(); el.blur(); }
});

$app.addEventListener('submit', e => {
  if (e.target.id === 'auth-form') { e.preventDefault(); doAuth('login'); }
});

document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { composing = false; if (renderQueued) { renderQueued = false; scheduleRender(); } });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  tick();
  if (timer?.chimePending) { timer.chimePending = false; saveTimer(); chime(); }
});

store.subscribe(reason => {
  if (store.status.phase === 'ready') syncTheme();
  if (reason === 'status' && store.status.phase === 'ready') { updateBadge(); return; }
  scheduleRender();
  pipRefresh();
});

// 자정이 지나면 '오늘'을 따라감
let lastToday = todayStr();
setInterval(() => {
  const t = todayStr();
  if (t === lastToday) return;
  if (ui.day === lastToday) ui.day = t;
  if (ui.week === weekStart(lastToday)) ui.week = weekStart(t);
  if (ui.month === lastToday.slice(0, 7)) ui.month = t.slice(0, 7);
  lastToday = t;
  scheduleRender();
}, 30000);

setInterval(tick, 250);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('서비스 워커 등록 실패', err));
    // 다른 앱 등이 오프라인용 파일을 지웠을 경우를 대비해, 온라인일 때마다 빠진 파일을 채워 넣음
    navigator.serviceWorker.ready.then(reg => { if (navigator.onLine) reg.active?.postMessage('heal'); }).catch(() => {});
  });
}

if (mtRunning() && mt.endTime <= Date.now()) mtFinish(true); // 앱이 꺼진 사이 끝난 타이머
music.load();
render();
store.init();
