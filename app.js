// Planerr — 화면과 동작
import { Store } from './store.js';
import { tasksOf, taskPatch, isTask, listOfMap, mapPatch } from './tasks.js';
import { bridgeCall, scriptCode, makeSecret } from './bridge.js';
import { areaList, areaInfo as areaInfoOf, topAreas, subAreas, DEFAULT_AREA } from './areas.js';
import { applyTheme, cachedTheme, cacheTheme, fillTheme, PRESETS, COLOR_DEFS, COLOR_KEYS, rgb } from './theme.js';
import { Player, cacheGet, cachePut, cacheDelete, cacheIds, legacyTracks, legacyClear } from './music.js';
import { ensureFolder, uploadFile, downloadFile, deleteFile } from './drive.js';
import * as CFG from './config.js';
import { GCal, syncCalendar, eventSig, hexId, insertEvent, eventsPath, CAL_SCOPE, DRIVE_SCOPE } from './calendar.js';
import { toMin, toHM, isoDow, routineOf, buildTimeline, taskEnd } from './timetable.js';
import { CUR_TEMPLATE, parseCurriculum } from './curriculum.js';
import { renderMd, plainPreview } from './md.js';

applyTheme(cachedTheme()); // 화면이 그려지기 전에 저장된 색을 먼저 적용

const APP_VERSION = '1.19.0';
const BASE_TITLE = 'Planerr';
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
  areaFilter: (() => { try { return localStorage.getItem('planner.areaFilter.v1') || ''; } catch { return ''; } })(), // 걸러 볼 영역(''면 전체)
  view: 'day',
  curId: null,       // 커리큘럼 탭에서 연 커리큘럼
  curOpen: null,     // 펼쳐 고치는 중인 레슨 id
  curDone: null,     // 끝냄 입력 중인 { cid, lid }
  curNote: null,     // 과제로 끝낸 레슨에 한 줄 남기기 { cid, lid }
  curLesson: null,   // 연 레슨 화면(레슨 id)
  curEdit: null,     // 고치는 중인 레슨·단원 id
  curNew: false, curPaste: false, curTpl: false, curShowArch: false, curGuide: false, curGuideEdit: false,
  statMode: 'week',  // 기록 화면: 'week' | 'month'
  statAnchor: null,  // 기록 화면이 보여 주는 기간 안의 날짜(없으면 오늘)
  logArea: null,     // 직접 기록 칸에 미리 골라 둘 영역(반복 목표의 '기록'에서)
  day: todayStr(),
  week: weekStart(todayStr()),
  month: todayStr().slice(0, 7),
  openProject: null,
  newProject: false,
  showArchived: false,
  editTask: null,
  alarms: [],
  musicOpen: false,
  plOpen: null,
  libPick: false,
  libAll: false,
  musicProgress: '',
  tlOpen: null,
  checklist: null,
  themeDraft: null,
  restore: null,     // 백업에서 되살리기: 비교 결과
  pinView: null,     // 오늘 화면에서 상시 과제칸을 보여 주는 중이면 { until }
  bridgeShow: false, // 캘린더 상시 연결 코드를 펼쳐 보여 줄지
  timerTab: (() => { try { return localStorage.getItem('planner.timertab.v1') === 'alarm' ? 'alarm' : 'study'; } catch { return 'study'; } })(),
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
// 날짜 있는 단계는 날짜순, 날짜 없는 단계(마감 없는 프로젝트)는 넣은 순서대로 그 뒤에
const sortedMs = p => [...(p.milestones || [])].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));

/* ───────── 영역(학업·자기개발·여가와 세부 영역) — 데이터 규칙은 areas.js ───────── */
const areas = () => areaList(store.data.meta.areas);
const areaInfo = id => areaInfoOf(areas(), id);
const itemArea = x => (x && x.area) || DEFAULT_AREA; // 영역이 없던 예전 과제·프로젝트는 학업
const LA_KEY = 'planner.lastArea.v1';
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 무시 */ } };
const areaFilter = () => { const f = ui.areaFilter; return f && topAreas(areas()).some(a => a.id === f) ? f : ''; };
const inFilter = x => { const f = areaFilter(); return !f || areaInfo(itemArea(x)).top.id === f; };
const focusOk = t => !areaInfo(itemArea(t)).top.quiet; // '지금 할 과제'로 올라올 수 있는 영역인지(quiet면 아님)
function setAreas(list) {
  const tm = mapPatch(store.data.meta.areas?.items, list);
  if (tm) store.patch('meta', 'areas', { items: tm });
}
// 새 과제·프로젝트의 영역: 걸러 보는 중이면 그 영역, 아니면 이 기기에서 마지막으로 고른 영역
function defaultArea() {
  const f = areaFilter(), last = lsGet(LA_KEY), ok = last && areas().some(a => a.id === last && !a.archived);
  if (f) return ok && areaInfo(last).top.id === f ? last : f;
  if (ok) return last;
  const tops = topAreas(areas());
  return tops.some(a => a.id === DEFAULT_AREA) ? DEFAULT_AREA : tops[0]?.id || DEFAULT_AREA;
}
const AREA_COLORS = ['#4a7fd4', '#2f9e6e', '#c2569f', '#d08a2e', '#7a63c9', '#2aa1b3', '#c4513d', '#6b8e23'];

function areasCard() {
  const list = areas(), tops = topAreas(list);
  const ex = { study: '수학', growth: '작곡', leisure: '리듬게임' };
  const subChip = a => `<span class="sub-chip"><input class="sub-in" data-change="area-field" data-f="text" data-id="${a.id}" data-key="af|${a.id}|text" value="${esc(a.text)}" maxlength="20" aria-label="세부 영역 이름"><button class="icon-btn sm" data-action="area-del" data-id="${a.id}" aria-label="${esc(a.text)} 지우기">×</button></span>`;
  return `<article class="card">
    <div class="card-head"><h2>영역</h2></div>
    <p class="muted small">과제와 프로젝트를 영역으로 나눕니다. 영역 안에는 과목·활동 같은 세부 영역을 한 단계까지 만들 수 있고, 오늘·주·프로젝트 화면 위쪽에서 영역별로 걸러 볼 수 있습니다.</p>
    ${tops.map(a => `<div class="area-ed" style="--ac:${a.color || '#888888'}">
      <div class="area-row">
        <input class="area-emoji" data-change="area-field" data-f="emoji" data-id="${a.id}" data-key="af|${a.id}|emoji" value="${esc(a.emoji || '')}" maxlength="4" aria-label="${esc(a.text)} 이모지">
        <input class="area-name" data-change="area-field" data-f="text" data-id="${a.id}" data-key="af|${a.id}|text" value="${esc(a.text)}" maxlength="20" aria-label="영역 이름">
        <input type="color" data-change="area-field" data-f="color" data-id="${a.id}" value="${esc(a.color || '#888888')}" aria-label="${esc(a.text)} 색">
        ${tops.length > 1 ? `<button class="icon-btn sm" data-action="area-del" data-id="${a.id}" aria-label="${esc(a.text)} 영역 지우기">×</button>` : ''}
      </div>
      <label class="check small"><input type="checkbox" data-change="area-field" data-f="quiet" data-id="${a.id}" ${a.quiet ? '' : 'checked'}><span>이 영역 과제를 '지금 할 과제'로 올리기</span></label>
      ${subAreas(list, a.id).length ? `<div class="sub-chips">${subAreas(list, a.id).map(subChip).join('')}</div>` : ''}
      <div class="add-row sm"><input id="sub-new-${a.id}" data-enter="sub-add" data-id="${a.id}" placeholder="세부 영역 추가 (예: ${ex[a.id] || '세부 영역'})" maxlength="20" autocomplete="off"><button class="btn sm" data-action="sub-add" data-id="${a.id}">추가</button></div>
    </div>`).join('')}
    <div class="add-row"><input id="area-new" data-enter="area-add" placeholder="영역 추가 (예: 운동)" maxlength="20" autocomplete="off"><button class="btn" data-action="area-add">영역 추가</button></div>
  </article>`;
}
function areaOptions(sel) {
  const list = areas();
  const opt = (a, label) => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${label}</option>`;
  let html = topAreas(list).map(t => {
    const subs = subAreas(list, t.id), head = `${esc(t.emoji || '')} ${esc(t.text)}`;
    return subs.length ? `<optgroup label="${head}">${opt(t, `${head} (전체)`)}${subs.map(x => opt(x, esc(x.text))).join('')}</optgroup>` : opt(t, head);
  }).join('');
  const gone = list.find(a => a.id === sel && a.archived);
  if (gone) html += `<option value="${gone.id}" selected>${esc(areaInfo(gone.id).full)} (지운 영역)</option>`;
  return html;
}
const areaTag = x => { const i = areaInfo(itemArea(x)); return `<small class="area-tag" style="--ac:${i.color}" title="${esc(i.full)}">${esc(i.label)}</small>`; };
function areaFilterBar() {
  const f = areaFilter(), tops = topAreas(areas());
  return `<div class="area-bar" role="toolbar" aria-label="영역으로 걸러 보기">
    <button class="area-f ${!f ? 'on' : ''}" data-action="area-filter" data-id="" aria-pressed="${!f}">전체</button>
    ${tops.map(a => `<button class="area-f ${f === a.id ? 'on' : ''}" data-action="area-filter" data-id="${a.id}" style="--ac:${a.color || '#888888'}" aria-pressed="${f === a.id}"><i></i>${esc(a.emoji || '')} ${esc(a.text)}</button>`).join('')}
  </div>`;
}

function eventsBetween(a, b) {
  const out = [];
  for (const p of activeProjects()) {
    for (const m of p.milestones || []) {
      if (m.due && m.due >= a && m.due <= b) out.push({ kind: 'ms', date: m.due, title: m.title, project: p.name, pid: p.id, mid: m.id, done: !!m.done, area: p.area });
    }
    if (p.deadline && p.deadline >= a && p.deadline <= b) out.push({ kind: 'deadline', date: p.deadline, project: p.name, pid: p.id, area: p.area });
  }
  for (const d of Object.keys(store.data.days)) {
    for (const t of getTasks(d)) {
      if (t.due && t.due >= a && t.due <= b) out.push({ kind: 'tdue', date: t.due, title: t.text, tdate: d, tid: t.id, done: !!t.done, area: t.area });
    }
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

/* ───────── 화면 너비에 맞춘 배치 ─────────
   가로 1000px 이상(크롬북, 가로로 둔 아이패드)에서는 왼쪽 메뉴 + 두 칸 배치.
   각 화면은 [html, 자리] 목록을 넘김: 'full'은 위 가로 전체, 'main'은 왼쪽(넓은) 칸, 'side'는 오른쪽 칸, 'end'는 맨 아래.
   좁은 화면에서는 적은 순서 그대로 한 줄로 쌓음 */
const WIDE = matchMedia('(min-width: 1000px)');
const isWide = () => WIDE.matches;
function layoutView(parts, cls = '') {
  const items = parts.filter(([h]) => h);
  if (!isWide()) return `<section class="view ${cls}">${items.map(([h]) => h).join('')}</section>`;
  const pick = k => items.filter(([, c]) => c === k).map(([h]) => h).join('');
  return `<section class="view wide2 ${cls}">${pick('full')}<div class="cols"><div class="col">${pick('main')}</div><div class="col side">${pick('side')}</div></div>${pick('end')}</section>`;
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
  checkAlarms();
  if (mtRunning() && mtRemain() <= 0) mtFinish();
  else updateMainTimerDom();
  if (atRunning() && atRemain() <= 0) atFinish();
  else updateAlarmTimerDom();
  pinTick();
  if (study.playing && !studyActive()) study.pause();
  if (timer && timer.phase === 'warm' && elapsed() >= timer.warmMs) {
    timer.accMs = timer.warmMs; timer.segStart = null; timer.phase = 'prompt';
    study.pause();
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
/* ───────── 음악: 플레이리스트(여러 개) ─────────
   플리·곡 정보는 Firebase로 기기 간 동기화되고, 음악 파일은 구글 드라이브를 거쳐 기기마다 받아 저장(오프라인 재생 가능)
   재생기: 공부용(study), 집중 타이머 종료음(music), 알람 타이머 종료음(alarm2), 플리 미리 듣기용(preview) */
function musicTime(p, cur, dur) {
  if (p !== uiPlayer()) return;
  const ok = Number.isFinite(dur) && dur > 0;
  const seek = document.getElementById('mp-seek');
  if (seek && ok && document.activeElement !== seek) seek.value = String(Math.round((cur / dur) * 1000));
  const c = document.getElementById('mp-cur');
  if (c) c.textContent = fmtT(cur);
  const d = document.getElementById('mp-dur');
  if (d && ok) d.textContent = fmtT(dur);
}
const music = new Player({ onChange: () => scheduleRender(), onTime: (c, d) => musicTime(music, c, d) });
const study = new Player({ onChange: () => scheduleRender(), onTime: (c, d) => musicTime(study, c, d) });
const preview = new Player({ onChange: () => scheduleRender(), onTime: (c, d) => musicTime(preview, c, d) });
const alarm2 = new Player({ onChange: () => scheduleRender(), onTime: (c, d) => musicTime(alarm2, c, d) });

// 집중 플리: 어느 타이머든 돌고 있을 때만 재생, 멈추면 같이 멈춤
const studyActive = () => mtRunning() || !!(timer && (timer.phase === 'warm' || timer.phase === 'flow'));
function syncStudy() {
  if (studyActive() && preview.playing) preview.pause();
  if (studyActive() && !music.alarmPlaying && !alarm2.alarmPlaying && !atm.alarm) { if (!study.playing && study.list.length) study.resume(); }
  else if (study.playing) study.pause();
}

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
    calTimerRemove();
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
  if (mtRunning()) calTimerUpsert();
  syncStudy();
}

function mtReset() {
  mtStopAlarm();
  calTimerRemove();
  mtOffer(mtSession(), mt.sessionDate);
  mtEndSession();
  const t = mt.setMs > 0 ? mt.setMs : MT_DEFAULT;
  Object.assign(mt, { status: 'ready', endTime: null, alarm: false, totalMs: t, remainMs: t });
  mtSave(); scheduleRender(); pipRefresh();
  syncStudy();
}

function mtAdd(sec) {
  const add = sec * 1000;
  if (mt.status === 'done') {
    mtStopAlarm();
    Object.assign(mt, { status: 'ready', alarm: false, totalMs: add, remainMs: add });
  } else if (mtRunning()) {
    const a = Math.min(add, Math.max(0, MT_CAP - mtRemain()));
    mt.endTime += a; mt.totalMs += a;
    calTimerUpsert();
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
async function notify(title, body, tag = 'planner-timer') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, { body, icon: './icons/icon-192.png', tag }); return; }
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
    calTimerRemove();
  } else {
    study.pause();
    music.playAlarm().then(ok => { if (!ok) playMelody(); });
    const task = topTask(todayStr())?.text;
    notify('⏰ 집중 타이머 종료', task ? `${task} — 설정한 시간이 됐어요.` : '설정한 시간이 됐어요.');
    try { navigator.vibrate?.([300, 150, 300]); } catch { /* 무시 */ }
  }
  mtSave(); scheduleRender(); pipRefresh();
}

function mtDismiss(record) {
  mtStopAlarm();
  calTimerRemove();
  const min = Math.round(mtSession() / 60000), date = mt.sessionDate || todayStr();
  if (record && min >= 1) recordFocus(min, date, document.getElementById('ov-area')?.value || mtArea());
  mtEndSession();
  mt.alarm = false;
  mtSave(); scheduleRender(); pipRefresh();
}

function recordFocus(min, date, area, src = 'timer') {
  const r = dayRec(date), ar = area || mtArea();
  store.set('days', date, { focusMin: (r.focusMin || 0) + min, started: true, ...(r.startedAt ? {} : { startedAt: Date.now() }) });
  addLog(date, { area: ar, min, src });
  toast(`${areaInfo(ar).label} ${min}분을 ${date === todayStr() ? '오늘' : fmtMD(date)} 기록에 넣었습니다.`);
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
  const t = startText ? `${startText} · ${BASE_TITLE}` : mtRunning() ? `${fmtClock(mtRemain())} · 타이머` : atRunning() ? `⏰ ${fmtClock(atRemain())} · 알람` : BASE_TITLE;
  if (document.title !== t) document.title = t;
}

/* ───────── 알람 타이머 ─────────
   공부와 상관없는 시간 재기(쉬는 시간, 빨래 등). 집중 타이머와 따로, 동시에 돌릴 수 있음
   체크리스트·집중 플리·집중 시간 기록 없이, 끝나면 '알람 타이머 종료음' 플리(없으면 기본 알림음)가 울림 */
const AKEY = 'planner.atimer.v1';
const AT_DEFAULT = 10 * 60000;
const atFresh = () => ({ totalMs: AT_DEFAULT, remainMs: AT_DEFAULT, setMs: AT_DEFAULT, endTime: null, status: 'ready', alarm: false, calEventId: null });
let atm = (() => { try { return { ...atFresh(), ...(JSON.parse(localStorage.getItem(AKEY)) || {}) }; } catch { return atFresh(); } })();
const atSave = () => { try { localStorage.setItem(AKEY, JSON.stringify(atm)); } catch { /* 무시 */ } };
const atRunning = () => atm.status === 'running';
const atRemain = () => (atRunning() ? Math.max(0, atm.endTime - Date.now()) : Math.max(0, atm.remainMs));
const fmtDurMs = ms => {
  const s = Math.round(ms / 1000), m = Math.floor(s / 60), r = s % 60;
  return m ? `${fmtDur(m)}${r ? ` ${r}초` : ''}` : `${r}초`;
};

function atStopSound() { alarm2.stopAlarm(); stopMelody(); }

function atToggle() {
  if (atRunning()) {
    atm.remainMs = atRemain(); atm.endTime = null; atm.status = 'paused';
    calTimerRemove(atm);
  } else {
    if (atm.remainMs <= 0) {
      if (atm.setMs <= 0) { toast('시간을 먼저 정해 주세요.'); return; }
      atm.totalMs = atm.setMs; atm.remainMs = atm.setMs;
    }
    ensureAudio(); alarm2.unlock(); askNotify();
    atStopSound(); atm.alarm = false;
    atm.endTime = Date.now() + atm.remainMs; atm.status = 'running';
  }
  atSave(); scheduleRender(); pipRefresh();
  if (atRunning()) calTimerUpsert(atm);
}

function atReset() {
  atStopSound();
  calTimerRemove(atm);
  const t = atm.setMs > 0 ? atm.setMs : AT_DEFAULT;
  Object.assign(atm, { status: 'ready', endTime: null, alarm: false, totalMs: t, remainMs: t });
  atSave(); scheduleRender(); pipRefresh();
  syncStudy();
}

function atAdd(sec) {
  const add = sec * 1000;
  if (atm.status === 'done') {
    atStopSound();
    Object.assign(atm, { status: 'ready', alarm: false, totalMs: add, remainMs: add });
    syncStudy();
  } else if (atRunning()) {
    const a = Math.min(add, Math.max(0, MT_CAP - atRemain()));
    atm.endTime += a; atm.totalMs += a;
    calTimerUpsert(atm);
  } else {
    atm.remainMs = Math.min(MT_CAP, atm.remainMs + add);
    atm.totalMs = Math.min(MT_CAP, atm.totalMs + add);
  }
  atSave(); scheduleRender(); pipRefresh();
}

function atPreset(min) {
  if (atRunning()) { atAdd(min * 60); return; }
  const ms = Math.min(Math.floor(atm.remainMs / 1000) * 1000 + min * 60000, MT_CAP);
  atStopSound();
  Object.assign(atm, { status: 'ready', alarm: false, totalMs: ms, remainMs: ms, setMs: ms });
  atSave(); scheduleRender(); pipRefresh();
}

function atFromInputs() {
  if (atRunning()) return;
  const v = (id, max) => Math.min(max, Math.max(0, parseInt(document.getElementById(id)?.value, 10) || 0));
  const ms = (v('at-h', 23) * 3600 + v('at-m', 59) * 60 + v('at-s', 59)) * 1000;
  const hadAlarm = atm.alarm;
  if (hadAlarm) atStopSound();
  Object.assign(atm, { status: 'ready', alarm: false, totalMs: ms, remainMs: ms, setMs: ms });
  atSave(); updateAlarmTimerDom();
  if (hadAlarm) { scheduleRender(); pipRefresh(); syncStudy(); }
}

// silent: 앱이 꺼져 있는 동안 끝난 경우(소리 없이 끝난 것으로만 표시)
function atFinish(silent = false) {
  Object.assign(atm, { status: 'done', remainMs: 0, endTime: null, alarm: !silent });
  if (silent) {
    calTimerRemove(atm);
  } else {
    // 알람이 잘 들리도록 집중 플리·미리 듣기는 잠시 멈추고, 확인을 누르면 집중 플리를 다시 틂
    study.pause();
    if (preview.playing) preview.pause();
    alarm2.playAlarm().then(ok => { if (!ok) playMelody(); });
    notify('⏰ 알람 타이머 종료', `${fmtDurMs(atm.totalMs)} 알람 타이머가 끝났습니다.`, 'planner-atimer');
    try { navigator.vibrate?.([300, 150, 300]); } catch { /* 무시 */ }
  }
  atSave(); scheduleRender(); pipRefresh();
}

function atDismiss() {
  atStopSound();
  calTimerRemove(atm);
  atm.alarm = false;
  atSave(); scheduleRender(); pipRefresh();
  syncStudy();
}

function updateAlarmTimerDom() {
  const rem = atRemain(), txt = fmtClock(rem), ratio = atm.totalMs > 0 ? rem / atm.totalMs : 0;
  const d = document.getElementById('at-display');
  if (d) d.textContent = txt;
  const r = document.getElementById('at-ring');
  if (r) r.style.strokeDashoffset = String(MT_C * (1 - ratio));
  const l = document.getElementById('at-label');
  if (l) l.textContent = MT_LABEL[atm.status];
  for (const id of ['at-mini-text', 'at-seg']) { const el = document.getElementById(id); if (el) el.textContent = txt; }
  const ms = document.getElementById('mt-seg');
  if (ms) ms.textContent = fmtClock(mtRemain());
  const p = pipWin?.document.getElementById('pat');
  if (p) p.textContent = txt;
}

const TTAB_KEY = 'planner.timertab.v1';
function setTimerTab(t) {
  ui.timerTab = t === 'alarm' ? 'alarm' : 'study';
  try { localStorage.setItem(TTAB_KEY, ui.timerTab); } catch { /* 무시 */ }
}

/* ───────── 알림 (앱 안 알람 + 구글 캘린더) ───────── */
const ALARM_DEFAULT = { dayBefore: { on: true, time: '20:00' }, sameDay: { on: false, time: '08:00' }, appSound: true, wakeLock: false };
function alarmSet() {
  const a = settings().alarms || {};
  return { ...ALARM_DEFAULT, ...a, dayBefore: { ...ALARM_DEFAULT.dayBefore, ...(a.dayBefore || {}) }, sameDay: { ...ALARM_DEFAULT.sameDay, ...(a.sameDay || {}) } };
}
const atTime = (date, hm) => { const [h, m] = String(hm || '00:00').split(':').map(Number); const d = parse(date); d.setHours(h || 0, m || 0, 0, 0); return d.getTime(); };
const hmOf = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'; } catch { return 'Asia/Seoul'; } })();
function isoLocal(ms) {
  const d = new Date(ms), off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const PLANNER_URL = location.origin + location.pathname;
const deviceId = (() => {
  try {
    let v = localStorage.getItem('planner.device.v1');
    if (!v) { v = Math.random().toString(36).slice(2, 10); localStorage.setItem('planner.device.v1', v); }
    return v;
  } catch { return 'dev'; }
})();

// 알림이 필요한 일정 전체: 과제 알림 시각, 과제 마감일, 프로젝트 중간 지점·공식 마감(어제부터)
function alarmSchedule() {
  const A = alarmSet(), from = addDays(todayStr(), -1), out = [];
  for (const date of Object.keys(store.data.days)) {
    if (date < from) continue;
    for (const task of getTasks(date)) {
      const when = task.alarm || task.start;
      if (task.done || !when) continue;
      const slot = toMin(task.start) != null ? [atTime(date, task.start), atTime(date, toHM(Math.min(taskEnd(task), 1439)))] : null;
      out.push({ kind: 'task', key: `t|${date}|${task.id}`, at: atTime(date, when), slot, title: task.text, body: task.memo || '', area: itemArea(task) });
    }
  }
  const marks = [];
  for (const d of Object.keys(store.data.days)) {
    for (const task of getTasks(d)) if (!task.done && task.due) marks.push({ key: `td|${task.id}`, due: task.due, title: task.text, what: '과제 마감' });
  }
  for (const p of activeProjects()) {
    marks.push(...sortedMs(p).filter(m => !m.done && m.due).map(m => ({ key: `m|${p.id}|${m.id}`, due: m.due, title: `${p.name} · ${m.title}`, what: '중간 지점' })));
    if (p.deadline) marks.push({ key: `d|${p.id}`, due: p.deadline, title: `${p.name}`, what: '공식 마감' });
  }
  {
    for (const mk of marks) {
      if (mk.due < from) continue;
      const reminders = [A.dayBefore.on && atTime(addDays(mk.due, -1), A.dayBefore.time), A.sameDay.on && atTime(mk.due, A.sameDay.time)].filter(Boolean);
      out.push({ kind: 'mark', key: mk.key, at: atTime(mk.due, A.sameDay.time), title: mk.title, what: mk.what, reminders });
    }
  }
  return out;
}

// 앱 안 알람이 울릴 시각들
function alarmTriggers() {
  const out = [];
  for (const it of alarmSchedule()) {
    if (it.kind === 'task') out.push({ id: `${it.key}|${it.at}`, at: it.at, title: it.title, body: it.body || '과제를 시작할 시간입니다.' });
    else for (const r of it.reminders) out.push({ id: `${it.key}|${r}`, at: r, title: `${r < it.at - 3600000 ? '내일' : '오늘'} ${it.what}`, body: it.title });
  }
  return out;
}

const FKEY = 'planner.fired.v1';
let fired = (() => { try { return JSON.parse(localStorage.getItem(FKEY)) || {}; } catch { return {}; } })();
let lastAlarmCheck = 0;
function checkAlarms() {
  const now = Date.now();
  if (store.status.phase !== 'ready' || now - lastAlarmCheck < 2000) return;
  lastAlarmCheck = now;
  syncWakeLock();
  const due = alarmTriggers().filter(a => a.at <= now && a.at > now - 10 * 60000 && !fired[a.id]);
  if (!due.length) return;
  for (const a of due) fired[a.id] = a.at;
  for (const [k, v] of Object.entries(fired)) if (v < now - 3 * 86400000) delete fired[k];
  try { localStorage.setItem(FKEY, JSON.stringify(fired)); } catch { /* 무시 */ }
  ui.alarms = [...ui.alarms, ...due];
  if (alarmSet().appSound) playMelody();
  try { navigator.vibrate?.([250, 120, 250]); } catch { /* 무시 */ }
  due.forEach((a, i) => notify(`⏰ ${a.title}`, a.body, `planner-alarm-${i}-${a.at}`));
  scheduleRender();
}
function stopMelody() {
  melody.forEach(o => { try { o.stop(); } catch { /* 이미 끝남 */ } });
  melody = [];
}

let wakeLock = null, wakeBusy = false;
async function syncWakeLock() {
  const want = alarmSet().wakeLock && (mtRunning() || atRunning()) && !document.hidden && 'wakeLock' in navigator;
  if (wakeBusy || want === !!wakeLock) return;
  wakeBusy = true;
  try {
    if (want) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    else { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; } finally { wakeBusy = false; }
}

/* 구글 캘린더 */
const gcal = new GCal({ clientId: CFG.googleClientId || '' });
const calMeta = () => store.data.meta.calendar || {};
// 상시 연결(Apps Script 다리): 주소가 저장돼 있으면 연결 확인을 마친 것. 이때는 구글 로그인 권한 없이 반영됨
const bridge = () => { const m = calMeta(); return m.bridgeUrl && m.bridgeSecret ? { url: m.bridgeUrl, secret: m.bridgeSecret } : null; };
const calConnected = () => !!calMeta().calendarId && (!!bridge() || gcal.available);
const calCanSend = () => !!bridge() || gcal.hasScope(CAL_SCOPE); // 지금 사용자 동작 없이 보낼 수 있는지
let calBusy = false, calAutoTimer = 0, calError = '';

// 반복 시간 중 '구글 캘린더에도 넣기'를 켠 것: 오늘부터 RT_CAL_DAYS일치(앱을 열 때마다 앞으로 밀려 채워짐)
const RT_CAL_DAYS = 14;
function routineCalEvents() {
  const out = [], t = todayStr();
  if (!routineOf(settings().routine).blocks.some(b => b.cal)) return out;
  for (let i = 0; i < RT_CAL_DAYS; i++) {
    const d = addDays(t, i);
    for (const b of dayRoutine(d)) {
      if (!b.cal) continue;
      const ai = isActivity(b) ? areaInfo(b.area) : null;
      out.push({
        id: hexId(`pl|rt|${d}|${b.id}`),
        summary: ai ? `${ai.emoji} ${blockName(b)}` : blockName(b),
        description: `Planerr: ${PLANNER_URL}`,
        start: { dateTime: isoLocal(atTime(d, b.start)), timeZone: TZ },
        end: { dateTime: isoLocal(atTime(d, b.end)), timeZone: TZ },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
        extendedProperties: { private: { planner: '1', kind: 'routine' } },
      });
    }
  }
  return out;
}
function calDesired() {
  return [...alarmSchedule().map(it => {
    const task = it.kind === 'task';
    const start = task && it.slot ? it.slot[0] : it.at;
    const end = task && it.slot ? Math.max(it.slot[1], start + 5 * 60000) : start + (task ? 15 : 30) * 60000;
    const minutes = task ? [Math.max(0, Math.round((start - it.at) / 60000))] : [...new Set(it.reminders.map(r => Math.max(0, Math.round((start - r) / 60000))))].slice(0, 5);
    return {
      id: hexId(`pl|${it.key}`),
      summary: task ? `${areaInfo(it.area).emoji} ${it.title}` : it.what === '공식 마감' ? `⚑ ${it.title} 공식 마감` : it.what === '과제 마감' ? `⚑ ${it.title} 마감` : `◆ ${it.title} (중간 지점)`,
      description: [task ? it.body : '', `Planerr: ${PLANNER_URL}`].filter(Boolean).join('\n\n'),
      start: { dateTime: isoLocal(start), timeZone: TZ },
      end: { dateTime: isoLocal(end), timeZone: TZ },
      reminders: { useDefault: false, overrides: minutes.map(m => ({ method: 'popup', minutes: m })) },
      extendedProperties: { private: { planner: '1', kind: it.kind } },
    };
  }), ...routineCalEvents()];
}

// 캘린더에 아직 반영되지 않은 앞으로의 변경 개수
function calPending() {
  if (!calConnected()) return 0;
  // synced: 'id|시작시각|서명' 문자열 목록(Firestore는 배열 안의 배열을 저장할 수 없음)
  const now = Date.now(), synced = new Map((calMeta().synced || []).map(s => String(s).split('|')).map(([id, st, sig]) => [id, [Number(st), sig]]));
  const want = calDesired();
  const ids = new Set(want.map(e => e.id));
  let n = 0;
  for (const e of want) {
    if (Date.parse(e.end.dateTime) < now) continue;
    if (synced.get(e.id)?.[1] !== eventSig(e)) n++;
  }
  for (const [id, [st]] of synced) if (st >= now && !ids.has(id)) n++;
  return n;
}

const calFrom = () => new Date(atTime(addDays(todayStr(), -1), '00:00'));
const calSyncedList = desired => desired.map(e => `${e.id}|${Date.parse(e.start.dateTime)}|${eventSig(e)}`);

async function calSyncBridge({ interactive = false } = {}) {
  if (calBusy) return;
  if (!navigator.onLine) { if (interactive) toast('오프라인이라 캘린더에 보낼 수 없습니다. 연결되면 자동으로 보냅니다.'); return; }
  calBusy = true;
  scheduleRender();
  try {
    const b = bridge(), desired = calDesired();
    const r = await bridgeCall(b.url, b.secret, 'sync', {
      desired, calendarId: calMeta().calendarId || null, name: BASE_TITLE, timeZone: TZ,
      from: calFrom().toISOString(), deviceId, activeTimerIds: [mt.calEventId, atm.calEventId].filter(Boolean),
    });
    store.set('meta', 'calendar', { calendarId: r.calendarId, synced: calSyncedList(desired), syncedAt: Date.now() });
    calError = '';
    if (mtRunning()) calTimerUpsert();
    if (atRunning()) calTimerUpsert(atm);
    if (interactive) toast(r.ops ? `캘린더에 ${r.ops}건 반영했습니다.` : '캘린더가 이미 최신 상태입니다.');
  } catch (e) {
    console.warn('캘린더 반영 실패(상시 연결)', e);
    calError = e.message;
    if (interactive || e.code === 'secret') toast(e.message);
  } finally {
    calBusy = false;
    scheduleRender();
  }
}

async function calSync({ interactive = false } = {}) {
  if (bridge()) return calSyncBridge({ interactive });
  if (calBusy || !gcal.available || (!interactive && !calConnected())) return;
  if (!navigator.onLine) { if (interactive) toast('오프라인이라 캘린더에 보낼 수 없습니다. 연결되면 다시 눌러 주세요.'); return; }
  if (!gcal.hasScope(CAL_SCOPE) && !interactive) return;
  calBusy = true;
  scheduleRender();
  try {
    if (!gcal.hasScope(CAL_SCOPE)) await gcal.authorize();
    let calId = calMeta().calendarId;
    const newCal = async () => { calId = await gcal.createCalendar(BASE_TITLE, TZ); store.set('meta', 'calendar', { calendarId: calId, synced: [] }); };
    if (!calId) await newCal();
    const desired = calDesired();
    const opts = { from: calFrom(), deviceId, activeTimerIds: [mt.calEventId, atm.calEventId].filter(Boolean) };
    let ops;
    try { ops = await syncCalendar(gcal, calId, desired, opts); }
    catch (e) {
      if (e.status !== 404) throw e;
      await newCal(); // 구글 캘린더에서 플래너 캘린더를 지운 경우 새로 만듦
      ops = await syncCalendar(gcal, calId, desired, opts);
    }
    store.set('meta', 'calendar', { calendarId: calId, synced: calSyncedList(desired), syncedAt: Date.now() });
    if (mtRunning()) calTimerUpsert();
    if (atRunning()) calTimerUpsert(atm);
    if (interactive) toast(ops ? `캘린더에 ${ops}건 반영했습니다.` : '캘린더가 이미 최신 상태입니다.');
  } catch (e) {
    console.warn('캘린더 반영 실패', e);
    if (e.status === 401) toast('캘린더 연결이 만료됐습니다. 📅 버튼을 다시 눌러 주세요.');
    else if (e.code === 'popup' || e.code === 'gis') toast(`${e.message} 다시 눌러 주세요.`);
    else if (e.code === 'access_denied' || e.code === 'scope') toast('캘린더 권한을 허용해야 연결됩니다.');
    else if (interactive) toast(`캘린더 반영 실패: ${e.message}`);
  } finally {
    calBusy = false;
    scheduleRender();
  }
}

function scheduleCalAuto() {
  clearTimeout(calAutoTimer);
  // 서버의 최신 내용을 받기 전에는 보내지 않음(예전 사본으로 캘린더를 고치지 않도록)
  calAutoTimer = setTimeout(() => {
    if (calConnected() && calCanSend() && navigator.onLine && store.isFresh('days', 'projects', 'meta') && calPending()) calSync();
  }, 2500);
}

// 타이머 종료 시각도 캘린더에(권한이 살아 있고 온라인일 때만, 기기별). S: 집중 타이머(mt) 또는 알람 타이머(atm)
function calTimerUpsert(S = mt) {
  const A = S === atm, run = A ? atRunning() : mtRunning();
  if (!calConnected() || !calCanSend() || !navigator.onLine || !run || !S.endTime) return;
  const fresh = !S.calEventId;
  if (fresh) { S.calEventId = hexId(`${A ? 'ta' : 'tm'}|${deviceId}|${Date.now()}`); (A ? atSave : mtSave)(); }
  const base = eventsPath(calMeta().calendarId), st = S.endTime;
  const ev = {
    id: S.calEventId, summary: A ? '⏰ 알람 타이머 종료' : '⏰ 집중 타이머 종료', description: `Planerr: ${PLANNER_URL}`,
    start: { dateTime: isoLocal(st), timeZone: TZ }, end: { dateTime: isoLocal(st + 5 * 60000), timeZone: TZ },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { planner: '1', kind: 'timer', device: deviceId } },
  };
  const b = bridge();
  if (b) {
    bridgeCall(b.url, b.secret, 'put', { event: ev, calendarId: calMeta().calendarId, name: BASE_TITLE, timeZone: TZ })
      .catch(e => console.warn('타이머 캘린더 알림 실패', e)).finally(() => scheduleRender());
    return;
  }
  (fresh ? insertEvent(gcal, base, ev) : gcal.api('PUT', `${base}/${ev.id}`, ev)
    .catch(e => (e.status === 404 ? insertEvent(gcal, base, ev) : Promise.reject(e))))
    .catch(e => console.warn('타이머 캘린더 알림 실패', e))
    .finally(() => scheduleRender());
}
function calTimerRemove(S = mt) {
  const id = S.calEventId;
  if (!id) return;
  S.calEventId = null;
  (S === atm ? atSave : mtSave)();
  if (!calConnected() || !calCanSend() || !navigator.onLine) return; // 못 지우면 다음 반영 때 정리됨
  const b = bridge();
  if (b) { bridgeCall(b.url, b.secret, 'del', { id, calendarId: calMeta().calendarId, name: BASE_TITLE, timeZone: TZ }).catch(() => {}); return; }
  gcal.api('DELETE', `${eventsPath(calMeta().calendarId)}/${id}`).catch(() => {});
}

/* ───────── 음악 라이브러리(플리 정보·기기 저장·드라이브) ───────── */
const musicMeta = () => store.data.meta.music || {};
const libTracks = () => musicMeta().tracks || [];
const libPlaylists = () => musicMeta().playlists || [];
const trackById = id => libTracks().find(t => t.id === id) || null;
const plById = id => (id ? libPlaylists().find(p => p.id === id) || null : null);
const saveMusic = patch => store.set('meta', 'music', patch);
const clonePls = () => libPlaylists().map(p => ({ ...p, items: [...(p.items || [])] }));
const fmtSize = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round((b || 0) / 1024))}KB`);
let cachedIds = new Set();
const objUrls = new Map();
async function trackUrl(id) {
  if (objUrls.has(id)) return objUrls.get(id);
  const blob = await cacheGet(id).catch(() => null);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  objUrls.set(id, u);
  return u;
}
const openPl = () => plById(ui.plOpen) || plById(musicMeta().studyPl) || libPlaylists()[0] || null;
// 화면의 재생 버튼이 다루는 재생기: 열어 둔 플리가 집중 플리면 공부용, 아니면 미리 듣기용
function uiPlayer() { const p = openPl(); return p && p.id === musicMeta().studyPl ? study : preview; }
function mpLocked() {
  if (uiPlayer() !== study || studyActive()) return false;
  toast('집중 플리는 타이머가 돌 때만 재생됩니다.');
  return true;
}

let refreshing = null, refreshAgain = false;
async function refreshPlayers() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = (async () => {
    const build = async pl => {
      const out = [];
      for (const id of pl?.items || []) {
        const t = trackById(id);
        if (!t || !cachedIds.has(id)) continue;
        const url = await trackUrl(id);
        if (url) out.push({ id, name: t.name, url });
      }
      return out;
    };
    const m = musicMeta(), sp = plById(m.studyPl), ap = plById(m.alarmPl), a2 = plById(m.alarm2Pl), op = openPl();
    study.setList(await build(sp), sp ? sp.repeat !== false : true);
    music.setList(await build(ap), ap ? ap.repeat !== false : false);
    alarm2.setList(await build(a2), a2 ? a2.repeat !== false : false);
    preview.setList(op && op.id !== m.studyPl ? await build(op) : [], op ? op.repeat !== false : false);
  })();
  try { await refreshing; } catch (e) { console.warn(e); } finally {
    refreshing = null;
    if (refreshAgain) { refreshAgain = false; refreshPlayers(); }
  }
}

// v1.7 이전에 이 기기에만 있던 알람 음악·집중 플리를 새 플리로 옮김(기기마다 한 번)
let migrating = false;
async function migrateLegacyMusic() {
  if (migrating) return;
  try { if (localStorage.getItem('planner.music.migrated.v1')) return; } catch { return; }
  migrating = true;
  try {
    const [alarmRows, studyRows] = await Promise.all([legacyTracks('tracks'), legacyTracks('study')]);
    if (alarmRows.length || studyRows.length) {
      const tracks = [...libTracks()], playlists = clonePls(), patch = {};
      for (const [rows, name, key, repeat] of [[alarmRows, '알람 음악', 'alarmPl', false], [studyRows, '공부 플레이리스트', 'studyPl', true]]) {
        if (!rows.length) continue;
        const pl = { id: uid(), name, items: [], repeat };
        for (const r of rows) {
          const id = uid();
          await cachePut(id, r.blob);
          cachedIds.add(id);
          tracks.push({ id, name: r.name, size: r.blob.size || 0, type: r.blob.type || 'audio/mpeg', driveId: null, origin: deviceId, addedAt: Date.now() });
          pl.items.push(id);
        }
        playlists.push(pl);
        if (!musicMeta()[key]) patch[key] = pl.id;
      }
      saveMusic({ tracks, playlists, ...patch });
      await legacyClear('tracks');
      await legacyClear('study');
      toast('이 기기에 있던 음악을 플레이리스트로 옮겼습니다.');
    }
    try { localStorage.setItem('planner.music.migrated.v1', '1'); } catch { /* 무시 */ }
  } catch (e) {
    console.warn('음악 옮기기 실패', e);
  } finally {
    migrating = false;
    refreshPlayers();
  }
}

async function addFilesToPl(plId, files) {
  const tracks = [...libTracks()], playlists = clonePls(), pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  let failed = 0;
  for (const f of files) {
    const id = uid();
    try { await cachePut(id, f); } catch { failed++; continue; }
    cachedIds.add(id);
    tracks.push({ id, name: f.name, size: f.size || 0, type: f.type || 'audio/mpeg', driveId: null, origin: deviceId, addedAt: Date.now() });
    pl.items.push(id);
  }
  saveMusic({ tracks, playlists });
  try { navigator.storage?.persist?.(); } catch { /* 무시 */ }
  if (failed) toast(`저장 공간이 부족해 ${failed}곡을 추가하지 못했습니다.`);
  refreshPlayers();
  scheduleDriveAuto();
}

function deleteTrack(id) {
  const t = trackById(id);
  if (!t) return;
  const pend = [...(musicMeta().pendingDeletes || [])];
  if (t.driveId) pend.push(t.driveId);
  saveMusic({ tracks: libTracks().filter(x => x.id !== id), playlists: clonePls().map(p => ({ ...p, items: p.items.filter(x => x !== id) })), pendingDeletes: pend });
  cacheDelete(id).catch(() => {});
  cachedIds.delete(id);
  if (objUrls.has(id)) { URL.revokeObjectURL(objUrls.get(id)); objUrls.delete(id); }
  refreshPlayers();
  scheduleDriveAuto();
}

// 이 기기에 받아 둘 곡: 공부·알람 플리, 그리고 '이 기기에 받기'를 누른 플리
const KEEP_KEY = 'planner.music.keep.v1';
const keepPls = () => { try { return JSON.parse(localStorage.getItem(KEEP_KEY)) || []; } catch { return []; } };
function wantedIds() {
  const m = musicMeta(), ids = new Set();
  for (const pid of [m.studyPl, m.alarmPl, m.alarm2Pl, ...keepPls()]) for (const id of plById(pid)?.items || []) ids.add(id);
  return [...ids];
}
function driveWork() {
  return {
    up: libTracks().filter(t => !t.driveId && t.origin === deviceId && cachedIds.has(t.id)),
    down: wantedIds().filter(id => !cachedIds.has(id) && trackById(id)?.driveId),
    del: musicMeta().pendingDeletes || [],
  };
}

let driveBusy = false, driveAutoTimer = 0;
async function driveSync({ interactive = false } = {}) {
  if (driveBusy || !gcal.available) return;
  if (!navigator.onLine) { if (interactive) toast('오프라인이라 드라이브와 주고받을 수 없습니다.'); return; }
  const w = driveWork();
  if (!w.up.length && !w.down.length && !w.del.length) { if (interactive) toast('주고받을 음악이 없습니다.'); return; }
  if (!gcal.hasScope(DRIVE_SCOPE) && !interactive) return;
  driveBusy = true;
  scheduleRender();
  try {
    if (!gcal.hasScope(DRIVE_SCOPE)) {
      await gcal.authorize();
      if (!gcal.hasScope(DRIVE_SCOPE)) { toast('드라이브 권한을 허용해야 기기 사이에 음악을 주고받을 수 있습니다.'); return; }
    }
    let n = 0;
    if (w.up.length) {
      const folderId = await ensureFolder(gcal, musicMeta().folderId, 'Planerr 음악');
      if (folderId !== musicMeta().folderId) saveMusic({ folderId });
      for (const t of w.up) {
        const blob = await cacheGet(t.id);
        if (!blob) continue;
        ui.musicProgress = `드라이브에 올리는 중: ${t.name}`;
        scheduleRender();
        const driveId = await uploadFile(gcal, folderId, blob, t.name, t.type);
        saveMusic({ tracks: libTracks().map(x => (x.id === t.id ? { ...x, driveId } : x)) });
        n++;
      }
    }
    for (const id of w.down) {
      const t = trackById(id);
      if (!t?.driveId) continue;
      ui.musicProgress = `이 기기로 받는 중: ${t.name}`;
      scheduleRender();
      const blob = await downloadFile(gcal, t.driveId);
      await cachePut(id, blob);
      cachedIds.add(id);
      n++;
    }
    if (w.del.length) {
      for (const d of w.del) await deleteFile(gcal, d);
      saveMusic({ pendingDeletes: (musicMeta().pendingDeletes || []).filter(x => !w.del.includes(x)) });
    }
    if (interactive) toast(n ? `음악 ${n}곡을 주고받았습니다.` : '드라이브와 맞췄습니다.');
  } catch (e) {
    console.warn('드라이브 동기화 실패', e);
    if (e.status === 401) toast('구글 연결이 만료됐습니다. 음악 카드의 드라이브 버튼을 다시 눌러 주세요.');
    else if (e.status === 403) toast('드라이브 권한이 없거나 Google Cloud에서 Drive API가 꺼져 있습니다.');
    else if (e.code === 'popup' || e.code === 'gis') toast(`${e.message} 다시 눌러 주세요.`);
    else if (e.code === 'access_denied' || e.code === 'scope') toast('드라이브 권한을 허용해야 음악을 주고받을 수 있습니다.');
    else toast(`드라이브 오류: ${e.message}`);
  } finally {
    driveBusy = false;
    ui.musicProgress = '';
    refreshPlayers();
    scheduleRender();
  }
}
function scheduleDriveAuto() {
  clearTimeout(driveAutoTimer);
  driveAutoTimer = setTimeout(() => {
    if (!gcal.hasScope(DRIVE_SCOPE) || !navigator.onLine) return;
    const w = driveWork();
    if (w.up.length || w.down.length || w.del.length) driveSync();
  }, 3000);
}

/* 미션 창(Document Picture-in-Picture, 크롬 계열 전용) — 오늘 과제 목록 + 작은 타이머 */
let pipWin = null;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
async function togglePip() {
  if (!('documentPictureInPicture' in window)) { toast('이 브라우저에서는 미션 창을 쓸 수 없습니다.'); return; }
  if (pipWin) { pipWin.close(); pipWin = null; scheduleRender(); return; }
  try {
    pipWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 420 });
  } catch {
    toast('미션 창을 열 수 없었습니다.');
    return;
  }
  pipWin.addEventListener('pagehide', () => { pipWin = null; scheduleRender(); });
  pipBuild();
  scheduleRender();
}
function pipBuild() {
  if (!pipWin) return;
  const d = pipWin.document;
  const c = {
    bg: cssVar('--bg'), s2: cssVar('--surface-2'), line: cssVar('--line'), accent: cssVar('--accent'), soft: cssVar('--accent-soft'),
    ink: cssVar('--accent-ink'), text: cssVar('--text'), muted: cssVar('--muted'), warm: cssVar('--warm'), danger: cssVar('--danger'), due: cssVar('--due'), late: cssVar('--late'),
  };
  const today = todayStr(), tasks = getTasks(today), top = tasks.find(t => !t.done), doneN = tasks.filter(t => t.done).length;
  const rem = mtRemain(), ratio = mt.totalMs > 0 ? rem / mt.totalMs : 0, run = mtRunning();
  const scroll = d.getElementById('plist')?.scrollTop || 0;
  d.title = '오늘의 미션';
  d.head.innerHTML = `<style>
    *{box-sizing:border-box} html,body{margin:0;height:100%}
    body{background:${c.bg};color:${c.text};font:13px/1.4 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;display:flex;flex-direction:column;user-select:none;overflow:hidden}
    header{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:10px 12px 7px;border-bottom:1px solid ${c.line}}
    .ttl{font-size:11px;font-weight:800;letter-spacing:.16em;color:${c.accent}}
    .cnt{font-size:12px;color:${c.muted};font-variant-numeric:tabular-nums}
    .list{flex:1;min-height:0;overflow-y:auto;padding:6px 8px 8px}
    ol{list-style:none;margin:0;padding:0}
    .q{width:100%;display:flex;align-items:flex-start;gap:8px;border:0;background:none;color:inherit;text-align:left;padding:5px 6px;border-radius:7px;cursor:pointer;font:inherit}
    .q:hover{background:${c.s2}}
    .q.top{background:${c.soft}}
    .box{flex:none;width:15px;height:15px;margin-top:2px;border:1.5px solid ${c.muted};border-radius:4px;display:grid;place-items:center;font-size:10px;font-weight:900;color:${c.ink}}
    .q.top .box{border-color:${c.accent}}
    .q.top .qt{font-weight:700}
    .q.done .box{background:${c.accent};border-color:${c.accent}}
    .q.done .qt{color:${c.muted};text-decoration:line-through}
    .qt{word-break:keep-all;overflow-wrap:anywhere}
    .al{font-size:11px;color:${c.warm};font-weight:700;white-space:nowrap}
    .ns{font-size:12px;color:${c.accent};font-weight:700;padding:0 6px 4px 29px}
    .du{font-size:11px;color:${c.muted};white-space:nowrap} .du.soon{color:${c.due};font-weight:700} .du.late{color:${c.late};font-weight:700}
    .empty{color:${c.muted};margin:0;padding:8px 6px}
    .proj{margin-top:6px;padding:6px 0 0;border-top:1px dashed ${c.line}}
    .pj{display:flex;gap:6px;align-items:flex-start;padding:3px 6px;font-size:12px;color:${c.muted}}
    .pj b{color:${c.text};font-weight:600}
    .pj .mk{color:${c.due};flex:none}
    .pj .dd{margin-left:auto;padding-left:6px;white-space:nowrap;color:${c.due};font-weight:700}
    .pj.late .dd{color:${c.late}}
    .tm{border-top:1px solid ${c.line};padding:8px 10px 10px}
    .bar{height:4px;background:${c.s2};border-radius:9px;overflow:hidden;margin-bottom:8px}
    .bar i{display:block;height:100%;background:${c.accent};transition:width .3s linear}
    .bar.done i{background:${c.danger}}
    .trow{display:flex;align-items:center;gap:8px}
    .tnum{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
    .compact .tnum{font-size:16px}
    .tlabel{font-size:11px;color:${c.muted};letter-spacing:.08em}
    .tbtns{margin-left:auto;display:flex;align-items:center;gap:6px}
    .rb{width:32px;height:32px;border-radius:50%;border:1px solid ${c.line};background:${c.s2};color:${c.text};display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;font:700 11px system-ui,sans-serif}
    .rb.main{width:38px;height:38px;background:${c.accent};border-color:${c.accent};color:${c.ink}}
    .rb svg{width:16px;height:16px;flex:none}
    .alarm b{color:${c.danger}}
    .pills{display:flex;gap:6px;margin-top:8px}
    .pill{flex:1;border:1px solid ${c.line};background:${c.s2};color:${c.text};border-radius:9px;padding:7px 6px;cursor:pointer;font:700 12px -apple-system,"Noto Sans KR",system-ui,sans-serif}
    .pill.main{background:${c.accent};border-color:${c.accent};color:${c.ink}}
    .hr{display:flex;align-items:center;gap:8px}
    .pinb{border:1px solid ${c.line};background:${c.s2};color:${c.text};border-radius:99px;padding:2px 8px;font:700 11px -apple-system,"Noto Sans KR",system-ui,sans-serif;cursor:pointer;font-variant-numeric:tabular-nums}
    .pinb.on{background:${c.accent};border-color:${c.accent};color:${c.ink}}
    .pbar{height:3px;background:${c.s2}} .pbar i{display:block;height:100%;background:${c.accent};transition:width .25s linear}
    .ph{font-size:11px;color:${c.muted};padding:2px 6px 6px}
  </style>`;

  const rows = tasks.map(t => {
    const st = stepsOf(t), next = st.find(x => !x.done);
    return `<li><button class="q ${t.done ? 'done' : ''} ${t === top ? 'top' : ''}" data-id="${t.id}" title="${t.done ? '완료 취소' : '완료로 표시'}"><span class="box">${t.done ? '✓' : ''}</span><span class="qt">${esc(t.text)}${t.due && !t.done ? ` <span class="du ${dueCls(t)}">${dueText(t)}</span>` : ''}${t.start && !t.done ? ` <span class="al">🕒${esc(t.start)}</span>` : ''}${t.alarm && !t.done ? ` <span class="al">⏰${esc(t.alarm)}</span>` : ''}${st.length && !t.done ? ` <span class="du">${st.filter(x => x.done).length}/${st.length}</span>` : ''}</span></button></li>`
      + (t === top && next ? `<li class="ns">▸ 다음 단계: ${esc(next.text)}</li>` : '');
  }).join('');
  const proj = activeProjects()
    .map(p => ({ p, next: sortedMs(p).find(m => !m.done) }))
    .filter(x => x.next || x.p.deadline)
    .sort((a, b) => (a.next?.due || a.p.deadline).localeCompare(b.next?.due || b.p.deadline))
    .map(({ p, next }) => next
      ? `<div class="pj ${next.due < today ? 'late' : ''}"><span class="mk">◆</span><span><b>${esc(p.name)}</b> · ${esc(next.title)} (${fmtMD(next.due)})</span><span class="dd">${next.due < today ? '지남' : dday(next.due)}</span></div>`
      : `<div class="pj"><span class="mk">◆</span><span><b>${esc(p.name)}</b> · 모든 단계 완료</span><span class="dd">마감 ${dday(p.deadline)}</span></div>`)
    .join('');

  let timerHtml;
  if (mt.alarm) {
    const min = Math.round(mtSession() / 60000);
    timerHtml = `<div class="tm alarm"><div class="trow"><b>⏰ 집중 타이머 종료</b>${min >= 1 ? `<span class="tlabel">${min}분 집중</span>` : ''}</div>
      <div class="pills">${min >= 1 ? '<button class="pill main" id="pRec">기록하고 닫기</button><button class="pill" id="pNo">기록 없이</button>' : '<button class="pill main" id="pNo">확인</button>'}</div></div>`;
  } else if (mt.status === 'ready') {
    timerHtml = `<div class="tm compact trow"><span class="tlabel">집중</span><span class="tnum" id="pt">${fmtClock(rem)}</span><span class="tbtns"><button class="rb main" id="pMain" title="시작">${ICON_PLAY}</button></span></div>`;
  } else {
    timerHtml = `<div class="tm"><div class="bar ${mt.status === 'done' ? 'done' : ''}"><i id="pbar" style="width:${(ratio * 100).toFixed(2)}%"></i></div>
      <div class="trow"><span class="tnum" id="pt">${fmtClock(rem)}</span><span class="tlabel" id="ps">${MT_LABEL[mt.status]}</span>
        <span class="tbtns"><button class="rb" id="pReset" title="리셋">${ICON_RESET}</button><button class="rb main" id="pMain" title="${run ? '일시정지' : '시작'}">${run ? ICON_PAUSE : ICON_PLAY}</button><button class="rb" id="pAdd" title="1분 추가">+1m</button></span></div></div>`;
  }

  // 알람 타이머는 돌고 있거나 멈춰 있을 때·끝났을 때만 한 줄로
  let atHtml = '';
  if (atm.alarm) atHtml = `<div class="tm alarm compact trow"><b>⏰ 알람 타이머 종료</b><span class="tbtns"><button class="pill main" id="paOk">확인</button></span></div>`;
  else if (atm.status === 'running' || atm.status === 'paused') atHtml = `<div class="tm compact trow"><span class="tlabel">알람</span><span class="tnum" id="pat">${fmtClock(atRemain())}</span><span class="tbtns"><button class="rb" id="paMain" title="${atRunning() ? '일시정지' : '시작'}">${atRunning() ? ICON_PAUSE : ICON_PLAY}</button></span></div>`;

  // 상시 과제칸: 머리글의 📌를 누르면 잠깐 과제 목록 대신 보여 주고, 시간이 지나면 과제 목록으로 돌아감
  const pins = getPins(), pinsOn = !!pipPinUntil && pins.length;
  const pinRows = pins.map(p => `<li><button class="q pq ${pinChecked(p) ? 'done' : ''}" data-pin="${p.id}" title="${pinChecked(p) ? '체크 취소' : '오늘 확인'}"><span class="box">${pinChecked(p) ? '✓' : ''}</span><span class="qt">${esc(p.text)}</span></button></li>`).join('');
  const pinBtn = pins.length ? `<button class="pinb ${pinsOn ? 'on' : ''}" id="pPin" title="${pinsOn ? '과제 목록으로' : '상시 과제 보기'}">📌 ${pins.filter(pinChecked).length}/${pins.length}</button>` : '';
  d.body.innerHTML = `<header><span class="ttl">${pinsOn ? '상시 과제' : '오늘의 미션'}</span><span class="hr">${pinsOn ? '' : `<span class="cnt">${tasks.length ? `${doneN}/${tasks.length} 완료` : fmtMDW(today)}</span>`}${pinBtn}</span></header>
    ${pinsOn ? `<div class="pbar"><i id="ppbar" style="width:${Math.max(0, (pipPinUntil - Date.now()) / PIN_SHOW_MS * 100).toFixed(1)}%"></i></div>` : ''}
    <div class="list" id="plist">${pinsOn ? `<ol>${pinRows}</ol><p class="ph">체크는 오늘 하루만 · 잠시 뒤 과제 목록으로 돌아갑니다</p>` : `${tasks.length ? `<ol>${rows}</ol>` : '<p class="empty">오늘 과제가 없습니다. 플래너에서 추가하면 여기에 표시됩니다.</p>'}${proj ? `<div class="proj">${proj}</div>` : ''}`}</div>
    ${atHtml}${timerHtml}`;
  if (!pinsOn) d.getElementById('plist').scrollTop = scroll;
  d.querySelectorAll('.pq').forEach(b => {
    b.onclick = () => {
      setPins(getPins().map(p => (p.id === b.dataset.pin ? { ...p, doneOn: pinChecked(p) ? '' : todayStr() } : p)));
      pipPinUntil = Date.now() + PIN_SHOW_MS;
      pipRefresh();
    };
  });
  d.querySelectorAll('.q:not(.pq)').forEach(b => {
    b.onclick = () => {
      const t = getTasks(todayStr()).find(x => x.id === b.dataset.id);
      if (t) updateTask(todayStr(), t.id, { done: !t.done });
    };
  });
  const on = (id, fn) => { const el = d.getElementById(id); if (el) el.onclick = fn; };
  on('pMain', () => mtToggle());
  on('pReset', () => mtReset());
  on('pAdd', () => mtAdd(60));
  on('pRec', () => mtDismiss(true));
  on('pNo', () => mtDismiss(false));
  on('paMain', () => atToggle());
  on('paOk', () => atDismiss());
  on('pPin', () => { pipPinUntil = pipPinUntil ? 0 : Date.now() + PIN_SHOW_MS; pipRefresh(); });
}
const pipRefresh = () => { if (pipWin) pipBuild(); };
function pipUpdate(txt, ratio) {
  if (!pipWin) return;
  const d = pipWin.document;
  const pt = d.getElementById('pt');
  if (pt) pt.textContent = txt;
  const pb = d.getElementById('pbar');
  if (pb) pb.style.width = `${(ratio * 100).toFixed(2)}%`;
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
const themeFrom = (p, mode) => ({ mode, ...Object.fromEntries(COLOR_KEYS.map(k => [k, { ...p[k] }])) });
function currentTheme() {
  const th = ui.themeDraft || settings().theme;
  if (th && th.mode === 'custom' && th.bg) return fillTheme(th);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return themeFrom(PRESETS.find(x => x.id === (dark ? 'forest-dark' : 'forest')), 'auto');
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
  curriculum: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18.5V5a2 2 0 0 1 2-2h12v14H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12v-4"/><path d="M9 7.5h6M9 11h4"/></svg>',
  stats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M7 16.5v-5M12 16.5V6.5M17 16.5v-8"/></svg>',
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
  if (mtRunning() && ui.view !== 'timer') html += `<button class="timer-mini alt" data-action="timer-goto" data-t="study" aria-label="집중 타이머로 이동"><span id="mt-mini-text">${fmtClock(mtRemain())}</span></button>`;
  if (atRunning() && ui.view !== 'timer') html += `<button class="timer-mini alt2" data-action="timer-goto" data-t="alarm" aria-label="알람 타이머로 이동"><span aria-hidden="true">⏰</span><span id="at-mini-text">${fmtClock(atRemain())}</span></button>`;
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
  if (e.kind === 'tdue') {
    const late = !e.done && e.date < t;
    return `<li class="ev tdue ${e.done ? 'done' : ''} ${late ? 'late' : ''}">
    <span class="ev-check"><input type="checkbox" data-change="tdone" data-date="${e.tdate}" data-id="${e.tid}" ${e.done ? 'checked' : ''} aria-label="${esc(e.title)} 완료"></span>
    <span class="ev-main">${esc(e.title)}<small>과제 마감${e.tdate !== t ? ` · ${fmtMD(e.tdate)} 목록에 있음` : ''}</small></span>
    <span class="ev-date">${fmtMD(e.date)} · ${late ? '지남' : dday(e.date)}</span>
  </li>`;
  }
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
      html += `<option value="${p.id}::${m.id}" ${r.milestoneId === m.id ? 'selected' : ''}>${esc(m.title)}${m.due ? ` · ${fmtMD(m.due)}` : ''}</option>`;
    }
    html += `</optgroup>`;
  }
  return html;
}

/* ───────── 하루 과제 목록 (목록 순서 = 우선순위, 저장 형식은 tasks.js) ───────── */
const getTasks = s => tasksOf(dayRec(s));
const topTask = s => getTasks(s).find(t => !t.done && focusOk(t)) || null;
function setTasks(s, list) {
  const p = taskPatch(dayRec(s), list);
  if (p) store.patch('days', s, p);
}
const updateTask = (s, id, patch) => {
  const before = getTasks(s).find(t => t.id === id);
  setTasks(s, getTasks(s).map(t => (t.id === id ? { ...t, ...patch } : t)));
  if (before?.les && 'done' in patch && !!patch.done !== !!before.done) lessonByTask(s, before, !!patch.done);
};
const carryTarget = s => (s < todayStr() ? todayStr() : addDays(s, 1));
const carryLabel = s => (s < todayStr() ? '오늘로 가져오기' : s === todayStr() ? '내일로 넘기기' : '다음 날로 넘기기');

// 지난날 못 끝낸 과제를 오늘 목록 맨 아래로 자동으로 옮김(하루에 한 번, 기기 간 공유되는 표시로 중복 실행 방지)
// 처음 실행할 때는 어제만, 그 뒤로는 마지막 실행일부터 어제까지(최대 14일) 확인
function autoCarry() {
  if (store.status.phase !== 'ready' || settings().autoCarry === false) return;
  // 기기에 저장해 둔 사본만 보고 옮기면 다른 기기에서 고친 내용을 예전 것으로 덮을 수 있어서,
  // 서버의 최신 내용을 받은 뒤에만 옮김(오프라인이면 연결될 때까지 미룸)
  if (!store.isFresh('days', 'meta')) return;
  const t = todayStr(), last = store.data.meta.rollover?.last;
  if (last && last >= t) return;
  store.set('meta', 'rollover', { last: t }); // 먼저 표시해 두어 다시 들어오지 않게 함
  const floor = addDays(t, -14);
  const startD = last ? (last > floor ? last : floor) : addDays(t, -1);
  const days = Object.keys(store.data.days).filter(d => d >= startD && d < t && getTasks(d).some(x => !x.done)).sort();
  if (!days.length) return;
  const moved = [];
  for (const d of days) {
    const src = getTasks(d);
    moved.push(...src.filter(x => !x.done).map(x => ({ ...x, from: x.from || d, start: '', end: '' })));
    setTasks(d, src.filter(x => x.done));
  }
  // 이미 오늘 목록에 같은 과제가 있으면(다른 기기가 먼저 옮김) 다시 넣지 않음
  const dest = getTasks(t), ids = new Set(dest.map(x => x.id)), add = moved.filter(x => !ids.has(x.id));
  setTasks(t, [...dest, ...add]);
  if (add.length) toast(`못 끝낸 과제 ${add.length}개를 오늘로 옮겼습니다.`);
}

function carryTasks(date, ids) {
  if (!ids.length) return;
  const target = carryTarget(date), src = getTasks(date), dest = getTasks(target);
  const destIds = new Set(dest.map(t => t.id));
  const moved = src.filter(t => ids.includes(t.id)).map(t => ({ ...t, id: destIds.has(t.id) ? uid() : t.id, from: t.from || date, start: '', end: '' }));
  setTasks(target, [...dest, ...moved]);
  setTasks(date, src.filter(t => !ids.includes(t.id)));
  ui.editTask = null;
  toast(`${moved.length}개 과제를 ${target === todayStr() ? '오늘' : fmtMD(target)}로 옮겼습니다.`);
}

// 과제 마감일 표시(마감일이 없으면 아무것도 표시하지 않음)
function dueText(t) {
  if (!t.due) return '';
  const n = diffDays(todayStr(), t.due);
  if (t.done) return `${fmtMD(t.due)} 마감`;
  return n < 0 ? `마감 ${-n}일 지남` : n === 0 ? '오늘 마감' : n === 1 ? '내일 마감' : `${fmtMD(t.due)} 마감 · D-${n}`;
}
const dueCls = t => { if (!t.due || t.done) return ''; const n = diffDays(todayStr(), t.due); return n < 0 ? 'late' : n <= 1 ? 'soon' : ''; };
const dueTag = t => (t.due ? `<small class="due-tag ${dueCls(t)}">${dueText(t)}</small>` : '');

// 그날 과제 전체를 우선순위 순서대로(완료한 과제는 줄 그어서)
function miniTasks(d) {
  const all = getTasks(d), list = all.filter(inFilter);
  if (!list.length) return '<span class="muted">—</span>';
  return `<span class="mini-tasks">${list.map(t => `<span class="mini-item ${t.done ? 'done' : ''}"><span class="rk">${all.indexOf(t) + 1}</span><i class="adot" style="--ac:${areaInfo(itemArea(t)).color}" title="${esc(areaInfo(itemArea(t)).full)}"></i><span class="mini-text">${esc(t.text)}${t.due && !t.done ? ` <small class="due-tag ${dueCls(t)}">~${fmtMD(t.due)}</small>` : ''}</span></span>`).join('')}</span>`;
}

function monthTaskList(first, last) {
  const days = Object.keys(store.data.days).filter(k => k >= first && k <= last && getTasks(k).some(inFilter)).sort();
  if (!days.length) return '';
  return `<article class="card month-list">
    <div class="card-head"><h2>이 달의 과제</h2></div>
    ${days.map(d => `<div class="ml-day"><button class="ml-date ${d === todayStr() ? 'today' : ''}" data-action="goto-day" data-date="${d}">${fmtMDW(d)}</button>${miniTasks(d)}</div>`).join('')}
  </article>`;
}

function taskBlock(date) {
  // 영역으로 걸러 보는 중이면 그 영역 과제만 보이고, 순위 번호는 전체 목록 기준. 순서 바꾸기는 '전체'에서만
  const all = getTasks(date), f = areaFilter(), tasks = f ? all.filter(inFilter) : all, projects = activeProjects();
  const top = f ? tasks.find(t => !t.done) : tasks.find(t => !t.done && focusOk(t));
  const undone = all.filter(t => !t.done).length, hidden = all.length - tasks.length;
  const field = (t, f, label, ph) => `<label class="field"><span>${label}</span><input data-tfield="${f}" data-date="${date}" data-id="${t.id}" data-key="t|${date}|${t.id}|${f}" value="${esc(t[f] || '')}" placeholder="${ph}" maxlength="120" autocomplete="off"></label>`;
  // 메모는 모든 과제에, 시작 시점은 맨 위 과제(지금 할 과제)에만
  const details = (t, isTop) => `<div class="fields task-fields">
      ${field(t, 'text', '과제', '과제 이름')}
      <label class="field"><span>뭘 할지</span><textarea rows="2" data-tfield="memo" data-date="${date}" data-id="${t.id}" data-key="t|${date}|${t.id}|memo" maxlength="500" placeholder="예: 문제집 42쪽부터 3문제 풀기">${esc(t.memo || '')}</textarea></label>
      ${stepsField(date, t)}
      ${isTop ? field(t, 'cue', '시작 시점 (선택)', '예: 점심 먹고 책상에 앉으면') : ''}
      ${slotField(date, t)}
      <label class="field half"><span>마감일 (선택)</span><span class="time-row"><input type="date" data-tfield="due" data-date="${date}" data-id="${t.id}" data-key="t|${date}|${t.id}|due" value="${esc(t.due || '')}">${t.due ? `<button type="button" class="link-btn" data-action="t-due-clear" data-date="${date}" data-id="${t.id}">지우기</button>` : ''}</span></label>
      <label class="field half"><span>알림 시각 (선택)</span><span class="time-row"><input type="time" data-tfield="alarm" data-date="${date}" data-id="${t.id}" data-key="t|${date}|${t.id}|alarm" value="${esc(t.alarm || '')}">${t.alarm ? `<button type="button" class="link-btn" data-action="t-alarm-clear" data-date="${date}" data-id="${t.id}">지우기</button>` : ''}</span></label>
      <label class="field half"><span>영역</span><select data-change="tarea" data-date="${date}" data-id="${t.id}" data-key="ta|${date}|${t.id}">${areaOptions(itemArea(t))}</select></label>
      ${projects.length ? `<label class="field half"><span>프로젝트</span><select data-change="tlink" data-date="${date}" data-id="${t.id}" data-key="tl|${date}|${t.id}">${linkOptions(t, projects)}</select></label>` : ''}
    </div>
    ${isTop && t.cue ? `<p class="plan-line"><span>${esc(t.cue)}</span><i>→</i><span>${esc(t.text)}</span></p>` : ''}`;
  const focus = top
    ? `<div class="now-task">
        <div class="now-head"><span class="now-label">${date === todayStr() ? '지금 할 과제' : '먼저 할 과제'} · ${all.indexOf(top) + 1}순위</span><label class="check"><input type="checkbox" data-change="tdone" data-date="${date}" data-id="${top.id}" aria-label="지금 할 과제 완료"><span>완료</span></label></div>
        ${stuckBox(date, top)}
        ${stepsOf(top).length && stepsOf(top).every(x => x.done) ? `<div class="steps-done"><span>모든 단계를 끝냈습니다.</span><button type="button" class="btn sm primary" data-action="step-done-task" data-date="${date}" data-id="${top.id}">과제 완료</button></div>` : ''}
        ${details(top, true)}
      </div>`
    : tasks.some(t => !t.done) ? `<p class="muted small">남은 과제는 '지금 할 과제'로 올리지 않는 영역에 있습니다(설정 → 영역).</p>`
    : tasks.length ? `<p class="all-done">✓ ${f ? '이 영역의 ' : ''}모든 과제를 끝냈습니다</p>` : '';
  const rows = tasks.map(t => {
    const i = all.indexOf(t), editing = ui.editTask === `${date}|${t.id}`, isTop = t === top;
    return `<li class="task-row ${t.done ? 'done' : ''} ${isTop ? 'is-top' : ''}" data-sort-id="${t.id}">
      <div class="tr-main">
        ${f ? '' : `<button class="drag-handle" type="button" aria-label="끌어서 순서 바꾸기">${GRIP}</button>`}
        <span class="rank">${i + 1}</span>
        <input type="checkbox" data-change="tdone" data-date="${date}" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="${esc(t.text)} 완료">
        <span class="tr-text">${esc(t.text)}${rowTags(date, t, isTop, editing)}</span>
        <span class="tr-btns">
          ${f ? '' : `<button class="icon-btn sm" data-action="t-move" data-date="${date}" data-id="${t.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="우선순위 올리기">↑</button>
          <button class="icon-btn sm" data-action="t-move" data-date="${date}" data-id="${t.id}" data-dir="1" ${i === all.length - 1 ? 'disabled' : ''} aria-label="우선순위 내리기">↓</button>`}
          <button class="icon-btn sm ${editing ? 'on' : ''}" data-action="t-edit" data-date="${date}" data-id="${t.id}" aria-label="자세히" aria-expanded="${editing}">⋯</button>
        </span>
      </div>
      ${editing ? `<div class="tr-edit">
        ${isTop ? '' : stuckBox(date, t) + details(t, false)}
        <div class="btn-row wrap">
          ${t.done ? '' : `<button class="btn sm" data-action="t-carry" data-date="${date}" data-id="${t.id}">${carryLabel(date)}</button>`}
          <button class="btn sm danger" data-action="t-del" data-date="${date}" data-id="${t.id}">삭제</button>
          <button class="btn sm" data-action="t-edit" data-date="${date}" data-id="${t.id}">닫기</button>
        </div>
      </div>` : ''}
    </li>`;
  }).join('');
  return `${focus}
    ${tasks.length ? `<div class="task-list-head"><span>우선순위${f && hidden ? ` <small class="muted">· 다른 영역 ${hidden}개 숨김, 순서는 '전체'에서</small>` : ''}</span>${undone ? `<button class="link-btn" data-action="t-carry-all" data-date="${date}">남은 ${undone}개 ${carryLabel(date)}</button>` : ''}</div>
    <ol class="task-list" ${f ? '' : 'data-sortable="tasks"'} data-date="${date}">${rows}</ol>` : f && hidden ? `<p class="muted small">이 영역 과제가 없습니다. 다른 영역 과제 ${hidden}개는 '전체'에서 보입니다.</p>` : ''}
    <div class="add-row">
      <input id="t-new-${date}" data-enter="t-add" data-date="${date}" placeholder="${all.length ? '과제 추가 (맨 아래 순위로)' : '예: 보고서 서론 쓰기'}" maxlength="120" autocomplete="off" aria-label="과제 추가">
      <select id="t-new-area-${date}" class="area-in" aria-label="영역">${areaOptions(defaultArea())}</select>
      <input type="date" id="t-new-due-${date}" class="due-in" aria-label="마감일 (선택)" title="마감일 (선택)">
      <button class="btn primary" data-action="t-add" data-date="${date}">추가</button>
    </div>
    ${all.length ? '' : `<p class="muted small">우선순위 순서대로 추가하세요. 맨 위의 끝나지 않은 과제가 '지금 할 과제'가 됩니다.</p>`}`;
}

/* ───────── 상시 과제칸 ─────────
   날짜·마감과 상관없이 늘 명심할 것. 저장: meta/pins.items = { id: { text, o(순서), doneOn(체크한 날) } }
   체크는 그날만 유효해서 다음 날이면 저절로 빈칸이 됨. 과제처럼 항목별로 저장해 기기끼리 덮어쓰지 않음.
   오늘 화면과 미션 창에서는 누르면 잠깐 과제 목록 대신 보여 주고, 손대지 않은 채 시간이 지나면 과제 목록으로 돌아감 */
const PIN_SHOW_MS = 15000;
const getPins = () => listOfMap(store.data.meta.pins?.items);
function setPins(list) {
  const tm = mapPatch(store.data.meta.pins?.items, list);
  if (tm) store.patch('meta', 'pins', { items: tm });
}
const pinChecked = p => p.doneOn === todayStr();
const pinCount = () => { const ps = getPins(); return { n: ps.length, done: ps.filter(pinChecked).length }; };
let pipPinUntil = 0; // 미션 창에서 상시 과제를 보여 주는 중이면 끝나는 시각

function pinShow() { ui.pinView = { until: Date.now() + PIN_SHOW_MS }; render(); }
function pinHide() { ui.pinView = null; render(); }
// 상시 과제를 만지는 동안에는 돌아가는 시간을 다시 채움
const pinTouch = () => { if (ui.pinView) ui.pinView.until = Date.now() + PIN_SHOW_MS; };
// 적다 만 내용이 있으면 돌아가지 않음(돌아가면 입력하던 글이 사라지므로)
function pinDirty() {
  if (document.getElementById('pin-new')?.value.trim()) return true;
  const a = document.activeElement;
  return !!(a?.classList?.contains('pin-in') && a.value !== (getPins().find(p => p.id === a.dataset.id)?.text ?? a.value));
}
function pinTick() {
  const now = Date.now();
  if (ui.pinView) {
    if (drag || pinDirty()) pinTouch();
    if (ui.pinView.until <= now) { ui.pinView = null; scheduleRender(); }
    else {
      const b = document.getElementById('pin-bar');
      if (b) b.style.width = `${Math.max(0, (ui.pinView.until - now) / PIN_SHOW_MS * 100).toFixed(1)}%`;
    }
  }
  if (pipPinUntil) {
    if (pipPinUntil <= now) { pipPinUntil = 0; pipRefresh(); }
    else {
      const b = pipWin?.document.getElementById('ppbar');
      if (b) b.style.width = `${Math.max(0, (pipPinUntil - now) / PIN_SHOW_MS * 100).toFixed(1)}%`;
    }
  }
}

function pinChip() {
  const { n, done } = pinCount();
  return `<button class="chip-btn pin-chip ${ui.pinView ? 'on' : ''}" data-action="pin-toggle" aria-pressed="${!!ui.pinView}" title="상시 과제칸">📌 상시${n ? ` <span class="pin-cnt">${done}/${n}</span>` : ''}</button>`;
}

function pinPanel() {
  const ps = getPins(), left = ui.pinView ? Math.max(0, (ui.pinView.until - Date.now()) / PIN_SHOW_MS * 100) : 0;
  const rows = ps.map(p => `<li class="pin-row ${pinChecked(p) ? 'done' : ''}" data-sort-id="${p.id}">
      <button class="drag-handle" type="button" aria-label="끌어서 순서 바꾸기">${GRIP}</button>
      <input type="checkbox" data-change="pin-check" data-id="${p.id}" ${pinChecked(p) ? 'checked' : ''} aria-label="오늘 확인">
      <input class="pin-in" data-change="pin-text" data-id="${p.id}" data-key="pin|${p.id}" value="${esc(p.text)}" maxlength="120" autocomplete="off" aria-label="상시 과제 내용">
      <button class="icon-btn sm" data-action="pin-del" data-id="${p.id}" aria-label="삭제">×</button>
    </li>`).join('');
  return `<div class="pins">
    <div class="pins-head"><b>📌 상시 과제</b><span class="muted small">체크는 오늘 하루만 · 내일이면 다시 빈칸</span></div>
    <div class="pin-timer" aria-hidden="true"><i id="pin-bar" style="width:${left.toFixed(1)}%"></i></div>
    ${ps.length ? `<ol class="pin-list" data-sortable="pins">${rows}</ol>` : '<p class="muted small">마감과 상관없이 늘 명심하거나 떠올려야 할 것을 적어 두세요. 예: 폰은 가방에 넣고 시작하기</p>'}
    <div class="add-row">
      <input id="pin-new" data-enter="pin-add" placeholder="늘 명심할 것 추가" maxlength="120" autocomplete="off" aria-label="상시 과제 추가">
      <button class="btn primary" data-action="pin-add">추가</button>
    </div>
    <div class="btn-row"><button class="btn sm" data-action="pin-toggle">과제 목록으로</button><span class="muted small">손대지 않으면 ${PIN_SHOW_MS / 1000}초 뒤 과제 목록으로 돌아갑니다</span></div>
  </div>`;
}

/* ───────── 과제 세분화·넘어온 과제·할 시간 ───────── */
const stepsOf = t => (Array.isArray(t.steps) ? t.steps : []);
function updateSteps(date, id, fn) {
  const t = getTasks(date).find(x => x.id === id);
  if (t) updateTask(date, id, { steps: fn([...stepsOf(t)]) });
}
const nthDay = (t, date) => (t.from ? diffDays(t.from, date) + 1 : 1);
const fmtDur = min => (min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`);

function stepsField(date, t) {
  const st = stepsOf(t), dn = st.filter(x => x.done).length;
  return `<div class="field"><span>단계${st.length ? ` · ${dn}/${st.length}` : ' (선택) — 작게 쪼갤수록 시작하기 쉬워집니다'}</span>
    ${st.length ? `<ul class="steps">${st.map(x => `<li class="step ${x.done ? 'done' : ''}">
      <label class="check"><input type="checkbox" data-change="step-toggle" data-date="${date}" data-id="${t.id}" data-sid="${x.id}" ${x.done ? 'checked' : ''}><span>${esc(x.text)}</span></label>
      <button type="button" class="icon-btn sm" data-action="step-del" data-date="${date}" data-id="${t.id}" data-sid="${x.id}" aria-label="단계 삭제">×</button></li>`).join('')}</ul>` : ''}
    <div class="add-row tight"><input id="st-new-${date}-${t.id}" data-enter="step-add" data-date="${date}" data-id="${t.id}" placeholder="${st.length ? '단계 추가' : '예: 자료 3개 찾기'}" maxlength="100" autocomplete="off" aria-label="단계 추가"><button type="button" class="btn sm" data-action="step-add" data-date="${date}" data-id="${t.id}">추가</button></div>
  </div>`;
}

function slotField(date, t) {
  const a = f => `data-tfield="${f}" data-date="${date}" data-id="${t.id}" data-key="t|${date}|${t.id}|${f}"`;
  return `<div class="field half"><span>할 시간 (선택) — 시간표에 표시되고 시작 시각에 알림</span>
    <span class="time-row"><input type="time" ${a('start')} value="${esc(t.start || '')}" aria-label="시작 시각"><span>~</span><input type="time" ${a('end')} value="${esc(t.end || '')}" aria-label="끝 시각">${t.start ? `<button type="button" class="link-btn" data-action="t-slot-clear" data-date="${date}" data-id="${t.id}">지우기</button>` : ''}</span>
  </div>`;
}

function stuckBox(date, t) {
  const n = nthDay(t, date);
  if (t.done || n < 4) return '';
  return `<div class="stuck">
    <b>${n}일째 넘어오고 있습니다.</b>
    <span>막막하거나 지루한 과제일 수 있습니다. 첫 단계를 아주 작게 쪼개거나, 마감·시간을 다시 정하거나, 필요 없다면 버려도 됩니다.</span>
    <div class="btn-row wrap tight">
      <button type="button" class="btn sm" data-action="stuck-split" data-date="${date}" data-id="${t.id}">단계로 쪼개기</button>
      <button type="button" class="btn sm" data-action="stuck-replan" data-date="${date}" data-id="${t.id}">다시 정하기</button>
      <button type="button" class="btn sm danger" data-action="t-del" data-date="${date}" data-id="${t.id}">버리기</button>
    </div>
  </div>`;
}

function rowTags(date, t, isTop, editing) {
  const st = stepsOf(t), dn = st.filter(x => x.done).length;
  return `${areaTag(t)}${t.les ? `<small class="cur-tag"> 📘 ${esc(curOf(t.cur)?.name || '커리큘럼')}</small>` : ''}${dueTag(t)}`
    + `${t.start && !t.done ? `<small class="tr-slot"> 🕒 ${esc(t.start)}${t.end ? `–${esc(t.end)}` : ''}</small>` : ''}`
    + `${t.alarm && !t.done ? `<small class="tr-alarm"> ⏰ ${esc(t.alarm)}</small>` : ''}`
    + `${st.length ? `<small class="muted"> · 단계 ${dn}/${st.length}</small>` : ''}`
    + `${t.from ? `<small class="carry-tag ${nthDay(t, date) >= 4 && !t.done ? 'warn' : ''}"> · ${fmtMD(t.from)}부터 ${nthDay(t, date)}일째</small>` : ''}`
    + `${t.memo && !isTop && !editing ? `<small class="tr-memo">${esc(t.memo)}</small>` : ''}`;
}

/* ───────── 기록(활동 시간) ─────────
   저장: days/{날짜}.lmap = { id: { text(메모), area, min, src, at } }
   src: timer(집중 타이머) · start(시작 타이머) · manual(직접 기록) · check(반복 목표 '했음', 0분)
        · routine(시간표의 활동 시간 '✓ 했음', rt = 반복 시간 id) · cur(커리큘럼 레슨 끝냄, cur·les = 커리큘럼·레슨 id)
   예전부터 쓰던 '집중 n분'(focusMin)은 타이머로 기록한 시간만 계속 더함.
   영역 정보가 없는 예전 집중 시간 = focusMin − (타이머 기록 합) → 통계에서는 학업으로 셈 */
const getLogs = d => listOfMap(dayRec(d).lmap);
function setLogs(d, list) {
  const tm = mapPatch(dayRec(d).lmap, list);
  if (tm) store.patch('days', d, { lmap: tm });
}
function addLog(d, entry) { setLogs(d, [...getLogs(d), { id: uid(), text: '', at: Date.now(), ...entry }]); }
const sumMin = list => list.reduce((a, l) => a + (Number(l.min) || 0), 0);
const legacyMin = d => Math.max(0, (Number(dayRec(d).focusMin) || 0) - sumMin(getLogs(d).filter(l => l.src === 'timer' || l.src === 'start')));
const SRC_LABEL = { timer: '집중 타이머', start: '시작 타이머', manual: '직접 기록', check: '했음', routine: '시간표', cur: '커리큘럼' };
const datesIn = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
// 기간 안의 기록 전체(예전 집중 시간은 학업 기록 한 줄로)
function logsIn(a, b) {
  const out = [];
  for (const d of datesIn(a, b)) {
    for (const l of getLogs(d)) out.push({ ...l, date: d });
    const lg = legacyMin(d);
    if (lg) out.push({ id: `legacy|${d}`, date: d, area: DEFAULT_AREA, min: lg, src: 'legacy', text: '' });
  }
  return out;
}

// 집중 타이머의 영역: 고른 영역 → 지금 할 과제의 영역 → 마지막으로 고른 영역
function mtArea() {
  if (mt.area && areas().some(a => a.id === mt.area && !a.archived)) return mt.area;
  const top = topTask(todayStr());
  return top ? itemArea(top) : defaultArea();
}

function logCard(date) {
  const logs = getLogs(date), legacy = legacyMin(date), total = sumMin(logs) + legacy;
  const rows = logs.map(l => `<li class="log-row">
      ${areaTag(l)}
      <span class="log-text">${esc(l.text || SRC_LABEL[l.src] || '기록')}</span>
      <b class="log-min">${l.min ? fmtDur(Number(l.min)) : '✓'}</b>
      <button class="icon-btn sm" data-action="log-del" data-date="${date}" data-id="${l.id}" aria-label="기록 지우기">×</button>
    </li>`).join('');
  return `<article class="card log-card">
    <div class="card-head"><h2>${date === todayStr() ? '오늘 한 것' : '이 날 한 것'}</h2>${total ? `<span class="muted small">모두 ${fmtDur(total)}</span>` : ''}</div>
    ${logs.length || legacy ? `<ul class="log-list">${rows}${legacy ? `<li class="log-row"><small class="area-tag" style="--ac:${areaInfo(DEFAULT_AREA).color}">${esc(areaInfo(DEFAULT_AREA).label)}</small><span class="log-text muted">영역 기록 전 집중 시간</span><b class="log-min">${fmtDur(legacy)}</b><span></span></li>` : ''}</ul>`
      : `<p class="muted small">타이머로 집중한 시간은 자동으로 들어옵니다. 타이머 없이 한 것(작곡 40분, 게임 1시간 등)은 아래에서 직접 적으세요.</p>`}
    <div class="add-row log-add">
      <select id="log-area-${date}" class="area-in" aria-label="영역">${areaOptions(ui.logArea || defaultArea())}</select>
      <input id="log-min-${date}" type="number" min="1" max="720" inputmode="numeric" placeholder="분" aria-label="몇 분" data-enter="log-add" data-date="${date}">
      <input id="log-text-${date}" placeholder="메모 (선택)" maxlength="60" autocomplete="off" aria-label="메모" data-enter="log-add" data-date="${date}">
      <button class="btn" data-action="log-add" data-date="${date}">기록</button>
    </div>
  </article>`;
}

/* ───────── 반복 목표 ─────────
   저장: meta/goals.items = { id: { text, area, kind('days': 한 날 수 | 'min': 분), target, period('week' | 'day'), archived, o } }
   진행은 기록에서 셈: 영역 목표면 그 안의 세부 영역 기록까지, 세부 영역 목표면 그 세부 영역만 */
const allGoals = () => listOfMap(store.data.meta.goals?.items);
const getGoals = () => allGoals().filter(g => !g.archived);
function setGoals(list) {
  const tm = mapPatch(store.data.meta.goals?.items, list);
  if (tm) store.patch('meta', 'goals', { items: tm });
}
const GOAL_TYPES = [
  ['wdays', '주 n회', { kind: 'days', period: 'week' }, '회'],
  ['wmin', '주 n시간', { kind: 'min', period: 'week' }, '시간'],
  ['dmin', '매일 n분', { kind: 'min', period: 'day' }, '분'],
  ['daily', '매일 하기', { kind: 'days', period: 'day' }, ''],
];
const goalDesc = g => (g.kind === 'days' ? (g.period === 'day' ? '매일' : `주 ${g.target}회`) : g.period === 'day' ? `매일 ${g.target}분` : `주 ${+(g.target / 60).toFixed(1)}시간`);
function goalMatch(g, l) {
  if (l.src === 'check' && l.goal && l.goal !== g.id) return false; // '오늘 했음'은 그 목표에만
  const gi = areaInfo(g.area), li = areaInfo(itemArea(l));
  return gi.a.parent ? li.a.id === gi.a.id : li.top.id === gi.top.id;
}
function goalProgress(g) {
  const t = todayStr(), [a, b] = g.period === 'day' ? [t, t] : [weekStart(t), addDays(weekStart(t), 6)];
  const days = new Set();
  let min = 0;
  for (const l of logsIn(a, b)) if (goalMatch(g, l)) { days.add(l.date); min += Number(l.min) || 0; }
  const val = g.kind === 'days' ? days.size : min;
  return { val, target: g.target, pct: Math.min(100, Math.round((val / Math.max(1, g.target)) * 100)), done: val >= g.target, today: days.has(t) };
}
function goalRow(g, editable) {
  const p = goalProgress(g), i = areaInfo(g.area);
  const valText = g.kind === 'days' ? (g.period === 'day' ? (p.today ? '오늘 했음' : '오늘 아직') : `${p.val}/${g.target}회`) : `${fmtDur(p.val)} / ${fmtDur(g.target)}`;
  const btn = editable
    ? `<button class="icon-btn sm" data-action="rgoal-del" data-id="${g.id}" aria-label="${esc(g.text)} 목표 지우기">×</button>`
    : g.kind === 'days'
      ? (p.today ? '<span class="rg-ok">오늘 ✓</span>' : `<button class="chip-btn" data-action="rgoal-check" data-id="${g.id}">✓ 오늘 했음</button>`)
      : `<button class="chip-btn" data-action="rgoal-log" data-id="${g.id}">기록</button>`;
  return `<li class="rg ${p.done ? 'done' : ''}" style="--ac:${i.color}">
    <div class="rg-top"><span class="rg-name"><b>${esc(g.text)}</b><small class="muted">${esc(i.full)} · ${goalDesc(g)}</small></span>${btn}</div>
    <div class="rg-bar"><i style="width:${p.pct}%"></i></div>
    <small class="rg-val">${valText}${p.done ? ' · 달성' : ''}</small>
  </li>`;
}
function goalsCard(editable = false) {
  const gs = getGoals();
  if (!gs.length && !editable) return '';
  return `<article class="card">
    <div class="card-head"><h2>반복 목표</h2>${editable ? '' : `<button class="link-btn" data-action="nav" data-view="stats">편집</button>`}</div>
    ${gs.length ? `<ul class="rg-list">${gs.map(g => goalRow(g, editable)).join('')}</ul>` : '<p class="muted small">\'주 3회 드럼\', \'주 5시간 작곡\', \'매일 30분 영어\'처럼 꾸준히 할 것을 정하면, 기록이 쌓이는 대로 진행이 채워집니다.</p>'}
    ${editable ? `<div class="rg-add">
      <input id="rg-text" placeholder="목표 이름 (예: 드럼 연습)" maxlength="40" autocomplete="off" aria-label="목표 이름">
      <select id="rg-area" aria-label="영역">${areaOptions(defaultArea())}</select>
      <select id="rg-type" aria-label="종류">${GOAL_TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <input id="rg-n" type="number" min="1" max="600" value="3" inputmode="numeric" aria-label="횟수·시간·분">
      <button class="btn primary" data-action="rgoal-add">추가</button>
    </div>
    <p class="muted small">'주 n회'와 '매일 하기'는 그 영역에 기록이 있는 날을 셉니다(오늘 화면의 '✓ 오늘 했음'으로도 채울 수 있음). 시간 목표는 타이머와 직접 기록한 시간을 더합니다.</p>` : ''}
  </article>`;
}

/* ───────── 기록 화면(통계) ───────── */
function statRange() {
  const a = ui.statAnchor || todayStr();
  if (ui.statMode === 'month') { const f = `${a.slice(0, 7)}-01`; const [y, m] = f.split('-').map(Number); return [f, ymd(new Date(y, m, 0))]; }
  const ws = weekStart(a);
  return [ws, addDays(ws, 6)];
}
function viewStats() {
  const mode = ui.statMode === 'month' ? 'month' : 'week', [a, b] = statRange(), t = todayStr();
  const logs = logsIn(a, b), list = areas();
  const total = sumMin(logs);
  // 영역별·세부 영역별 합계
  const byTop = new Map(), bySub = new Map();
  for (const l of logs) {
    const i = areaInfo(itemArea(l)), m = Number(l.min) || 0;
    byTop.set(i.top.id, (byTop.get(i.top.id) || 0) + m);
    if (i.a.parent) bySub.set(i.a.id, (bySub.get(i.a.id) || 0) + m);
  }
  const tops = [...new Set([...topAreas(list).map(x => x.id), ...byTop.keys()])].map(id => areaInfo(id).top);
  const maxTop = Math.max(1, ...byTop.values());
  const areaRows = tops.map(top => {
    const m = byTop.get(top.id) || 0, subs = list.filter(x => x.parent === top.id && (bySub.get(x.id) || !x.archived));
    const subRows = subs.filter(s => bySub.get(s.id)).map(s => `<li class="st-sub"><span>${esc(s.text)}</span><span class="st-bar"><i style="width:${(bySub.get(s.id) / maxTop) * 100}%;background:${s.color || top.color}"></i></span><b>${fmtDur(bySub.get(s.id))}</b></li>`).join('');
    return `<li class="st-row" style="--ac:${top.color || '#888888'}">
      <span class="st-name">${esc(top.emoji || '')} ${esc(top.text)}</span>
      <span class="st-bar"><i style="width:${(m / maxTop) * 100}%"></i></span>
      <b>${m ? fmtDur(m) : '–'}</b><small class="muted">${total ? Math.round((m / total) * 100) : 0}%</small>
      ${subRows ? `<ul class="st-subs">${subRows}</ul>` : ''}
    </li>`;
  }).join('');
  // 날짜별 막대(영역별로 쌓음)
  const days = datesIn(a, b), dayTot = days.map(d => sumMin(logs.filter(l => l.date === d)));
  const maxDay = Math.max(30, ...dayTot);
  const bars = days.map((d, k) => {
    const segs = tops.map(top => { const m = sumMin(logs.filter(l => l.date === d && areaInfo(itemArea(l)).top.id === top.id)); return m ? `<i style="height:${(m / maxDay) * 100}%;background:${top.color || '#888888'}" title="${esc(top.text)} ${fmtDur(m)}"></i>` : ''; }).join('');
    const lab = mode === 'week' ? DOW[parse(d).getDay()] : (parse(d).getDate() % 5 === 1 || d === b ? parse(d).getDate() : '');
    return `<div class="sd ${d === t ? 'today' : ''}" title="${fmtMD(d)} · ${fmtDur(dayTot[k])}"><span class="sd-bar">${segs}</span><small>${lab}</small></div>`;
  }).join('');
  // 끝낸 과제(영역별)
  const doneBy = new Map();
  let doneN = 0;
  for (const d of days) for (const tk of getTasks(d)) if (tk.done) { doneN++; const id = areaInfo(itemArea(tk)).top.id; doneBy.set(id, (doneBy.get(id) || 0) + 1); }
  const activeDays = days.filter((d, k) => dayTot[k] > 0).length;
  const isCur = a <= t && t <= b;
  const title = mode === 'week' ? `${fmtMD(a)} – ${fmtMD(b)}` : `${a.slice(0, 4)}년 ${Number(a.slice(5, 7))}월`;
  return layoutView([
    [dateHeader(title, isCur ? (mode === 'week' ? '이번 주' : '이번 달') : '', 'stat', !isCur, mode === 'week' ? '이번 주로' : '이번 달로'), 'full'],
    [`<div class="seg stat-seg" role="tablist" aria-label="기간">
      <button type="button" class="${mode === 'week' ? 'on' : ''}" data-action="stat-mode" data-m="week" role="tab" aria-selected="${mode === 'week'}">주</button>
      <button type="button" class="${mode === 'month' ? 'on' : ''}" data-action="stat-mode" data-m="month" role="tab" aria-selected="${mode === 'month'}">달</button>
    </div>`, 'full'],
    [`<article class="card">
      <div class="card-head"><h2>영역별 시간</h2><span class="muted small">모두 ${fmtDur(total)} · ${activeDays}일</span></div>
      ${total ? `<ul class="st-list">${areaRows}</ul>` : '<p class="muted small">이 기간에 기록이 없습니다. 집중 타이머를 쓰거나 오늘 화면의 \'오늘 한 것\'에 직접 적으면 여기에 쌓입니다.</p>'}
    </article>`, 'main'],
    [`<article class="card">
      <div class="card-head"><h2>날짜별</h2><span class="muted small">하루 최대 ${fmtDur(Math.max(...dayTot))}</span></div>
      <div class="sd-chart ${mode}">${bars}</div>
      <div class="st-legend">${tops.filter(x => byTop.get(x.id)).map(x => `<span style="--ac:${x.color || '#888888'}"><i></i>${esc(x.text)}</span>`).join('')}</div>
    </article>`, 'main'],
    [goalsCard(true), 'side'],
    [`<article class="card">
      <div class="card-head"><h2>끝낸 과제</h2><span class="muted small">${doneN}개</span></div>
      ${doneN ? `<ul class="st-done">${tops.filter(x => doneBy.get(x.id)).map(x => `<li style="--ac:${x.color || '#888888'}"><i></i><span>${esc(x.emoji || '')} ${esc(x.text)}</span><b>${doneBy.get(x.id)}개</b></li>`).join('')}</ul>` : '<p class="muted small">이 기간에 끝낸 과제가 없습니다.</p>'}
    </article>`, 'side'],
  ], 'stats-view');
}

/* ───────── 커리큘럼 ─────────
   저장: curricula/{id} (형식은 curriculum.js 머리 설명). 진도 중심: '다음 레슨'은 끝내지도 건너뛰지도 않은 첫 레슨.
   레슨마다 날짜를 잡아 둘 수도 있지만(그날 오늘·주 화면에 보임) 지나도 밀려 쌓이지 않음 */
const inVal = id => document.getElementById(id)?.value.trim() || '';
const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u.length > 42 ? `${u.slice(0, 40)}…` : u}</a>`);
const curList = () => Object.entries(store.data.curricula || {}).filter(([, c]) => c && typeof c.name === 'string')
  .map(([id, c]) => ({ ...c, id })).sort((a, b) => (a.created || 0) - (b.created || 0) || (a.id < b.id ? -1 : 1));
const curActive = () => curList().filter(c => !c.archived);
const curOf = id => { const c = id && store.data.curricula?.[id]; return c && typeof c.name === 'string' ? { ...c, id } : null; };
const lessonsOf = c => listOfMap(c?.lessons);
function setLessons(cid, list) {
  const tm = mapPatch(store.data.curricula?.[cid]?.lessons, list);
  if (tm) store.patch('curricula', cid, { lessons: tm });
}
const updLesson = (cid, lid, patch) => setLessons(cid, lessonsOf(curOf(cid)).map(l => (l.id === lid ? { ...l, ...patch } : l)));
const lessonLeft = l => !l.h && !l.done && !l.skip;
const PACES = [[0, '정하지 않음'], [1, '주 1개'], [2, '주 2개'], [3, '주 3개'], [4, '주 4개'], [5, '주 5개'], [7, '주 7개 (하루 1개)'], [10, '주 10개'], [14, '주 14개 (하루 2개)']];
const paceOptions = sel => PACES.map(([n, t]) => `<option value="${n}" ${Number(sel) === n ? 'selected' : ''}>${t}</option>`).join('');
function curInfo(c) {
  const all = lessonsOf(c), ls = all.filter(l => !l.h), t = todayStr(), ws = weekStart(t), we = addDays(ws, 6);
  const done = ls.filter(l => l.done).length, skipped = ls.filter(l => !l.done && l.skip).length;
  const left = ls.length - done - skipped, pace = Math.max(0, Math.min(14, Number(c.pace) || 0));
  const week = ls.filter(l => l.done && l.done >= ws && l.done <= we).length;
  const num = new Map(ls.map((l, i) => [l.id, i + 1])), secOf = new Map();
  let sec = '';
  for (const l of all) { if (l.h) sec = l.text; else secOf.set(l.id, sec); }
  // 이 속도로 가면 끝나는 주의 마지막 날(이번 주에 남은 몫부터 채운다고 봄)
  let eta = '';
  if (pace && left) { const rest = left - Math.max(0, pace - week); eta = rest <= 0 ? we : addDays(we, Math.ceil(rest / pace) * 7); }
  const base = ls.length - skipped;
  return { all, ls, done, skipped, left, total: ls.length, base, pace, week, num, secOf, eta, next: ls.find(lessonLeft) || null, pct: base ? Math.round((done / base) * 100) : 0 };
}
const curTaskOf = (date, lid) => getTasks(date).find(t => t.les === lid);
const clipStr = (s, n) => (s.length > n ? s.slice(0, n) : s);
function curImportMsg(list, parsed) {
  const nl = list.filter(x => !x.h).length, ns = list.length - nl, nb = list.filter(x => !x.h && x.body).length;
  const extra = [ns ? `단원 ${ns}개` : '', nb ? `설명 ${nb}개` : ''].filter(Boolean).join(', ');
  const parts = [nl ? `레슨 ${nl}개${extra ? `(${extra})` : ''}` : '', parsed.guide ? '안내' : ''].filter(Boolean);
  if (!parts.length) return '';
  return `${parts.join('와 ')}를 넣었습니다.${parsed.dropped?.length ? ` '${parsed.dropped.join("', '")}'(체크 목록)은 앱이 대신 기록하므로 뺐습니다.` : ''}`;
}
function lessonTask(cid, lid) {
  const c = curOf(cid), l = c && lessonsOf(c).find(x => x.id === lid), d = todayStr();
  if (!l || l.h) return;
  if (curTaskOf(d, lid)) { toast('이미 오늘 과제칸에 있습니다.'); return; }
  setTasks(d, [...getTasks(d), { id: uid(), text: l.text, memo: l.memo || '', cue: '', due: '', done: false, projectId: null, milestoneId: null, area: c.area, cur: cid, les: lid }]);
  toast(`'${l.text}'을(를) 오늘 과제칸에 올렸습니다.`);
}
// 레슨 끝냄: 레슨에 날짜·한 줄을 남기고, 그날 기록에 한 줄(영역·분) — 목표·통계에 들어감
function completeLesson(cid, lid, { date = todayStr(), min = 0, note = '' } = {}) {
  const c = curOf(cid), l = c && lessonsOf(c).find(x => x.id === lid);
  if (!l || l.h) return;
  updLesson(cid, lid, { done: date, note: note || l.note || '', skip: false });
  setLogs(date, [...getLogs(date).filter(x => x.les !== lid), { id: uid(), text: `${c.name} · ${l.text}`, area: c.area, min: Math.max(0, Math.min(600, Math.round(Number(min) || 0))), src: 'cur', cur: cid, les: lid, at: Date.now() }]);
}
function undoLesson(cid, lid) {
  const l = lessonsOf(curOf(cid)).find(x => x.id === lid);
  if (!l?.done) return;
  setLogs(l.done, getLogs(l.done).filter(x => x.les !== lid));
  updLesson(cid, lid, { done: '' });
}
// 레슨에서 올린 과제를 체크하면 레슨도 끝냄(시간은 타이머 기록에 따로 들어가므로 0분), 체크를 풀면 되돌림
function lessonByTask(date, t, done) {
  const c = curOf(t.cur), l = c && lessonsOf(c).find(x => x.id === t.les);
  if (!l) return;
  if (done && !l.done) { completeLesson(c.id, l.id, { date, min: 0 }); ui.curNote = { cid: c.id, lid: l.id }; }
  else if (!done && l.done === date && getLogs(date).some(x => x.les === l.id && !Number(x.min))) { undoLesson(c.id, l.id); if (ui.curNote?.lid === l.id) ui.curNote = null; }
}
// 활동 시간 칸(영역)에 띄울 다음 레슨: 같은 영역이거나, 칸이 큰 영역이면 그 안의 세부 영역 커리큘럼
function curNextFor(area) {
  const bi = areaInfo(area);
  for (const c of curActive()) {
    const ci = areaInfo(c.area);
    if (c.area === area || (!bi.a.parent && ci.top.id === bi.top.id)) { const n = curInfo(c).next; if (n) return { c, l: n }; }
  }
  return null;
}
// 이 날 잡아 둔 레슨·끝낸 레슨(주 화면)
function curOnDate(d) {
  const out = [];
  for (const c of curActive()) {
    if (!inFilter(c)) continue;
    for (const l of lessonsOf(c)) if (!l.h && (l.done === d || (l.date === d && !l.done && !l.skip))) out.push({ c, l });
  }
  return out;
}

function curDoneForm(l, c) {
  return `<div class="cur-form">
    <input id="cd-note" data-enter="cur-done-save" placeholder="한 줄 요약·감상 (선택)" maxlength="140" autocomplete="off" aria-label="한 줄 남기기">
    <div class="cur-form-row"><label class="field inline"><span>걸린 시간</span><input id="cd-min" type="number" min="0" max="600" inputmode="numeric" value="${l.min || Number(c?.lmin) || 30}" data-enter="cur-done-save"></label><span class="muted small">분</span>
      <span class="btn-row tight"><button type="button" class="btn sm primary" data-action="cur-done-save">끝냄</button><button type="button" class="btn sm" data-action="cur-done-cancel">취소</button></span></div>
  </div>`;
}
const isDoneOpen = (cid, lid) => ui.curDone?.cid === cid && ui.curDone?.lid === lid;
const lessonMeta = (l, I) => [l.min ? fmtDur(l.min) : '', l.opt ? '선택' : '', l.date && !l.done ? `📅 ${fmtMD(l.date)}` : '', l.done ? `${fmtMD(l.done)} 끝냄` : '', l.skip && !l.done ? '건너뜀' : '', I && I.next?.id === l.id ? '다음 레슨' : ''].filter(Boolean).join(' · ');

// 오늘 화면: 커리큘럼마다 다음 레슨(+ 오늘로 잡아 둔 레슨). 이름을 누르면 레슨 설명을 엶
function curTodayCard(date) {
  if (date !== todayStr()) return '';
  const cs = curActive().filter(inFilter);
  if (!cs.length) return '';
  const lessonRow = (c, I, x, dated) => {
    const task = curTaskOf(date, x.id), sec = I.secOf.get(x.id);
    const sub = [x.min ? fmtDur(x.min) : '', x.opt ? '선택 레슨' : '', x.body ? '설명 보기 ›' : ''].filter(Boolean).join(' · ');
    return `<div class="ct-les">
      <span class="ct-text"><small class="muted">${I.num.get(x.id)}번째${sec ? ` · ${esc(sec)}` : ''}${dated ? ' · 오늘로 잡아 둠' : ''}</small>
        <button type="button" class="ct-title" data-action="cur-lesson" data-c="${c.id}" data-l="${x.id}"><b>${esc(x.text)}</b>${sub ? `<small>${sub}</small>` : ''}</button>
        ${x.memo ? `<small class="ct-memo">${linkify(x.memo)}</small>` : ''}</span>
      <span class="ct-acts">${task ? `<span class="muted small">${task.done ? '과제 끝냄' : '과제칸에 있음'}</span>` : `<button type="button" class="chip-btn" data-action="cur-task" data-c="${c.id}" data-l="${x.id}">과제로</button>`}${x.opt ? `<button type="button" class="chip-btn" data-action="cur-skip" data-c="${c.id}" data-l="${x.id}">건너뛰기</button>` : ''}<button type="button" class="chip-btn on" data-action="cur-done-open" data-c="${c.id}" data-l="${x.id}">✓ 끝냄</button></span>
    </div>${isDoneOpen(c.id, x.id) ? curDoneForm(x, c) : ''}`;
  };
  const rows = cs.map(c => {
    const I = curInfo(c), ai = areaInfo(c.area), n = I.next;
    const dated = I.ls.filter(x => x.date === date && lessonLeft(x) && x.id !== n?.id);
    const nl = ui.curNote?.cid === c.id ? I.ls.find(x => x.id === ui.curNote.lid && x.done) : null;
    return `<li class="ct-item" style="--ac:${ai.color}">
      <button type="button" class="ct-head" data-action="cur-open" data-id="${c.id}"><b>${esc(ai.emoji)} ${esc(c.name)}</b><small>${I.done}/${I.base}${I.pace ? ` · 이번 주 ${I.week}/${I.pace}` : ''}</small></button>
      ${nl ? `<div class="ct-note"><span>✓ <b>${esc(nl.text)}</b> 끝냄 — 한 줄 남길까요?</span><input id="cn-text" data-enter="cur-note-save" placeholder="한 줄 요약·감상" maxlength="140" autocomplete="off" aria-label="한 줄 남기기"><span class="btn-row tight"><button type="button" class="btn sm primary" data-action="cur-note-save">남기기</button><button type="button" class="btn sm" data-action="cur-note-skip">괜찮아요</button></span></div>` : ''}
      ${dated.map(x => lessonRow(c, I, x, true)).join('')}
      ${n ? lessonRow(c, I, n, n.date === date) : `<p class="muted small">${I.total ? '레슨을 모두 끝냈습니다.' : '레슨이 아직 없습니다.'}</p>`}
    </li>`;
  }).join('');
  return `<article class="card cur-today">
    <div class="card-head"><h2>커리큘럼</h2><button type="button" class="link-btn" data-action="nav" data-view="curriculum">전체 보기</button></div>
    <ul class="ct-list">${rows}</ul>
  </article>`;
}

function curTemplateCard() {
  return `<article class="card">
    <div class="card-head"><h2>AI에게 짜 달라고 할 때</h2></div>
    <p class="muted small">템플릿을 복사해 빈칸(배우려는 것, 지금 수준, 쓸 수 있는 시간)을 채워 AI에게 보내고, 받은 결과를 '새 커리큘럼'의 붙여 넣기 칸에 그대로 넣으세요. 첫 단원 전의 글은 '안내'로, '### 1. 레슨' 같은 번호 붙은 제목은 레슨으로, 그 아래 글은 레슨 설명으로 들어갑니다. 이미 만들어 둔 문서('## 순번 1 · …' 식)도 번호 붙은 제목을 레슨으로 알아보고, 진행 기록용 체크 목록은 앱이 대신 기록하므로 뺍니다. 레슨을 작게 나누고 밀린 것을 몰아서 하는 구조를 피하라는 요청도 들어 있습니다.</p>
    <div class="btn-row"><button type="button" class="btn" data-action="cur-tpl">템플릿 복사</button><button type="button" class="link-btn" data-action="cur-tpl-show">${ui.curTpl ? '접기' : '내용 보기'}</button></div>
    ${ui.curTpl ? `<textarea class="code-box" rows="14" readonly aria-label="커리큘럼 템플릿">${esc(CUR_TEMPLATE)}</textarea>` : ''}
  </article>`;
}

function curNewForm() {
  return `<article class="card">
    <div class="card-head"><h2>새 커리큘럼</h2></div>
    <div class="fields">
      <label class="field"><span>이름</span><input id="nc-name" placeholder="비우면 붙여 넣은 글의 '#' 제목을 씀" maxlength="80" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>영역</span><select id="nc-area">${areaOptions(defaultArea())}</select></label>
        <label class="field"><span>속도</span><select id="nc-pace">${paceOptions(3)}</select></label>
      </div>
      <label class="field"><span>커리큘럼 글 붙여 넣기 (선택)</span><textarea id="nc-text" rows="9" placeholder="# 화성학 기초&#10;안내: 이 커리큘럼을 쓰는 방법…&#10;## 1단원 소리의 재료&#10;### 1. 장음계와 반음 위치 | 15분&#10;레슨 설명…"></textarea></label>
      <p class="muted small">비워 두고 만든 뒤 레슨을 하나씩 더해도 됩니다. 속도는 '이번 주 몇 개'와 예상 완료일을 보여 주는 데만 쓰고, 못 채워도 밀린 레슨이 쌓이지 않습니다.</p>
    </div>
    <div class="btn-row"><button type="button" class="btn primary" data-action="cur-create">만들기</button><button type="button" class="btn" data-action="cur-new-cancel">취소</button></div>
  </article>`;
}

function curCard(c) {
  const I = curInfo(c), ai = areaInfo(c.area), n = I.next;
  return `<article class="card cur-card" style="--ac:${ai.color}">
    <button type="button" class="proj-head" data-action="cur-open" data-id="${c.id}">
      <span class="proj-title"><b>${esc(ai.emoji)} ${esc(c.name)}</b><small>${areaTag(c)}${I.pace ? ` 주 ${I.pace}개 · 이번 주 ${I.week}/${I.pace}` : ''}</small></span>
      <span class="proj-count">${I.done}/${I.base}<i class="chev">›</i></span>
    </button>
    <div class="bar" role="progressbar" aria-valuenow="${I.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${I.pct}%"></i></div>
    <p class="proj-next ${n ? '' : 'ok'}">${n ? `다음: ${I.num.get(n.id)}. ${esc(n.text)}${I.eta ? ` · 이 속도면 ${fmtMD(I.eta)}쯤 끝` : ''}` : I.total ? '레슨을 모두 끝냈습니다' : '레슨이 아직 없습니다'}</p>
  </article>`;
}

// 레슨 목록 한 줄: 번호를 누르면 끝냄, 이름을 누르면 레슨(설명) 화면. 단원 줄은 눌러서 단원 안내·고치기
function curLessonRow(c, I, l, idx, len) {
  const k = `cu|${l.id}`;
  if (l.h) {
    const open = ui.curOpen === l.id, edit = ui.curEdit === l.id;
    return `<li class="cu-sec ${open ? 'open' : ''}"><button type="button" class="cu-sec-head" data-action="cur-les-open" data-l="${l.id}" aria-expanded="${open}"><span>${esc(l.text)}</span>${l.body ? `<small>${open ? '접기' : '단원 안내'}</small>` : ''}</button>
      ${open && l.body && !edit ? `<div class="md cu-sec-body">${renderMd(l.body)}</div>` : ''}
      ${open ? (edit ? `<div class="cu-edit">
        <input data-cles="text" data-c="${c.id}" data-l="${l.id}" data-key="${k}|text" value="${esc(l.text)}" maxlength="80" aria-label="단원 이름">
        <textarea data-cles="body" data-c="${c.id}" data-l="${l.id}" data-key="${k}|body" rows="5" placeholder="단원 안내 (선택)" aria-label="단원 안내">${esc(l.body || '')}</textarea>
        <div class="btn-row tight">${curMoveBtns(c, l, idx, len)}<button type="button" class="btn sm" data-action="cur-edit" data-l="${l.id}">다 고침</button><button type="button" class="btn sm danger" data-action="cur-les-del" data-c="${c.id}" data-l="${l.id}">지우기</button></div>
      </div>` : `<div class="btn-row tight cu-sec-acts"><button type="button" class="link-btn" data-action="cur-edit" data-l="${l.id}">고치기</button></div>`) : ''}</li>`;
  }
  const isNext = I.next?.id === l.id, meta = lessonMeta(l, I);
  return `<li class="cu-les ${l.done ? 'done' : ''} ${l.skip && !l.done ? 'skip' : ''} ${isNext ? 'next' : ''}">
    <div class="cu-row">
      <button type="button" class="cu-mark" data-action="${l.done ? 'cur-lesson' : 'cur-done-open'}" data-c="${c.id}" data-l="${l.id}" aria-label="${l.done ? `${esc(l.text)} 열기` : `${esc(l.text)} 끝냄으로 표시`}">${l.done ? '✓' : l.skip ? '–' : I.num.get(l.id)}</button>
      <button type="button" class="cu-body" data-action="cur-lesson" data-c="${c.id}" data-l="${l.id}"><b>${esc(l.text)}</b>${meta || l.body ? `<small>${[meta, l.body ? '설명 ›' : ''].filter(Boolean).join(' · ')}</small>` : ''}</button>
    </div>
    ${l.note ? `<p class="cu-note">“${esc(l.note)}”</p>` : ''}
    ${l.memo ? `<p class="cu-memo">${linkify(l.memo)}</p>` : ''}
    ${isDoneOpen(c.id, l.id) && ui.curDone.at !== 'sum' ? curDoneForm(l, c) : ''}
  </li>`;
}
const curMoveBtns = (c, l, idx, len) => `<button type="button" class="icon-btn sm" data-action="cur-les-move" data-c="${c.id}" data-l="${l.id}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} aria-label="위로">↑</button><button type="button" class="icon-btn sm" data-action="cur-les-move" data-c="${c.id}" data-l="${l.id}" data-dir="1" ${idx === len - 1 ? 'disabled' : ''} aria-label="아래로">↓</button>`;

// 레슨 화면: 설명(본문)을 읽고 그 자리에서 끝냄·과제로 올리기·고치기, 앞뒤 레슨으로 이동
function curLessonPage(c, I, l) {
  const ai = areaInfo(c.area), idx = I.ls.findIndex(x => x.id === l.id), prev = I.ls[idx - 1], next = I.ls[idx + 1];
  const pos = I.all.findIndex(x => x.id === l.id), sec = I.secOf.get(l.id), edit = ui.curEdit === l.id, k = `cu|${l.id}`, task = curTaskOf(todayStr(), l.id);
  const meta = lessonMeta(l, I);
  const status = l.done
    ? `<div class="cur-done-info"><b>✓ ${fmtMD(l.done)} 끝냄</b>${l.note ? `<p class="cu-note">“${esc(l.note)}”</p>` : ''}
        <input data-cles="note" data-c="${c.id}" data-l="${l.id}" data-key="${k}|note" value="${esc(l.note || '')}" placeholder="한 줄 요약·감상" maxlength="140" aria-label="한 줄 남김">
        <div class="btn-row tight"><button type="button" class="btn sm" data-action="cur-undo" data-c="${c.id}" data-l="${l.id}">끝냄 취소</button></div></div>`
    : `<div class="btn-row cur-page-acts"><button type="button" class="btn primary" data-action="cur-done-open" data-c="${c.id}" data-l="${l.id}" data-at="page">✓ 끝냄</button>${task ? `<span class="muted small">${task.done ? '과제 끝냄' : '오늘 과제칸에 있음'}</span>` : `<button type="button" class="btn" data-action="cur-task" data-c="${c.id}" data-l="${l.id}">오늘 과제로</button>`}<button type="button" class="btn" data-action="cur-skip" data-c="${c.id}" data-l="${l.id}">${l.skip ? '건너뜀 취소' : '건너뛰기'}</button></div>
      ${isDoneOpen(c.id, l.id) ? curDoneForm(l, c) : ''}`;
  const editor = edit ? `<article class="card"><div class="card-head"><h2>레슨 고치기</h2><button type="button" class="link-btn" data-action="cur-edit" data-l="${l.id}">다 고침</button></div>
      <div class="cu-edit page">
        <label class="field"><span>이름</span><input data-cles="text" data-c="${c.id}" data-l="${l.id}" data-key="${k}|text" value="${esc(l.text)}" maxlength="120"></label>
        <div class="cu-edit-row"><label class="field inline"><span>예상</span><input type="number" min="0" max="600" inputmode="numeric" data-cles="min" data-c="${c.id}" data-l="${l.id}" data-key="${k}|min" value="${l.min || ''}" aria-label="예상 분"></label><span class="muted small">분</span>
          <label class="field inline"><span>날짜</span><input type="date" data-cles="date" data-c="${c.id}" data-l="${l.id}" value="${esc(l.date || '')}" aria-label="잡아 둘 날짜 (선택)"></label></div>
        <label class="field"><span>메모·링크 (한 줄)</span><input data-cles="memo" data-c="${c.id}" data-l="${l.id}" data-key="${k}|memo" value="${esc(l.memo || '')}" maxlength="300"></label>
        <label class="field"><span>설명 (마크다운: # 소제목, - 목록, **굵게**, 표)</span><textarea data-cles="body" data-c="${c.id}" data-l="${l.id}" data-key="${k}|body" rows="14" aria-label="레슨 설명">${esc(l.body || '')}</textarea></label>
        <label class="check"><input type="checkbox" data-cles="opt" data-c="${c.id}" data-l="${l.id}" ${l.opt ? 'checked' : ''}><span>선택 레슨 (건너뛰어도 되는 것)</span></label>
        <div class="btn-row tight">${curMoveBtns(c, l, pos, I.all.length)}<button type="button" class="btn sm danger" data-action="cur-les-del" data-c="${c.id}" data-l="${l.id}">레슨 지우기</button></div>
      </div></article>`
    : '';
  const nav = `<nav class="cur-pager">${prev ? `<button type="button" class="btn" data-action="cur-lesson" data-c="${c.id}" data-l="${prev.id}">‹ ${I.num.get(prev.id)}. ${esc(prev.text)}</button>` : '<span></span>'}${next ? `<button type="button" class="btn" data-action="cur-lesson" data-c="${c.id}" data-l="${next.id}">${I.num.get(next.id)}. ${esc(next.text)} ›</button>` : '<span></span>'}</nav>`;
  return layoutView([
    [`<header class="vhead plain cur-vhead"><button type="button" class="icon-btn" data-action="cur-lesson-close" aria-label="${esc(c.name)}(으)로">‹</button>
      <div class="vtitle"><h1>${I.num.get(l.id)}. ${esc(l.text)}</h1><span class="sub">${esc(ai.emoji)} ${esc(c.name)}${sec ? ` · ${esc(sec)}` : ''}${meta ? ` · ${meta}` : ''}</span></div></header>`, 'full'],
    [`<article class="card cur-lesson" style="--ac:${ai.color}">
      ${l.body ? `<div class="md">${renderMd(l.body)}</div>` : `<p class="muted">설명이 아직 없습니다. '고치기'에서 이 레슨에서 할 것과 끝난 기준을 적거나, 공부하면서 받은 설명을 붙여 넣어 두세요.</p>`}
      ${l.memo ? `<p class="cu-memo">${linkify(l.memo)}</p>` : ''}
    </article>`, 'main'],
    [`<article class="card cur-status" style="--ac:${ai.color}">${status}
      ${edit ? '' : `<div class="btn-row tight"><button type="button" class="link-btn" data-action="cur-edit" data-l="${l.id}">고치기</button></div>`}</article>`, 'side'],
    [editor, 'side'],
    [nav, 'main'],
  ], 'cur-view cur-page');
}

function curDetail(c) {
  const I = curInfo(c), ai = areaInfo(c.area), n = I.next;
  return layoutView([
    [`<header class="vhead plain cur-vhead"><button type="button" class="icon-btn" data-action="cur-back" aria-label="커리큘럼 목록">‹</button>
      <div class="vtitle"><h1>${esc(ai.emoji)} ${esc(c.name)}</h1><span class="sub">${esc(ai.full)}${c.archived ? ' · 보관됨' : ''}</span></div></header>`, 'full'],
    [`<article class="card cur-sum" style="--ac:${ai.color}">
      <div class="cur-sum-top"><b>${I.done}<small>/${I.base}</small></b><span class="muted small">끝낸 레슨${I.skipped ? ` · 건너뜀 ${I.skipped}` : ''}${I.pace ? `<br>이번 주 ${I.week}/${I.pace}${I.eta ? ` · 이 속도면 ${fmtMD(I.eta)}쯤 끝` : ''}` : ''}</span></div>
      <div class="bar"><i style="width:${I.pct}%"></i></div>
      ${n ? `<div class="cur-next"><button type="button" class="cur-next-title" data-action="cur-lesson" data-c="${c.id}" data-l="${n.id}"><small class="muted">다음 레슨${n.body ? ' · 설명 보기 ›' : ''}</small><b>${I.num.get(n.id)}. ${esc(n.text)}</b></button><span class="btn-row tight">${curTaskOf(todayStr(), n.id) ? '<span class="muted small">과제칸에 있음</span>' : `<button type="button" class="chip-btn" data-action="cur-task" data-c="${c.id}" data-l="${n.id}">오늘 과제로</button>`}<button type="button" class="chip-btn on" data-action="cur-done-open" data-c="${c.id}" data-l="${n.id}" data-at="sum">✓ 끝냄</button></span></div>
        ${isDoneOpen(c.id, n.id) && ui.curDone.at === 'sum' ? curDoneForm(n, c) : ''}` : ''}
    </article>`, 'main'],
    [c.guide ? `<article class="card cur-guide">
      <div class="card-head"><h2>안내</h2><button type="button" class="link-btn" data-action="cur-guide">${ui.curGuide ? '접기' : '펼치기'}</button></div>
      ${ui.curGuide ? `<div class="md">${renderMd(c.guide)}</div><div class="btn-row tight"><button type="button" class="link-btn" data-action="cur-guide">안내 접기</button></div>` : `<p class="muted small cur-guide-pre">${esc(plainPreview(c.guide, 140))}</p>`}
    </article>` : '', 'main'],
    [`<article class="card">
      <div class="card-head"><h2>레슨</h2><span class="muted small">번호를 누르면 끝냄, 이름을 누르면 레슨 화면</span></div>
      ${I.all.length ? `<ol class="cu-list">${I.all.map((l, i) => curLessonRow(c, I, l, i, I.all.length)).join('')}</ol>` : '<p class="muted small">아래에서 레슨을 더하거나, 커리큘럼 글을 붙여 넣어 한 번에 넣으세요.</p>'}
      <div class="add-row cu-add"><input id="cu-new" data-enter="cur-les-add" placeholder="레슨 이름" maxlength="120" autocomplete="off" aria-label="새 레슨 이름"><input id="cu-new-min" type="number" min="0" max="600" inputmode="numeric" placeholder="분" data-enter="cur-les-add" aria-label="예상 분"><button type="button" class="btn" data-action="cur-les-add">추가</button></div>
      <div class="btn-row tight"><button type="button" class="link-btn" data-action="cur-sec-add">+ 칸의 글자로 단원 제목 넣기</button><button type="button" class="link-btn" data-action="cur-paste-open">${ui.curPaste ? '붙여 넣기 접기' : '붙여 넣어 여러 개 넣기'}</button></div>
      ${ui.curPaste ? `<textarea id="cp-text" rows="7" placeholder="## 2단원&#10;### 7. 레슨 이름 | 30분&#10;레슨 설명…"></textarea><div class="btn-row tight"><button type="button" class="btn sm primary" data-action="cur-paste-add">끝에 넣기</button></div>` : ''}
    </article>`, 'main'],
    [`<article class="card">
      <div class="card-head"><h2>설정</h2></div>
      <div class="fields">
        <label class="field"><span>이름</span><input data-cur="name" data-key="cur|${c.id}|name" value="${esc(c.name)}" maxlength="80"></label>
        <label class="field"><span>영역</span><select data-cur="area">${areaOptions(c.area)}</select></label>
        <div class="field-row">
          <label class="field"><span>속도</span><select data-cur="pace">${paceOptions(c.pace || 0)}</select></label>
          <label class="field"><span>레슨 기본 시간 (분)</span><input type="number" min="0" max="600" inputmode="numeric" data-cur="lmin" data-key="cur|${c.id}|lmin" value="${Number(c.lmin) || ''}" placeholder="30"></label>
        </div>
        ${ui.curGuideEdit ? `<label class="field"><span>안내 (마크다운)</span><textarea data-cur="guide" data-key="cur|${c.id}|guide" rows="12">${esc(c.guide || '')}</textarea></label>` : ''}
      </div>
      <div class="btn-row"><button type="button" class="btn" data-action="cur-guide-edit">${ui.curGuideEdit ? '안내 고치기 닫기' : c.guide ? '안내 고치기' : '안내 쓰기'}</button><button type="button" class="btn" data-action="cur-archive" data-id="${c.id}">${c.archived ? '보관함에서 꺼내기' : '보관하기'}</button><button type="button" class="btn danger" data-action="cur-del" data-id="${c.id}">지우기</button></div>
    </article>`, 'side'],
    [curTemplateCard(), 'side'],
  ], 'cur-view');
}

function viewCurricula() {
  const c = curOf(ui.curId);
  if (c && ui.curLesson) {
    const I = curInfo(c), l = I.ls.find(x => x.id === ui.curLesson);
    if (l) return curLessonPage(c, I, l);
  }
  if (c) return curDetail(c);
  const all = curList().filter(inFilter), active = all.filter(x => !x.archived), arch = all.filter(x => x.archived);
  return `<section class="view">
    <header class="vhead plain">
      <div class="vtitle"><h1>커리큘럼</h1><span class="sub">순서대로 한 칸씩 — 날짜에 묶지 않아 밀린 레슨이 쌓이지 않습니다</span></div>
      ${ui.curNew ? '' : '<button type="button" class="btn primary" data-action="cur-new">새 커리큘럼</button>'}
    </header>
    ${areaFilterBar()}
    ${ui.curNew ? curNewForm() : ''}
    ${active.length ? `<div class="proj-grid">${active.map(curCard).join('')}</div>` : ui.curNew ? '' : `<article class="card"><p class="muted">${areaFilter() ? '이 영역에 커리큘럼이 없습니다.' : '아직 커리큘럼이 없습니다.'} 화성학·드럼 루디먼트·그림 기초처럼 순서가 있는 공부를 안내·단원·레슨(설명 포함)으로 넣어 두면, 오늘 화면과 활동 시간 칸에 다음 레슨이 뜨고 레슨을 열어 설명을 보며 진행할 수 있습니다.</p></article>`}
    ${curTemplateCard()}
    ${arch.length ? `<button type="button" class="link-btn" data-action="cur-arch-toggle">${ui.curShowArch ? '보관함 접기' : `보관된 커리큘럼 ${arch.length}개 보기`}</button>
      ${ui.curShowArch ? `<div class="proj-grid">${arch.map(curCard).join('')}</div>` : ''}` : ''}
  </section>`;
}

/* ───────── 시간표 ───────── */
function timelineCard(date) {
  const R = routineOf(settings().routine), rec = dayRec(date), off = !!rec.routineOff;
  const dayBlocks = R.blocks.filter(b => (b.days || []).includes(isoDow(parse(date))));
  const tasks = getTasks(date);
  const items = buildTimeline({ fixed: dayRoutine(date), tasks, dayStart: R.dayStart, dayEnd: R.dayEnd });
  const isToday = date === todayStr(), nd = new Date(), nowMin = isToday ? nd.getHours() * 60 + nd.getMinutes() : -1;
  const unscheduled = tasks.filter(t => !t.done && toMin(t.start) == null);
  const timeOf = it => `<span class="tl-time">${toHM(it.s)}<i>${toHM(it.e)}</i></span>`;
  const clsOf = it => `${nowMin >= it.s && nowMin < it.e ? 'now' : ''} ${isToday && it.e <= nowMin ? 'past' : ''}`;
  const isOpen = g => ui.tlOpen === `${date}|${g.s}`;
  const taskLi = it => {
    const t = it.task;
    return `<li class="tl-item task ${t.done ? 'done' : ''} ${clsOf(it)}">${timeOf(it)}<span class="tl-body"><b>${esc(t.text)}</b><small>${fmtDur(it.e - it.s)}${it.overlap ? ' · <em>다른 과제와 겹침</em>' : ''}</small></span><button type="button" class="icon-btn sm" data-action="tl-unplace" data-date="${date}" data-id="${t.id}" aria-label="시간표에서 빼기">×</button></li>`;
  };
  const gapLi = (g, inner) => {
    if (isOpen(g)) {
      const e = Math.min(g.e, g.s + 60);
      return `<li class="tl-item gap open ${clsOf(g)}">${timeOf(g)}<div class="tl-form">
        <select id="tl-task" data-change="tl-sel" aria-label="넣을 과제">${unscheduled.map(t => `<option value="${t.id}">${esc(t.text)}</option>`).join('')}<option value="__new">+ 새 과제</option></select>
        <input id="tl-new" placeholder="새 과제 이름" maxlength="120" autocomplete="off" ${unscheduled.length ? 'hidden' : ''}>
        <span class="time-row"><input type="time" id="tl-s" value="${toHM(g.s)}" aria-label="시작"><span>~</span><input type="time" id="tl-e" value="${toHM(e)}" aria-label="끝"></span>
        <div class="btn-row tight"><button type="button" class="btn sm primary" data-action="tl-place" data-date="${date}">넣기</button><button type="button" class="btn sm" data-action="tl-cancel">취소</button></div>
      </div></li>`;
    }
    return `<li class="tl-item gap ${inner ? 'inner' : ''} ${clsOf(g)}">${timeOf(g)}<button type="button" class="tl-add" data-action="tl-open" data-date="${date}" data-s="${g.s}"><span>${inner ? '남은' : '빈'} 시간 ${fmtDur(g.e - g.s)}</span><b>+ 과제 넣기</b></button></li>`;
  };
  const logs = getLogs(date);
  const blockLi = f => {
    // 과제가 없는 일과는 머리줄의 버튼으로 넣고, 과제가 있거나 넣는 중이면 일과 안에 과제·남은 시간을 펼쳐 보여 줌
    const b = f.block, act = isActivity(b), ai = act ? areaInfo(b.area) : null, name = blockName(b);
    const showInner = f.tasks.length > 0 || f.gaps.some(isOpen);
    const inner = [...f.tasks, ...(f.tasks.length ? f.gaps : f.gaps.filter(isOpen))].sort((x, y) => x.s - y.s);
    const addBtn = !showInner && f.gaps.length ? `<button type="button" class="tl-mini-add" data-action="tl-open" data-date="${date}" data-s="${f.gaps[0].s}" aria-label="${esc(name)}에 과제 넣기">+ 넣기</button>` : '';
    // 활동 시간은 '✓ 했음'으로 기록(→ 기록·목표·통계). 오늘과 지난날만
    const lg = act ? logs.find(l => l.rt === b.id) : null;
    const doneBtn = act && date <= todayStr()
      ? `<button type="button" class="tl-mini-add rt-done ${lg ? 'on' : ''}" data-action="rt-log" data-date="${date}" data-id="${b.id}" aria-pressed="${!!lg}" aria-label="${esc(name)} ${lg ? '기록 지우기' : '했음으로 기록'}">${lg ? `✓ ${fmtDur(Number(lg.min) || 0)}` : '✓ 했음'}</button>` : '';
    const nl = act && date >= todayStr() ? curNextFor(b.area) : null;
    const sub = [act && b.title ? esc(ai.full) : '', f.tasks.length ? `과제 ${f.tasks.length}개` : '', nl ? `다음 레슨: ${esc(nl.l.text)}` : ''].filter(Boolean).join(' · ');
    return `<li class="tl-block ${act ? 'act' : ''} ${lg ? 'logged' : ''} ${clsOf(f)}"${act ? ` style="--ac:${ai.color}"` : ''}>
      <div class="tl-item fixed">${timeOf(f)}<span class="tl-body"><b>${act ? `${esc(ai.emoji)} ` : ''}${esc(name)}</b>${sub ? `<small>${sub}</small>` : ''}</span>${addBtn || doneBtn ? `<span class="tl-acts">${addBtn}${doneBtn}</span>` : ''}</div>
      ${showInner ? `<ol class="tl tl-sub">${inner.map(x => (x.kind === 'task' ? taskLi(x) : gapLi(x, true))).join('')}</ol>` : ''}
    </li>`;
  };
  const rows = items.map(it => (it.kind === 'fixed' ? blockLi(it) : it.kind === 'task' ? taskLi(it) : gapLi(it, false))).join('');
  return `<article class="card tl-card">
    <div class="card-head"><h2>시간표</h2><span class="head-right">${dayBlocks.length ? `<button type="button" class="link-btn" data-action="routine-off" data-date="${date}">${off ? '반복 시간 보이기' : '이 날은 반복 시간 숨기기'}</button>` : ''}<button type="button" class="link-btn" data-action="goto-routine">반복 시간 편집</button></span></div>
    ${R.blocks.length ? '' : `<p class="muted small">설정의 '반복 시간표'에 수업 같은 고정 일과나 '토 14–16시 드럼' 같은 활동 시간을 요일별로 등록하면, 여기에 들어오고 그 시간을 뺀 빈 시간이 자동으로 보입니다.</p>`}
    <ol class="tl">${rows}</ol>
    ${unscheduled.length ? `<p class="muted small">시간을 정하지 않은 과제 ${unscheduled.length}개 — 빈 시간이나 일과의 '+ 넣기'를 눌러 넣거나, 과제 편집에서 '할 시간'을 정하세요.</p>` : ''}
  </article>`;
}

function saveRoutine(R) { store.set('meta', 'settings', { routine: R }); }
function routineCopy() { const R = routineOf(settings().routine); return { ...R, blocks: R.blocks.map(b => ({ ...b, days: [...(b.days || [])] })) }; }
// 반복 시간: 영역이 없으면 회색 고정 일과(수업·식사), 영역이 있으면 그 영역의 활동 시간(드럼·운동)
const isActivity = b => !!b?.area;
const blockName = b => b.title || (isActivity(b) ? areaInfo(b.area).label : '고정 일과');
// 이 날 시간표에 들어가는 반복 시간(숨긴 날이면 없음)
function dayRoutine(date) {
  if (dayRec(date).routineOff) return [];
  const dow = isoDow(parse(date));
  return routineOf(settings().routine).blocks.filter(b => (b.days || []).includes(dow) && toMin(b.start) != null && toMin(b.end) > toMin(b.start));
}

function routineCard() {
  const R = routineOf(settings().routine), W = ['월', '화', '수', '목', '금', '토', '일'], cal = calConnected();
  return `<article class="card" id="routine-card">
    <div class="card-head"><h2>반복 시간표</h2><span class="muted small">고정 일과 · 활동 시간</span></div>
    <p class="muted small">요일마다 반복되는 시간을 등록하세요. 수업·식사처럼 영역을 '없음'으로 두면 회색 고정 일과가 되고, 영역을 고르면 그 영역 색의 활동 시간이 됩니다(예: 토 14–16시 드럼). 활동 시간은 오늘 화면 시간표에서 '✓ 했음'을 누르면 그 시간만큼 기록·목표에 들어갑니다.</p>
    <div class="rt-range"><span>하루 시작</span><input type="time" data-routine="dayStart" value="${esc(R.dayStart)}" aria-label="하루 시작"><span>끝</span><input type="time" data-routine="dayEnd" value="${esc(R.dayEnd)}" aria-label="하루 끝"></div>
    ${R.blocks.length ? `<ul class="rt-list">${R.blocks.map(b => {
      const act = isActivity(b), ai = act ? areaInfo(b.area) : null;
      return `<li class="rt-item ${act ? 'act' : ''}"${act ? ` style="--ac:${ai.color}"` : ''}>
      <div class="rt-row"><input data-routine="title" data-id="${b.id}" data-key="rt|${b.id}|title" value="${esc(b.title || '')}" placeholder="${act ? '예: 드럼' : '예: 수업'}" maxlength="40" aria-label="이름"><button type="button" class="icon-btn sm" data-action="routine-del" data-id="${b.id}" aria-label="반복 시간 삭제">×</button></div>
      <div class="rt-row wrap"><span class="time-row"><input type="time" data-routine="start" data-id="${b.id}" value="${esc(b.start)}" aria-label="시작"><span>~</span><input type="time" data-routine="end" data-id="${b.id}" value="${esc(b.end)}" aria-label="끝"></span>
        <select class="area-in" data-routine="area" data-id="${b.id}" aria-label="영역"><option value="" ${act ? '' : 'selected'}>영역 없음 (고정 일과)</option>${areaOptions(b.area || '')}</select></div>
      <div class="rt-days">${W.map((w, i) => { const on = (b.days || []).includes(i + 1); return `<button type="button" class="day-chip ${on ? 'on' : ''}" data-action="routine-day" data-id="${b.id}" data-d="${i + 1}" aria-pressed="${on}">${w}</button>`; }).join('')}</div>
      ${cal || b.cal ? `<label class="check small"><input type="checkbox" data-routine="cal" data-id="${b.id}" ${b.cal ? 'checked' : ''}><span>구글 캘린더에도 넣기 <small class="muted">(앞으로 ${RT_CAL_DAYS / 7}주치, 10분 전 알림)</small></span></label>` : ''}
    </li>`;
    }).join('')}</ul>` : ''}
    <div class="btn-row"><button type="button" class="btn" data-action="routine-add" data-kind="fixed">+ 고정 일과</button><button type="button" class="btn" data-action="routine-add" data-kind="act">+ 활동 시간</button></div>
  </article>`;
}

/* ───────── 공부 시작 체크리스트 ───────── */
const CL_DEFAULT = ['휴대폰은 손 닿지 않는 곳에', '필요한 자료·파일 펴 두기', '물 준비', '지금 할 과제와 단계 확인'];
function checklistSet() {
  const c = settings().checklist || {};
  return { on: c.on !== false, items: Array.isArray(c.items) ? c.items : CL_DEFAULT };
}
function saveChecklist(C) { store.set('meta', 'settings', { checklist: { on: C.on, items: C.items } }); }
// 시작 동작 앞에 체크리스트를 띄움(끄면 바로 실행)
function gateStart(fn) {
  const C = checklistSet();
  if (C.on && C.items.length) { ui.checklist = { fn, checked: {} }; render(); }
  else fn();
}
function checklistOverlay() {
  if (!ui.checklist || mt.alarm || ui.alarms.length) return '';
  const C = checklistSet();
  return `<div class="alarm-ov" role="dialog" aria-label="시작 전 확인"><div class="alarm-box cl-box">
    <b>시작 전 확인</b>
    <ul class="cl-list">${C.items.map((it, i) => `<li><label class="check"><input type="checkbox" data-change="cl-check" data-i="${i}" ${ui.checklist.checked[i] ? 'checked' : ''}><span>${esc(it)}</span></label></li>`).join('')}</ul>
    <div class="btn-col"><button type="button" class="btn primary" data-action="cl-go">시작</button><button type="button" class="btn" data-action="cl-cancel">취소</button></div>
  </div></div>`;
}
function checklistCard() {
  const C = checklistSet();
  return `<article class="card">
    <div class="card-head"><h2>시작 체크리스트</h2></div>
    <label class="check"><input type="checkbox" data-cl="on" ${C.on ? 'checked' : ''}><span>시작할 때마다 체크리스트 띄우기 <small class="muted">(시작 타이머·타이머 탭·'타이머 없이 시작했어요')</small></span></label>
    <ul class="cl-edit">${C.items.map((it, i) => `<li><input data-cl="item" data-i="${i}" data-key="cl|${i}" value="${esc(it)}" maxlength="60" aria-label="체크리스트 항목"><button type="button" class="icon-btn sm" data-action="cl-del" data-i="${i}" aria-label="항목 삭제">×</button></li>`).join('')}</ul>
    <div class="add-row tight"><input id="cl-new" data-enter="cl-add" placeholder="항목 추가" maxlength="60" autocomplete="off" aria-label="체크리스트 항목 추가"><button type="button" class="btn sm" data-action="cl-add">추가</button></div>
  </article>`;
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
    .filter(inFilter)
    .filter(e => !(e.kind === 'tdue' && e.done))
    .filter(e => e.date >= s || (s === t && (e.kind === 'ms' || e.kind === 'tdue') && !e.done));
  if (!ev.length) return '';
  return `<article class="card">
    <div class="card-head"><h2>다가오는 일정</h2><span class="muted small">2주 이내</span></div>
    <ul class="ev-list">${ev.map(evItem).join('')}</ul>
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
  return layoutView([
    [dateHeader(fmtMDW(s), isToday ? '오늘' : relLabel(diffDays(t, s)), 'day', !isToday, '오늘로'), 'full'],
    [`<div class="streak-strip">
      <div><b>${st.cur}</b><span>일 연속 시작</span></div>
      <div><b>${st.best}</b><span>최장 기록</span></div>
      <div class="${st.todayDone ? 'ok' : ''}"><b>${st.todayDone ? '✓' : '–'}</b><span>오늘 시작</span></div>
    </div>`, 'side'],
    [areaFilterBar(), 'full'],
    [`<article class="card">
      <div class="card-head"><h2>${isToday ? (ui.pinView ? '상시 과제칸' : '오늘의 과제') : '이 날의 과제'}</h2><span class="head-right">${isToday ? pinChip() : ''}${r.focusMin ? `<span class="muted small">집중 ${r.focusMin}분</span>` : ''}${isToday && 'documentPictureInPicture' in window ? `<button class="chip-btn ${pipWin ? 'on' : ''}" data-action="mt-pip">${pipWin ? '미션 창 닫기' : '미션 창'}</button>` : ''}<span class="pill ${r.started ? 'on' : ''}">${r.started ? '시작함' : '시작 전'}</span></span></div>
      ${isToday && ui.pinView ? pinPanel() : taskBlock(s)}
    </article>`, 'main'],
    [curTodayCard(s), 'main'],
    [isToday
      ? timerCard(r)
      : `<article class="card slim"><label class="check"><input type="checkbox" data-bind="days|${s}|started" data-key="days|${s}|started" ${r.started ? 'checked' : ''}><span>이 날 시작한 것으로 표시</span></label></article>`, 'side'],
    [timelineCard(s), 'side'],
    [isToday ? `<article class="card">
      <div class="card-head"><h2>내일 과제 정하기</h2><span class="muted small">${fmtMDW(tomorrow)}</span></div>
      ${taskBlock(tomorrow)}
    </article>` : '', 'main'],
    [logCard(s), 'side'],
    [isToday ? goalsCard() : '', 'side'],
    [upcomingCard(s), 'side'],
    [weekGoalsMini(s), 'side'],
  ], 'day-view');
}

/* ───────── 주 화면 ───────── */
function viewWeek() {
  const ws = ui.week, we = addDays(ws, 6), t = todayStr();
  const curWs = weekStart(t), isCur = ws === curWs;
  const goals = store.data.weeks[ws]?.goals || [];
  const ev = eventsBetween(ws, we).filter(inFilter);
  const projects = activeProjects();
  const doneN = goals.filter(g => g.done).length;
  const n = Math.round(diffDays(curWs, ws) / 7);
  const rows = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i), r = dayRec(d), dayEv = ev.filter(e => e.date === d);
    const evText = dayEv.map(e => (e.kind === 'deadline' ? `${esc(e.project)} 마감` : e.kind === 'tdue' ? `${esc(e.title)} 마감` : esc(e.title))).join(' · ');
    // 이 날의 활동 시간(고정 일과는 매일 비슷하므로 빼고, 영역 거르기를 따름)
    const lg = getLogs(d), acts = dayRoutine(d).filter(b => isActivity(b) && inFilter(b));
    const actText = [...acts.map(b => `${esc(areaInfo(b.area).emoji)} ${esc(blockName(b))} ${esc(b.start)}${lg.some(l => l.rt === b.id) ? ' ✓' : ''}`),
      ...curOnDate(d).map(({ l }) => `📘 ${esc(l.text)}${l.done === d ? ' ✓' : ''}`)].join(' · ');
    return `<li><button class="day-row ${d === t ? 'today' : ''}" data-action="goto-day" data-date="${d}">
      <span class="dr-date"><b>${DOW[parse(d).getDay()]}</b>${parse(d).getDate()}</span>
      <span class="dr-main">${miniTasks(d)}${actText ? `<small class="dr-acts">${actText}</small>` : ''}${evText ? `<small>${evText}</small>` : ''}</span>
      <span class="dr-side">${r.focusMin ? `<small class="muted">${r.focusMin}분</small>` : ''}<i class="dot ${r.started ? 'on' : d < t ? 'miss' : ''}" title="${r.started ? '시작함' : ''}"></i></span>
    </button></li>`;
  }).join('');
  return layoutView([
    [dateHeader(`${fmtMD(ws)} – ${fmtMD(we)}`, isCur ? '이번 주' : `${Math.abs(n)}주 ${n < 0 ? '전' : '후'}`, 'week', !isCur, '이번 주로'), 'full'],
    [areaFilterBar(), 'full'],
    [`<article class="card">
      <div class="card-head"><h2>이 주에 끝낼 결과물</h2>${goals.length ? `<span class="muted small">${doneN}/${goals.length}</span>` : ''}</div>
      ${goals.length ? `<ul class="goal-list">${goals.map(g => goalItem(ws, g, true)).join('')}</ul>` : `<p class="muted small">한 주에 한두 개면 충분합니다.</p>`}
      <div class="add-row">
        <input id="goal-new" data-enter="goal-add" placeholder="예: 실험 방법 초안 완성" maxlength="120" autocomplete="off">
        ${projects.length ? `<select id="goal-proj" aria-label="프로젝트 연결"><option value="">연결 안 함</option>${projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>` : ''}
        <button class="btn primary" data-action="goal-add">추가</button>
      </div>
    </article>`, 'side'],
    [ev.length ? `<article class="card">
      <div class="card-head"><h2>마감 일정</h2><span class="muted small">과제 마감·프로젝트</span></div>
      <ul class="ev-list">${ev.map(evItem).join('')}</ul>
    </article>` : '', 'side'],
    [`<article class="card">
      <div class="card-head"><h2>요일별 과제</h2></div>
      <ul class="day-rows">${rows}</ul>
    </article>`, 'main'],
  ], 'week-view');
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
    cells += `<button class="cal-cell ${started ? 'started' : ''} ${ds === t ? 'today' : ''} ${ds > t ? 'future' : ''}" data-action="goto-day" data-date="${ds}" aria-label="${m}월 ${d}일${started ? ', 시작함' : ''}"><span class="n">${d}</span>${getTasks(ds).length ? `<span class="cal-tasks">${getTasks(ds).map(x => `<i class="${x.done ? 'done' : ''}">${esc(x.text)}</i>`).join('')}</span>` : ''}${marks}</button>`;
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
      <div class="cal-legend"><span><i class="lg lg-start"></i>시작한 날</span><span><i class="lg lg-ms"></i>중간 지점</span><span><i class="lg lg-dl"></i>마감</span></div>
    </article>
    ${monthTaskList(first, last)}
    ${ev.length ? `<article class="card"><div class="card-head"><h2>이 달의 일정</h2></div><ul class="ev-list">${ev.map(evItem).join('')}</ul></article>` : ''}
  </section>`;
}

/* ───────── 프로젝트 화면 (예전 '장기 과제') ───────── */
function newProjectForm() {
  const t = todayStr();
  return `<article class="card">
    <div class="card-head"><h2>새 프로젝트</h2></div>
    <div class="fields">
      <label class="field"><span>이름</span><input id="np-name" placeholder="예: 화학 IA, 소설 개정, 작곡 공부" maxlength="80" autocomplete="off"></label>
      <label class="field"><span>영역</span><select id="np-area">${areaOptions(defaultArea())}</select></label>
      <div class="field-row">
        <label class="field"><span>시작일</span><input id="np-start" type="date" value="${t}"></label>
        <label class="field"><span>공식 마감 (선택)</span><input id="np-deadline" type="date"></label>
      </div>
      <label class="field"><span>여유 기간 — 마감 며칠 전까지 끝낼지(마감이 있을 때)</span><input id="np-buffer" type="number" min="0" max="60" value="3" inputmode="numeric"></label>
      <label class="field"><span>단계 — 한 줄에 하나씩, 순서대로</span><textarea id="np-steps" rows="5" placeholder="${esc(DEFAULT_STEPS.join('\n'))}"></textarea></label>
    </div>
    <p class="muted small">마감이 있으면 단계를 시작일부터 '공식 마감 − 여유 기간'까지 고르게 나눠 배치합니다(단계를 비워 두면 기본 단계). 마감이 없으면 단계를 날짜 없이 순서대로 두고, 필요할 때 날짜를 직접 넣을 수 있습니다.</p>
    <div class="btn-row"><button class="btn primary" data-action="proj-create">만들기</button><button class="btn" data-action="proj-cancel">취소</button></div>
  </article>`;
}

function projectDetail(p, ms) {
  const t = todayStr();
  const b = f => `data-bind="projects|${p.id}|${f}" data-key="projects|${p.id}|${f}"`;
  return `<div class="proj-detail">
    <ul class="ms-list">${ms.map(m => `
      <li class="ms ${m.done ? 'done' : ''} ${!m.done && m.due && m.due < t ? 'late' : ''}">
        <input type="checkbox" data-change="ms-toggle" data-p="${p.id}" data-m="${m.id}" ${m.done ? 'checked' : ''} aria-label="${esc(m.title)} 완료">
        <input class="ms-title" data-change="ms-title" data-p="${p.id}" data-m="${m.id}" data-key="mst|${m.id}" value="${esc(m.title)}" maxlength="80" aria-label="단계 이름">
        <input class="ms-due" type="date" data-change="ms-due" data-p="${p.id}" data-m="${m.id}" data-key="msd|${m.id}" value="${m.due || ''}" aria-label="단계 날짜">
        <button class="icon-btn sm" data-action="ms-del" data-p="${p.id}" data-m="${m.id}" aria-label="단계 삭제">×</button>
      </li>`).join('')}
    </ul>
    <div class="add-row">
      <input id="ms-new-${p.id}" data-enter="ms-add" data-p="${p.id}" placeholder="단계 추가" maxlength="80" autocomplete="off">
      <input id="ms-new-date-${p.id}" type="date" value="${p.deadline ? addDays(p.deadline, -Number(p.buffer ?? 3)) : ''}" aria-label="새 단계 날짜 (선택)">
      <button class="btn" data-action="ms-add" data-p="${p.id}">추가</button>
    </div>
    <div class="fields two">
      <label class="field"><span>이름</span><input ${b('name')} value="${esc(p.name)}" maxlength="80"></label>
      <label class="field"><span>영역</span><select data-change="parea" data-id="${p.id}" data-key="pa|${p.id}">${areaOptions(itemArea(p))}</select></label>
      <label class="field"><span>공식 마감 (선택)</span><input type="date" ${b('deadline')} value="${p.deadline || ''}"></label>
      <label class="field"><span>여유 기간(일)</span><input type="number" min="0" max="60" inputmode="numeric" ${b('buffer')} value="${p.buffer ?? 3}"></label>
    </div>
    <div class="btn-row wrap">
      ${p.deadline ? `<button class="btn" data-action="proj-redistribute" data-id="${p.id}">남은 단계 다시 역산</button>` : ''}
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
      <span class="proj-title"><b>${esc(p.name)}</b><small>${areaTag(p)} ${p.deadline ? `${fmtMD(p.deadline)} 마감 · ${dday(p.deadline)}` : '마감 없음'}</small></span>
      <span class="proj-count">${done}/${ms.length}<i class="chev">${open ? '−' : '+'}</i></span>
    </button>
    <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    ${next
      ? `<p class="proj-next ${next.due && next.due < t ? 'late' : ''}">다음: ${esc(next.title)}${next.due ? ` · ${fmtMD(next.due)} (${next.due < t ? '지남' : dday(next.due)})` : ''}</p>`
      : ms.length ? `<p class="proj-next ok">모든 단계를 끝냈습니다</p>` : '<p class="proj-next">단계가 없습니다</p>'}
    ${open ? projectDetail(p, ms) : ''}
  </article>`;
}

function viewProjects() {
  const all = projectList().filter(inFilter), active = all.filter(p => !p.archived), archived = all.filter(p => p.archived);
  const empty = `<article class="card"><p class="muted">${areaFilter() ? '이 영역에 프로젝트가 없습니다.' : '아직 프로젝트가 없습니다.'} IA나 EE처럼 마감이 있는 것은 마감에서 거꾸로 중간 지점을 잡아 오늘·주·달 화면에 표시하고, 소설 개정이나 작곡 공부처럼 마감이 없는 것도 단계로 나눠 관리할 수 있습니다.</p></article>`;
  return `<section class="view">
    <header class="vhead plain">
      <div class="vtitle"><h1>프로젝트</h1><span class="sub">단계로 나누고, 마감이 있으면 거꾸로 중간 지점을 잡습니다</span></div>
      ${ui.newProject ? '' : `<button class="btn primary" data-action="proj-new">새 프로젝트</button>`}
    </header>
    ${areaFilterBar()}
    ${ui.newProject ? newProjectForm() : ''}
    ${active.length ? `<div class="proj-grid">${active.map(projectCard).join('')}</div>` : ui.newProject ? '' : empty}
    ${archived.length ? `<button class="link-btn" data-action="toggle-archived">${ui.showArchived ? '보관함 접기' : `보관된 프로젝트 ${archived.length}개 보기`}</button>
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
    <p><b>${o.min}분</b> 집중했습니다. ${o.date === todayStr() ? '오늘' : fmtMD(o.date)} 기록에 넣을까요?</p>
    <label class="field inline"><span>영역</span><select id="offer-area">${areaOptions(mtArea())}</select></label>
    <div class="btn-row tight"><button class="btn primary" data-action="mt-record">기록</button><button class="btn" data-action="mt-norecord">기록 안 함</button></div>
  </article>`;
}

function trackStatus(t) {
  if (cachedIds.has(t.id)) return !t.driveId && t.origin === deviceId && gcal.available ? { cls: 'up', txt: '드라이브에 올리기 전' } : null;
  return t.driveId ? { cls: 'cloud', txt: '드라이브에만 있음' } : { cls: 'away', txt: '다른 기기에서 아직 안 올림' };
}

function musicCard() {
  const open = ui.musicOpen, m = musicMeta(), pls = libPlaylists(), pl = openPl();
  const head = `<button class="music-head" data-action="music-open" aria-expanded="${open}"><span aria-hidden="true">🎵</span><b>음악</b><span class="muted small">${pls.length ? `플리 ${pls.length}개` : '플리 없음'}${study.playing ? ' · 집중 플리 재생 중' : preview.playing ? ' · 듣는 중' : ''}</span><i class="chev">${open ? '−' : '+'}</i></button>`;
  if (!open) return `<article class="card music">${head}</article>`;
  const opt = (sel, none) => `<option value="">${none}</option>${pls.map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const roles = `<div class="pl-roles">
      <label class="field inline"><span>집중할 때</span><select data-change="pl-role" data-role="studyPl" data-key="pl-role|studyPl" aria-label="집중할 때 틀 플리">${opt(m.studyPl, '안 틀기')}</select></label>
      <label class="field inline"><span>집중 타이머 종료</span><select data-change="pl-role" data-role="alarmPl" data-key="pl-role|alarmPl" aria-label="집중 타이머가 끝날 때 울릴 플리">${opt(m.alarmPl, '기본 알림음')}</select></label>
      <label class="field inline"><span>알람 타이머 종료</span><select data-change="pl-role" data-role="alarm2Pl" data-key="pl-role|alarm2Pl" aria-label="알람 타이머가 끝날 때 울릴 플리">${opt(m.alarm2Pl, '기본 알림음')}</select></label>
    </div>`;
  const w = driveWork(), pending = w.up.length || w.down.length || w.del.length;
  const driveLine = !gcal.available
    ? `<p class="muted small">구글 연결 설정 전이라 음악 파일은 이 기기에만 저장됩니다.</p>`
    : `<div class="drive-line"><span class="muted small">☁ ${driveBusy ? esc(ui.musicProgress || '드라이브와 주고받는 중…')
        : pending ? [w.up.length && `올릴 곡 ${w.up.length}`, w.down.length && `받을 곡 ${w.down.length}`, w.del.length && `정리할 파일 ${w.del.length}`].filter(Boolean).join(' · ')
        : '모든 기기와 맞춰져 있음'}</span>${pending && !driveBusy ? `<button type="button" class="btn sm" data-action="drive-sync">${gcal.hasScope(DRIVE_SCOPE) ? '지금 주고받기' : '드라이브 연결'}</button>` : ''}</div>`;
  const chips = `<div class="pl-chips">${pls.map(p => `<button type="button" class="pl-chip ${pl && p.id === pl.id ? 'on' : ''}" data-action="pl-open" data-pl="${p.id}">${esc(p.name)}${p.id === m.studyPl ? '<small>집중</small>' : ''}${p.id === m.alarmPl ? '<small>집중 종료</small>' : ''}${p.id === m.alarm2Pl ? '<small>알람 종료</small>' : ''}</button>`).join('')}</div>
    <div class="add-row tight"><input id="pl-new-name" data-enter="pl-new" placeholder="새 플리 이름" maxlength="40" autocomplete="off" aria-label="새 플리 이름"><button type="button" class="btn sm" data-action="pl-new">플리 만들기</button></div>`;
  if (!pl) {
    return `<article class="card music">${head}<div class="music-body">${roles}${driveLine}${chips}
      <p class="muted small">플리를 만들고 곡을 추가하세요. 만든 플리는 '집중할 때', '집중 타이머 종료', '알람 타이머 종료'에 골라 쓸 수 있고, 모든 기기에서 같은 플리를 씁니다.</p></div></article>`;
  }
  const P = uiPlayer(), isStudy = pl.id === m.studyPl, locked = isStudy && !studyActive();
  const items = (pl.items || []).map(id => trackById(id)).filter(Boolean);
  const missing = items.filter(t => !cachedIds.has(t.id) && t.driveId).length;
  const rows = items.map((t, i) => {
    const st = trackStatus(t), pi = P.list.findIndex(x => x.id === t.id);
    return `<li class="track ${P.list[P.cur]?.id === t.id ? 'active' : ''} ${cachedIds.has(t.id) ? '' : 'absent'}" data-sort-id="${t.id}">
      <button class="drag-handle" type="button" aria-label="끌어서 순서 바꾸기">${GRIP}</button><span class="tn">${i + 1}</span>
      <span class="tname" title="${esc(t.name)}">${esc(t.name)}${st ? `<small class="tstat ${st.cls}">${st.txt}</small>` : ''}</span>
      <span class="tbtns">
        <button class="icon-btn sm" data-action="mp-play" data-i="${pi}" ${pi < 0 || locked ? 'disabled' : ''} aria-label="재생">▶</button>
        <button class="icon-btn sm" data-action="pl-remove" data-pl="${pl.id}" data-t="${t.id}" aria-label="플리에서 빼기">×</button>
      </span></li>`;
  }).join('');
  const inPl = new Set(pl.items || []), others = libTracks().filter(t => !inPl.has(t.id));
  const pick = ui.libPick ? `<div class="lib-pick"><b>전체 곡에서 추가</b>${others.length
    ? `<ul>${others.map(t => `<li><span>${esc(t.name)}</span><button type="button" class="btn sm" data-action="pl-add-track" data-pl="${pl.id}" data-t="${t.id}">추가</button></li>`).join('')}</ul>`
    : '<p class="muted small">더 추가할 곡이 없습니다.</p>'}</div>` : '';
  const all = libTracks();
  return `<article class="card music">${head}<div class="music-body">
    ${roles}${driveLine}${chips}
    <div class="pl-panel">
      <div class="pl-head">
        <input data-change="pl-name" data-pl="${pl.id}" data-key="pl-name|${pl.id}" value="${esc(pl.name)}" maxlength="40" aria-label="플리 이름">
        <button type="button" class="btn sm" data-action="pl-repeat" data-pl="${pl.id}">${pl.repeat !== false ? '반복 켜짐' : '반복 꺼짐'}</button>
        <button type="button" class="btn sm danger" data-action="pl-del" data-pl="${pl.id}">플리 삭제</button>
      </div>
      ${isStudy ? '<p class="muted small">집중할 때 쓰는 플리라 집중 타이머나 시작 타이머가 돌 때만 재생되고, 멈추면 같이 멈춥니다. 알람 타이머와는 상관없습니다.</p>' : ''}
      <div class="btn-row tight wrap">
        <label class="btn sm file-btn">+ 파일 추가<input type="file" id="pl-file" data-pl="${pl.id}" accept="audio/*" multiple hidden></label>
        <button type="button" class="btn sm ${ui.libPick ? 'primary' : ''}" data-action="lib-pick">+ 전체 곡에서</button>
        ${missing ? `<button type="button" class="btn sm" data-action="pl-keep" data-pl="${pl.id}">이 기기에 받기 (${missing}곡)</button>` : ''}
      </div>
      ${pick}
      ${items.length ? `<ul class="track-list" data-sortable="pl" data-pl="${pl.id}">${rows}</ul>` : '<p class="muted small">아직 곡이 없습니다.</p>'}
      ${P.list.length ? `<div class="player">
        <div class="player-btns">
          <button class="round-btn sm" data-action="mp-prev" ${locked ? 'disabled' : ''} aria-label="이전 곡">⏮</button>
          <button class="round-btn main sm" data-action="mp-toggle" ${locked ? 'disabled' : ''} aria-label="재생/일시정지">${P.playing ? ICON_PAUSE : ICON_PLAY}</button>
          <button class="round-btn sm" data-action="mp-next" ${locked ? 'disabled' : ''} aria-label="다음 곡">⏭</button>
        </div>
        <div class="now">${locked ? '집중 타이머가 돌 때 재생됩니다' : P.cur >= 0 && P.list[P.cur] ? esc(P.list[P.cur].name) : '트랙 없음'}</div>
        <input type="range" id="mp-seek" min="0" max="1000" value="0" aria-label="재생 위치">
        <div class="time-row"><span id="mp-cur">0:00</span><span id="mp-dur">0:00</span></div>
      </div>` : ''}
    </div>
    <button type="button" class="link-btn" data-action="lib-all">${ui.libAll ? '전체 곡 접기' : `전체 곡 ${all.length}개 관리`}</button>
    ${ui.libAll ? `<div class="lib-all">${all.length ? `<ul>${all.map(t => `<li><span>${esc(t.name)}<small class="muted"> · ${fmtSize(t.size)}${cachedIds.has(t.id) ? '' : ' · 이 기기에 없음'}</small></span><button type="button" class="btn sm danger" data-action="track-del" data-t="${t.id}">완전히 삭제</button></li>`).join('')}</ul>` : ''}
      <p class="muted small">플리에서 빼도 곡은 여기 남습니다. '완전히 삭제'하면 모든 플리와 드라이브, 각 기기에서 지워집니다. 올린 음악은 이 계정의 기기들에서만 쓰입니다.</p></div>` : ''}
  </div></article>`;
}

// 집중 타이머(mt)와 알람 타이머(atm)는 같은 모양을 씀. 집중 타이머의 id(mt-…)는 예전 그대로
function timerFace(kind) {
  const S = kind === 'study', st = S ? mt : atm, pre = S ? 'mt' : 'at';
  const run = S ? mtRunning() : atRunning(), rem = S ? mtRemain() : atRemain(), ratio = st.totalMs > 0 ? rem / st.totalMs : 0;
  const set = Math.round(st.setMs / 1000), h = Math.floor(set / 3600), m = Math.floor((set % 3600) / 60), s = set % 60;
  const fields = [['h', h, 23, '시간'], ['m', m, 59, '분'], ['s', s, 59, '초']]
    .map(([k, v, max, lb], i) => `${i ? '<span class="mt-colon">:</span>' : ''}<label class="mt-in"><input id="${pre}-${k}" type="number" inputmode="numeric" min="0" max="${max}" value="${v}" ${run ? 'disabled' : ''} data-${pre}-input aria-label="${lb}"><span>${lb}</span></label>`).join('');
  return `<div class="mt-ring-wrap">
        <svg class="mt-ring" viewBox="0 0 256 256" aria-hidden="true">
          <circle class="mt-track" cx="128" cy="128" r="${MT_R}"/>
          <circle id="${pre}-ring" class="mt-prog ${st.status === 'done' ? 'done' : ''}" cx="128" cy="128" r="${MT_R}" stroke-dasharray="${MT_C.toFixed(2)}" style="stroke-dashoffset:${(MT_C * (1 - ratio)).toFixed(2)}"/>
        </svg>
        <div class="mt-center"><span id="${pre}-display" class="mt-num">${fmtClock(rem)}</span><span id="${pre}-label" class="mt-label">${MT_LABEL[st.status]}</span></div>
      </div>
      <div class="mt-inputs ${run ? 'dim' : ''}">${fields}</div>
      <div class="mt-presets">${[[1, '+1분'], [5, '+5분'], [10, '+10분'], [30, '+30분'], [60, '+1시간']].map(([n, l]) => `<button class="chip-btn" data-action="${pre}-preset" data-min="${n}">${l}</button>`).join('')}</div>
      <div class="mt-controls">
        <button class="round-btn" data-action="${pre}-reset" aria-label="리셋">${ICON_RESET}</button>
        <button class="round-btn main" data-action="${pre}-toggle" aria-label="${run ? '일시정지' : '시작'}">${run ? ICON_PAUSE : ICON_PLAY}</button>
        <button class="round-btn" data-action="${pre}-add" aria-label="1분 추가">+1m</button>
      </div>
      ${run && calConnected() ? `<p class="muted small center">${st.calEventId ? '📅 끝나는 시각을 캘린더에도 넣었습니다.' : '📅 캘린더 연결이 만료돼 앱 알람만 울립니다.'}</p>` : ''}`;
}

function viewTimer() {
  const task = topTask(todayStr())?.text, tab = ui.timerTab === 'alarm' ? 'alarm' : 'study';
  const pipOk = 'documentPictureInPicture' in window;
  const a2 = plById(musicMeta().alarm2Pl);
  const segBtn = (t, label, running, rem, id) => `<button type="button" class="${tab === t ? 'on' : ''}" data-action="timer-tab" data-t="${t}" role="tab" aria-selected="${tab === t}">${label}${running ? ` <span id="${id}" class="seg-time">${fmtClock(rem)}</span>` : ''}</button>`;
  return layoutView([[`<header class="vhead plain">
      <div class="vtitle"><h1>타이머</h1><span class="sub">${task ? `오늘: ${esc(task)}` : '오늘 과제를 정하면 여기와 미션 창에 표시됩니다'}</span></div>
      ${pipOk ? `<button class="btn ${pipWin ? 'primary' : ''}" data-action="mt-pip">${pipWin ? '미션 창 닫기' : '미션 창'}</button>` : ''}
    </header>`, 'full'], [`<div class="seg timer-seg" role="tablist" aria-label="타이머 종류">
      ${segBtn('study', '🎯 집중', mtRunning(), mtRemain(), 'mt-seg')}
      ${segBtn('alarm', '⏰ 알람', atRunning(), atRemain(), 'at-seg')}
    </div>
    ${tab === 'study' ? `${mt.offer ? offerCard() : ''}
    <article class="card mt-card">
      <label class="field inline mt-area"><span>영역</span><select data-change="mt-area" data-key="mt-area" aria-label="집중 타이머 영역">${areaOptions(mtArea())}</select></label>
      ${timerFace('study')}
    </article>` : `<article class="card mt-card at-card">
      ${timerFace('alarm')}
      <p class="muted small center">집중 시간 기록·집중 플리 없이 시간만 잽니다. 끝나면 ${a2 ? `'${esc(a2.name)}' 플리가` : '기본 알림음이'} 울립니다.</p>
    </article>`}`, 'main'], [musicCard(), 'side']], 'timer-view');
}

function atAlarmOverlay() {
  if (mt.alarm || !atm.alarm) return '';
  return `<div class="alarm-ov" role="alertdialog" aria-label="알람 타이머 종료"><div class="alarm-box">
    <div class="alarm-icon" aria-hidden="true">⏰</div>
    <b>알람 타이머 종료</b>
    <p class="muted">${fmtDurMs(atm.totalMs)} 알람 타이머가 끝났습니다.</p>
    <div class="btn-col"><button class="btn primary" data-action="at-dismiss">확인</button>${atm.setMs > 0 ? `<button class="btn" data-action="at-again">${fmtDurMs(atm.setMs)} 다시 시작</button>` : ''}</div>
  </div></div>`;
}

function alarmOverlay() {
  if (!mt.alarm) return '';
  const min = Math.round(mtSession() / 60000);
  return `<div class="alarm-ov" role="alertdialog" aria-label="집중 타이머 종료"><div class="alarm-box">
    <div class="alarm-icon" aria-hidden="true">⏰</div>
    <b>집중 타이머 종료</b>
    ${min >= 1
      ? `<p class="muted">이번에 ${min}분 집중했습니다. 기록에 넣을까요?</p>
         <label class="field inline ov-area"><span>영역</span><select id="ov-area">${areaOptions(mtArea())}</select></label>
         <div class="btn-col"><button class="btn primary" data-action="mt-dismiss" data-rec="1">기록하고 닫기</button><button class="btn" data-action="mt-dismiss" data-rec="0">기록 없이 닫기</button></div>`
      : `<div class="btn-col"><button class="btn primary" data-action="mt-dismiss" data-rec="0">확인</button></div>`}
  </div></div>`;
}

function appAlarmOverlay() {
  if (mt.alarm || atm.alarm || !ui.alarms.length) return '';
  return `<div class="alarm-ov" role="alertdialog" aria-label="알림"><div class="alarm-box">
    <div class="alarm-icon" aria-hidden="true">⏰</div>
    <ul class="alarm-list">${ui.alarms.map(a => `<li><b>${esc(a.title)}</b>${a.body ? `<span>${esc(a.body)}</span>` : ''}<small class="muted">${hmOf(a.at)}</small></li>`).join('')}</ul>
    <div class="btn-col"><button class="btn primary" data-action="alarm-ok">확인</button></div>
  </div></div>`;
}

function calChip() {
  if (!calConnected()) return '';
  if (calBusy) return `<span class="badge cal pend" title="캘린더에 반영하는 중">📅 …</span>`;
  const n = calPending();
  return n ? `<button class="badge cal" data-action="cal-sync" title="캘린더에 반영할 변경 ${n}건 · 눌러서 보내기" aria-label="캘린더에 반영할 변경 ${n}건, 눌러서 보내기">📅 ${n}</button>` : '';
}

function alarmCard() {
  const A = alarmSet();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const permText = { granted: '허용됨', denied: '차단됨(브라우저 설정에서 허용해 주세요)', default: '아직 묻지 않음', unsupported: '이 브라우저는 알림을 지원하지 않습니다(아이패드·아이폰은 홈 화면에 설치한 앱에서 지원)' }[perm];
  const row = (k, label) => `<div class="alarm-row">
      <label class="check"><input type="checkbox" data-alarm="${k}.on" ${A[k].on ? 'checked' : ''}><span>${label}</span></label>
      <input type="time" data-alarm="${k}.time" data-key="alarm|${k}" value="${esc(A[k].time)}" aria-label="${label} 시각">
    </div>`;
  return `<article class="card">
    <div class="card-head"><h2>알림</h2></div>
    <p class="muted small">과제마다 '알림 시각'을 정할 수 있고, 과제 마감일과 프로젝트의 중간 지점·공식 마감은 아래 시각에 알려 줍니다. 앱 안 알람은 앱이 열려 있을 때 울리고, 구글 캘린더를 연결하면 앱이 꺼져 있거나 오프라인이어도 캘린더 앱이 알려 줍니다.</p>
    <div class="alarm-rows">${row('dayBefore', '마감·중간 지점 전날')}${row('sameDay', '마감·중간 지점 당일')}</div>
    <div class="fields">
      <label class="check"><input type="checkbox" data-alarm="appSound" ${A.appSound ? 'checked' : ''}><span>앱 안 알람 소리</span></label>
      <label class="check"><input type="checkbox" data-alarm="wakeLock" ${A.wakeLock ? 'checked' : ''}><span>타이머 실행 중 화면 켜 두기 <small class="muted">(화면이 꺼지면 앱 알람이 멈출 수 있어서)</small></span></label>
    </div>
    <div class="perm-row"><span class="muted small">이 기기의 알림 권한: ${permText}</span>${perm === 'default' ? `<button class="btn sm" data-action="ask-notify">알림 허용</button>` : ''}</div>
  </article>`;
}

// 상시 연결(Apps Script) 설정 안내
function bridgeSetup() {
  const m = calMeta(), secret = m.bridgeSecret;
  return `<div class="bridge">
    <h3>상시 연결 <small class="muted">권장</small></h3>
    <p class="muted small">브라우저가 받는 구글 권한은 1시간 정도면 만료돼서 다시 눌러야 합니다. 개인 구글 계정에 Apps Script를 한 번 만들어 두면, 그 스크립트가 계정 권한으로 대신 반영해서 어느 기기에서든 로그인 없이 자동으로 맞춰집니다. 처음 설정은 키보드가 있는 크롬북에서 하는 것이 편합니다.</p>
    <ol class="bridge-steps">
      <li><button class="btn sm" data-action="bridge-copy">코드 복사</button> <span class="muted small">비밀 값이 들어 있으니 다른 사람에게 보여 주지 마세요.</span></li>
      <li><a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com에서 새 프로젝트</a>를 열고, 원래 있던 내용을 모두 지운 뒤 붙여 넣고 저장(💾)합니다.</li>
      <li>왼쪽 <b>서비스</b> 옆 <b>+</b>를 눌러 <b>Google Calendar API</b>를 추가하고 저장합니다. 이걸 해야 스크립트가 캘린더 API를 쓸 수 있습니다.</li>
      <li>위쪽 함수 목록에서 <b>setup</b>을 고르고 <b>실행</b> → 권한 검토 → 계정 선택 → '고급' → '…(으)로 이동(안전하지 않음)' → 허용. 직접 만든 스크립트라 확인되지 않은 앱으로 표시됩니다.</li>
      <li><b>배포 → 새 배포</b> → 유형 선택(톱니)에서 <b>웹 앱</b> → 다음 사용자 인증 정보로 실행: <b>나</b>, 액세스 권한이 있는 사용자: <b>모든 사용자</b> → 배포 → 나온 <b>웹 앱 URL</b>을 복사합니다.</li>
      <li>아래 칸에 붙여 넣고 연결 확인을 누릅니다.</li>
    </ol>
    <div class="add-row"><input id="bridge-url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" aria-label="웹 앱 URL"><button class="btn primary" data-action="bridge-test" ${calBusy ? 'disabled' : ''}>연결 확인</button></div>
    ${secret ? `<details class="bridge-code" ${ui.bridgeShow ? 'open' : ''}><summary class="small">코드 직접 보기</summary><textarea readonly rows="8" aria-label="Apps Script 코드">${esc(scriptCode(secret))}</textarea></details>` : ''}
  </div>`;
}

function calendarCard() {
  const head = s => `<div class="card-head"><h2>구글 캘린더</h2><span class="muted small">${s}</span></div>`;
  const m = calMeta(), b = bridge(), n = calPending();
  const last = m.syncedAt ? ` 마지막 반영: ${fmtMD(ymd(new Date(m.syncedAt)))} ${hmOf(m.syncedAt)}` : '';
  if (b) {
    const status = calBusy ? '반영 중…' : calError ? '반영 실패' : n ? `반영 대기 ${n}건` : '최신 상태';
    return `<article class="card">${head(status)}
      <p class="muted small">상시 연결됨(Apps Script). 알림이 필요한 일정을 '${esc(BASE_TITLE)}' 캘린더에 로그인 없이 자동으로 반영합니다.${last}</p>
      ${calError ? `<p class="warn-line small">${esc(calError)}</p>` : ''}
      <div class="btn-row wrap"><button class="btn" data-action="cal-sync" ${calBusy ? 'disabled' : ''}>지금 반영</button><button class="btn" data-action="bridge-copy">코드 다시 복사</button><button class="btn danger" data-action="bridge-off">상시 연결 끊기</button></div>
      ${ui.bridgeShow && m.bridgeSecret ? `<details class="bridge-code" open><summary class="small">코드 직접 보기</summary><textarea readonly rows="8" aria-label="Apps Script 코드">${esc(scriptCode(m.bridgeSecret))}</textarea></details>` : ''}
    </article>`;
  }
  if (!gcal.available) return `<article class="card">${head('연결 안 됨')}${bridgeSetup()}</article>`;
  if (!m.calendarId) {
    return `<article class="card">${head('연결 안 됨')}
      <p class="muted small">연결하면 구글 캘린더에 '${esc(BASE_TITLE)}' 캘린더를 만들고, 알림이 필요한 일정을 자동으로 넣습니다. 플래너가 만든 캘린더만 다루고, 원래 쓰던 일정에는 손대지 않습니다.</p>
      ${bridgeSetup()}
      <p class="muted small">상시 연결 없이 지금 기기에서만 잠깐 연결하려면: <button class="link-btn" data-action="cal-sync">구글 로그인으로 연결</button></p></article>`;
  }
  const status = calBusy ? '반영 중…' : n ? `반영 대기 ${n}건` : '최신 상태';
  return `<article class="card">${head(status)}
    <p class="muted small">'${esc(BASE_TITLE)}' 캘린더에 알림 일정을 넣고 있습니다.${last}</p>
    <p class="muted small">지금은 구글 로그인 권한으로 연결돼 있어 1시간 정도면 만료됩니다. 만료된 뒤 바뀐 내용이 있으면 상단에 📅 표시가 뜨고, 누르면 반영됩니다.${gcal.hasScope(CAL_SCOPE) ? ' 지금은 연결이 살아 있어 자동으로 반영됩니다.' : ''}</p>
    <div class="btn-row wrap"><button class="btn" data-action="cal-sync" ${calBusy ? 'disabled' : ''}>지금 반영</button><button class="btn danger" data-action="cal-disconnect">연결 해제</button></div>
    ${bridgeSetup()}
  </article>`;
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
  const same = p => custom && COLOR_KEYS.every(k => JSON.stringify(p[k]) === JSON.stringify({ r: th[k].r, g: th[k].g, b: th[k].b }));
  const group = (g, title) => `<h3 class="ce-group">${title}</h3><div class="color-editors">${COLOR_DEFS.filter(d => d.group === g).map(d => colorEditor(d, th[d.id])).join('')}</div>`;
  return `<article class="card">
    <div class="card-head"><h2>색상</h2><span class="muted small">${custom ? '직접 지정' : '기기 설정 따라감'}</span></div>
    <div class="theme-row">${PRESETS.map(p => `<button class="theme-chip ${same(p) ? 'active' : ''}" data-action="theme-preset" data-id="${p.id}" style="--c-bg:${rgb(p.bg)};--c-ac:${rgb(p.accent)}"><i></i><span>${p.label}</span></button>`).join('')}</div>
    ${group('base', '기본 색')}
    ${group('mark', '표시 색')}
    ${custom ? `<div class="btn-row"><button class="btn" data-action="theme-auto">기본값(라이트·다크 자동)으로 되돌리기</button></div>` : ''}
    <p class="muted small">플래너·타이머·미션 창 전체에 적용되고, 같은 계정으로 로그인한 기기에도 동기화됩니다.</p>
  </article>`;
}

/* ───────── 설정 화면 ───────── */
function viewSettings() {
  const s = store.status;
  const local = s.mode === 'cloud' ? store.localBackup() : null;
  const hasLocal = !!local && Object.values(local).some(c => c && Object.keys(c).length);
  return layoutView([
    ['<header class="vhead plain"><div class="vtitle"><h1>설정</h1></div></header>', 'full'],
    [`<article class="card">
      <div class="card-head"><h2>계정과 동기화</h2>${syncBadge('sync-badge-2')}</div>
      ${s.mode === 'cloud'
        ? `<p class="account">${esc(s.user?.email || '')}</p>
           <p class="muted small">같은 계정으로 로그인한 모든 기기에서 기록이 이어집니다. 오프라인에서 입력한 내용은 기기에 저장해 두었다가 연결되면 올립니다.</p>
           <div class="btn-row"><button class="btn" data-action="logout">로그아웃</button></div>`
        : `<p class="muted small">Firebase 설정 전이라 이 기기에만 저장됩니다. 설정 안내(README)의 단계를 마치면 기기 간 연동이 켜지고, 그때 이 기기의 기록을 계정으로 옮길 수 있습니다.</p>`}
    </article>`, 'main'],
    [`<article class="card">
      <div class="card-head"><h2>과제</h2></div>
      <label class="check"><input type="checkbox" data-bind="meta|settings|autoCarry" data-key="meta|settings|autoCarry" ${settings().autoCarry === false ? '' : 'checked'}><span>못 끝낸 과제를 다음 날로 자동으로 넘기기 <small class="muted">(앱을 열 때 지난날 남은 과제를 오늘 목록 맨 아래로 옮김)</small></span></label>
    </article>`, 'main'],
    [areasCard(), 'main'],
    [routineCard(), 'main'],
    [checklistCard(), 'main'],
    [`<article class="card">
      <div class="card-head"><h2>오늘 화면의 시작 타이머</h2></div>
      <label class="field inline"><span>시작 타이머 길이(분)</span><input type="number" min="1" max="120" inputmode="numeric" data-bind="meta|settings|timerMin" data-key="meta|settings|timerMin" value="${timerMin()}"></label>
    </article>`, 'main'],
    [alarmCard(), 'side'],
    [calendarCard(), 'side'],
    [colorCard(), 'side'],
    [`<article class="card">
      <div class="card-head"><h2>데이터</h2></div>
      <div class="btn-row wrap tight">
        <button class="btn" data-action="export">백업 파일 내보내기</button>
        <label class="btn file-btn">백업에서 되살리기<input type="file" id="restore-file" accept=".json,application/json" hidden></label>
        ${hasLocal ? `<button class="btn" data-action="import-local">이 기기의 로컬 기록 가져오기</button>` : ''}
      </div>
      ${restoreBox()}
    </article>`, 'side'],
    [`<p class="muted small center">Planerr v${APP_VERSION}</p>`, 'end'],
  ], 'settings-view');
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
    <h1>Planerr</h1>
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
  const tabs = [['day', '오늘'], ['week', '주'], ['month', '달'], ['projects', '프로젝트'], ['curriculum', '커리큘럼'], ['stats', '기록'], ['timer', '타이머']];
  const views = { day: viewDay, week: viewWeek, month: viewMonth, projects: viewProjects, curriculum: viewCurricula, stats: viewStats, timer: viewTimer, settings: viewSettings };
  return `<div class="layout">
    <header class="topbar">
      <span class="brand">Planerr</span>
      <span class="top-right">${timerMini()}${calChip()}${syncBadge()}<button class="icon-btn gear ${ui.view === 'settings' ? 'active' : ''}" data-action="nav" data-view="settings" aria-label="설정">${ICON.settings}</button></span>
      <nav class="tabs" aria-label="화면 전환">
        ${tabs.map(([v, label]) => `<button class="tab ${ui.view === v ? 'active' : ''}" data-action="nav" data-view="${v}" ${ui.view === v ? 'aria-current="page"' : ''}>${ICON[v]}<span>${label}</span></button>`).join('')}
      </nav>
    </header>
    ${s.error ? `<div class="banner" role="alert"><span>${esc(s.error)}</span><button class="link-btn" data-action="dismiss-error">닫기</button></div>` : ''}
    <main class="main ${ui.view === 'month' ? 'wide' : ''}">${views[ui.view]()}</main>
    ${alarmOverlay()}
    ${atAlarmOverlay()}
    ${appAlarmOverlay()}
    ${checklistOverlay()}
  </div>`;
}

let rafId = 0, composing = false, renderQueued = false;
function scheduleRender() {
  if (composing || drag) { renderQueued = true; return; } // 한글 입력 조합 중이거나 끌어서 옮기는 중에는 미룸
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
  const tabX = $app.querySelector('.tabs')?.scrollLeft || 0;
  $app.innerHTML = shell();
  // 탭 줄이 넘치면 옆으로 밀 수 있음: 다시 그려도 밀어 둔 위치를 지키고, 고른 탭이 가려지면 보이게
  const nav = $app.querySelector('.tabs'), at = nav?.querySelector('.tab.active');
  if (nav && nav.scrollWidth > nav.clientWidth + 1) {
    nav.scrollLeft = tabX;
    if (at) {
      const nr = nav.getBoundingClientRect(), ar = at.getBoundingClientRect();
      if (ar.left < nr.left) nav.scrollLeft -= nr.left - ar.left + 16;
      else if (ar.right > nr.right) nav.scrollLeft += ar.right - nr.right + 16;
    }
  }
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
/* ───────── 백업에서 되살리기 ─────────
   백업 파일과 지금 기록을 과제별로 비교해서, 지금 비어 있는 항목('뭘 할지', 단계, 마감일 등)만 채우고
   지금 어디에도 없는 과제는 백업의 날짜에 다시 넣음. 지금 있는 내용은 지우거나 바꾸지 않음 */
const RESTORE_FIELDS = [
  ['memo', '뭘 할지'], ['cue', '시작 시점'], ['steps', '단계'], ['due', '마감일'], ['alarm', '알림 시각'],
  ['start', '할 시간'], ['end', '할 시간'], ['area', '영역'], ['projectId', '프로젝트 연결'], ['milestoneId', '프로젝트 단계'], ['from', '넘어온 날짜'], ['done', '완료 표시'],
];
const DATE_FIELDS = new Set(['alarm', 'start', 'end']); // 그날에만 의미 있는 항목: 과제가 다른 날로 옮겨졌으면 채우지 않음
const blank = v => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length);

function restorePlan(bdays) {
  const where = new Map();
  for (const [d, r] of Object.entries(store.data.days)) for (const t of tasksOf(r)) where.set(t.id, d);
  const items = [];
  for (const [d, r] of Object.entries(bdays || {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    tasksOf(r).forEach((bt, idx) => {
      const cd = where.get(bt.id);
      if (!cd) {
        items.push({ key: `${d}|${bt.id}`, kind: 'add', date: d, id: bt.id, text: bt.text, task: bt, idx, on: true });
        return;
      }
      const ct = getTasks(cd).find(t => t.id === bt.id);
      const fill = {}, labels = [];
      for (const [f, label] of RESTORE_FIELDS) {
        if (DATE_FIELDS.has(f) && cd !== d) continue;
        if (f === 'steps') {
          const cs = Array.isArray(ct.steps) ? ct.steps : [], bs = Array.isArray(bt.steps) ? bt.steps : [];
          const have = new Set(cs.map(x => x.id)), miss = bs.filter(x => x && !have.has(x.id));
          if (miss.length) { fill.steps = [...cs, ...miss]; labels.push(`단계 ${miss.length}개`); }
          continue;
        }
        if (blank(ct[f]) && !blank(bt[f])) { fill[f] = bt[f]; if (!labels.includes(label)) labels.push(label); }
      }
      if (labels.length) items.push({ key: `${cd}|${bt.id}`, kind: 'fill', date: cd, from: d, id: bt.id, text: ct.text, fill, labels, on: true });
    });
  }
  return items;
}

function restoreLoad(file) {
  const rd = new FileReader();
  rd.onload = () => {
    let j = null;
    try { j = JSON.parse(rd.result); } catch { /* 아래에서 안내 */ }
    const data = j && j.app === 'study-planner' ? j.data : null;
    if (!data || typeof data.days !== 'object') { toast('Planerr 백업 파일이 아닙니다.'); return; }
    ui.restore = { name: file.name, at: j.exportedAt || '', version: j.version || '', items: restorePlan(data.days) };
    render();
  };
  rd.onerror = () => toast('파일을 읽지 못했습니다.');
  rd.readAsText(file);
}

function restoreApply() {
  const R = ui.restore;
  if (!R) return;
  const pick = R.items.filter(it => it.on);
  if (!pick.length) { toast('되살릴 항목을 골라 주세요.'); return; }
  const byDate = new Map();
  for (const it of pick) { if (!byDate.has(it.date)) byDate.set(it.date, []); byDate.get(it.date).push(it); }
  for (const [d, its] of byDate) {
    let list = getTasks(d);
    for (const it of its.filter(x => x.kind === 'fill')) list = list.map(t => (t.id === it.id ? { ...t, ...it.fill } : t));
    for (const it of its.filter(x => x.kind === 'add').sort((a, b) => a.idx - b.idx)) {
      if (list.some(t => t.id === it.id)) continue;
      list.splice(Math.min(it.idx, list.length), 0, { ...it.task });
    }
    setTasks(d, list);
  }
  ui.restore = null;
  render();
  toast(`${pick.length}개 과제를 백업에서 되살렸습니다.`);
}

function restoreBox() {
  const R = ui.restore;
  if (!R) return '';
  const when = R.at ? (() => { const t = new Date(R.at); return Number.isNaN(+t) ? '' : `${fmtMDW(ymd(t))} ${pad(t.getHours())}:${pad(t.getMinutes())}에 만든 `; })() : '';
  if (!R.items.length) {
    return `<div class="restore"><p class="small">${esc(when)}백업과 비교해 봤는데, 지금 기록에 빠진 내용이 없습니다.</p>
      <div class="btn-row"><button class="btn" data-action="restore-cancel">닫기</button></div></div>`;
  }
  const groups = new Map();
  for (const it of R.items) { if (!groups.has(it.date)) groups.set(it.date, []); groups.get(it.date).push(it); }
  const n = R.items.filter(it => it.on).length;
  return `<div class="restore">
    <p class="small">${esc(when)}백업과 비교한 결과입니다. 지금 비어 있는 항목만 채우고 없어진 과제는 다시 넣으며, 지금 있는 내용은 지우거나 바꾸지 않습니다. 되살리지 않을 것은 체크를 빼 주세요.</p>
    ${[...groups].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, list]) => `<div class="rs-day"><b>${fmtMDW(d)}</b>
      ${list.map(it => `<label class="check rs-item"><input type="checkbox" data-change="restore-pick" data-k="${esc(it.key)}" ${it.on ? 'checked' : ''}><span>${esc(it.text)}
        <small class="muted">${it.kind === 'add' ? '— 없어진 과제, 다시 넣기' : `— ${esc(it.labels.join(', '))} 되살리기${it.from !== it.date ? ` (백업에서는 ${fmtMD(it.from)})` : ''}`}</small></span></label>`).join('')}
    </div>`).join('')}
    <div class="btn-row"><button class="btn primary" data-action="restore-apply" ${n ? '' : 'disabled'}>선택한 ${n}개 되살리기</button><button class="btn" data-action="restore-cancel">취소</button></div>
  </div>`;
}

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
    if (v === 'curriculum' && ui.view === 'curriculum') { if (ui.curLesson) ui.curLesson = null; else ui.curId = null; } // 탭을 한 번 더 누르면 한 칸 위로
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
    gateStart(() => {
      ensureAudio();
      const t = todayStr();
      const top = topTask(t);
      timer = { date: t, phase: 'warm', warmMs: timerMin() * 60000, accMs: 0, segStart: Date.now(), area: top ? itemArea(top) : defaultArea() };
      saveTimer();
      syncStudy();
      if (!dayRec(t).started) store.set('days', t, { started: true, startedAt: Date.now() });
      else render();
    });
  },
  'timer-continue'() {
    if (!timer) return;
    ensureAudio();
    timer.phase = 'flow'; timer.segStart = Date.now(); timer.chimePending = false;
    saveTimer(); syncStudy(); render();
  },
  'timer-stop'() {
    if (!timer) return;
    const min = Math.round(elapsed() / 60000), d = timer.date, timer0 = timer;
    timer = null; saveTimer();
    syncStudy();
    if (min > 0) { store.set('days', d, { focusMin: (dayRec(d).focusMin || 0) + min }); addLog(d, { area: timer0.area || defaultArea(), min, src: 'start' }); }
    else render();
    toast(min > 0 ? `${areaInfo(timer0.area || defaultArea()).label} ${min}분을 기록했습니다.` : '시작한 것으로 기록했습니다.');
  },
  'mark-started'() { gateStart(() => store.set('days', todayStr(), { started: true, startedAt: Date.now() })); },

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
    const due = dateInp?.value || (p.deadline ? todayStr() : ''); // 마감 없는 프로젝트는 날짜 없이도 단계 추가
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
    const name = v('np-name'), start = v('np-start') || todayStr(), deadline = v('np-deadline'), area = v('np-area') || defaultArea();
    const buffer = Math.max(0, Math.min(60, Number(v('np-buffer')) || 0));
    const steps = v('np-steps').split('\n').map(s => s.trim()).filter(Boolean);
    if (!name) return toast('프로젝트 이름을 입력해 주세요.');
    if (deadline && deadline < start) return toast('마감일이 시작일보다 앞설 수 없습니다.');
    const id = uid();
    lsSet(LA_KEY, area);
    store.set('projects', id, {
      name, area, start, deadline: deadline || '', buffer, archived: false, createdAt: Date.now(),
      milestones: deadline
        ? distribute(start, deadline, buffer, steps.length ? steps : DEFAULT_STEPS)
        : steps.map(title => ({ id: uid(), title, due: '', done: false })),
    });
    ui.newProject = false; ui.openProject = id; render();
    toast(deadline ? '마감에서 거꾸로 단계를 배치했습니다.' : '프로젝트를 만들었습니다.');
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
  'pin-toggle'() { if (ui.pinView) pinHide(); else pinShow(); },
  'pin-add'() {
    const inp = document.getElementById('pin-new'), text = inp?.value.trim();
    if (!text) { inp?.focus(); return; }
    setPins([...getPins(), { id: uid(), text }]);
    pinTouch();
    render();
    document.getElementById('pin-new')?.focus();
  },
  'pin-del'(el) { setPins(getPins().filter(p => p.id !== el.dataset.id)); pinTouch(); render(); },
  'restore-apply'() { restoreApply(); },
  'log-add'(el) {
    const date = el.dataset.date, mIn = document.getElementById(`log-min-${date}`), min = Math.round(Number(mIn?.value));
    if (!(min >= 1 && min <= 720)) { toast('몇 분 했는지 1~720 사이로 적어 주세요.'); mIn?.focus(); return; }
    const area = document.getElementById(`log-area-${date}`)?.value || defaultArea(), text = document.getElementById(`log-text-${date}`)?.value.trim() || '';
    lsSet(LA_KEY, area);
    ui.logArea = null;
    addLog(date, { area, min, text, src: 'manual' });
    toast(`${areaInfo(area).label} ${fmtDur(min)}을 기록했습니다.`);
  },
  'log-del'(el) {
    const { date, id } = el.dataset, l = getLogs(date).find(x => x.id === id);
    if (!l) return;
    if ((l.src === 'timer' || l.src === 'start') && Number(l.min)) {
      // 타이머 기록을 지우면 '집중 n분'에서도 뺌(영역 없는 예전 시간으로 남지 않게)
      store.set('days', date, { focusMin: Math.max(0, (Number(dayRec(date).focusMin) || 0) - Number(l.min)) });
    }
    setLogs(date, getLogs(date).filter(x => x.id !== id));
  },
  'rgoal-add'() {
    const v = id => document.getElementById(id)?.value.trim() || '';
    const text = v('rg-text'), area = v('rg-area') || defaultArea(), type = GOAL_TYPES.find(x => x[0] === v('rg-type')) || GOAL_TYPES[0];
    const n = Number(v('rg-n'));
    if (!text) { document.getElementById('rg-text')?.focus(); return; }
    if (type[0] !== 'daily' && !(n > 0)) { toast('횟수나 시간을 적어 주세요.'); return; }
    const target = type[0] === 'daily' ? 1 : type[0] === 'wmin' ? Math.round(n * 60) : Math.round(n);
    setGoals([...allGoals(), { id: uid(), text, area, ...type[2], target }]);
    render();
  },
  'rgoal-del'(el) {
    const g = allGoals().find(x => x.id === el.dataset.id);
    if (!g || !confirm(`'${g.text}' 목표를 지울까요? 쌓인 기록은 그대로 남습니다.`)) return;
    setGoals(allGoals().map(x => (x.id === g.id ? { ...x, archived: true } : x)));
  },
  'rgoal-check'(el) {
    const g = getGoals().find(x => x.id === el.dataset.id);
    if (!g) return;
    addLog(todayStr(), { area: g.area, min: 0, text: g.text, src: 'check', goal: g.id });
    toast(`'${g.text}' 오늘 했음으로 기록했습니다.`);
  },
  'rgoal-log'(el) {
    const g = getGoals().find(x => x.id === el.dataset.id);
    if (!g) return;
    ui.logArea = g.area;
    render();
    const inp = document.getElementById(`log-min-${todayStr()}`);
    inp?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    inp?.focus();
  },
  'stat-mode'(el) { ui.statMode = el.dataset.m === 'month' ? 'month' : 'week'; render(); },
  'stat-prev'() { const [a] = statRange(); ui.statAnchor = addDays(a, -1); render(); },
  'stat-next'() { const [, b] = statRange(); ui.statAnchor = addDays(b, 1); render(); },
  'stat-reset'() { ui.statAnchor = null; render(); },
  'area-filter'(el) { ui.areaFilter = el.dataset.id || ''; lsSet('planner.areaFilter.v1', ui.areaFilter); ui.editTask = null; render(); },
  'area-add'() {
    const inp = document.getElementById('area-new'), text = inp?.value.trim();
    if (!text) { inp?.focus(); return; }
    const used = new Set(areas().map(a => a.color)), color = AREA_COLORS.find(c => !used.has(c)) || AREA_COLORS[areas().length % AREA_COLORS.length];
    setAreas([...areas(), { id: uid(), text, color }]);
    render();
  },
  'sub-add'(el) {
    const pid = el.dataset.id, inp = document.getElementById(`sub-new-${pid}`), text = inp?.value.trim();
    if (!text) { inp?.focus(); return; }
    setAreas([...areas(), { id: uid(), text, parent: pid }]);
    render();
    document.getElementById(`sub-new-${pid}`)?.focus();
  },
  'area-del'(el) {
    const list = areas(), a = list.find(x => x.id === el.dataset.id);
    if (!a) return;
    const top = !a.parent;
    if (top && topAreas(list).length <= 1) return toast('영역은 하나 이상 있어야 합니다.');
    if (!confirm(`'${a.text}'${top ? ' 영역과 그 안의 세부 영역을' : '을(를)'} 지울까요? 이미 이 ${top ? '영역' : '세부 영역'}으로 정한 과제·프로젝트는 그대로 표시되고, 새로 고를 때만 목록에서 빠집니다.`)) return;
    setAreas(list.map(x => (x.id === a.id || x.parent === a.id ? { ...x, archived: true } : x)));
    if (ui.areaFilter === a.id) { ui.areaFilter = ''; lsSet('planner.areaFilter.v1', ''); }
    render();
  },
  'restore-cancel'() { ui.restore = null; render(); },
  'import-local'() {
    const n = store.importData(store.localBackup());
    toast(n ? `${n}개 항목을 가져왔습니다.` : '가져올 새 항목이 없습니다.');
  },
  'dismiss-error'() { store.clearError(); },

  'alarm-ok'() { ui.alarms = []; stopMelody(); render(); },
  'ask-notify'() {
    try { Notification.requestPermission().then(() => render()); } catch { /* 무시 */ }
  },
  't-alarm-clear'(el) { updateTask(el.dataset.date, el.dataset.id, { alarm: '' }); },
  't-due-clear'(el) { updateTask(el.dataset.date, el.dataset.id, { due: '' }); },
  't-slot-clear'(el) { updateTask(el.dataset.date, el.dataset.id, { start: '', end: '' }); },
  'step-add'(el) {
    const { date, id } = el.dataset, inp = document.getElementById(`st-new-${date}-${id}`), text = inp?.value.trim();
    if (!text) { inp?.focus(); return; }
    inp.value = '';
    updateSteps(date, id, s => [...s, { id: uid(), text, done: false }]);
  },
  'step-del'(el) { updateSteps(el.dataset.date, el.dataset.id, s => s.filter(x => x.id !== el.dataset.sid)); },
  'step-done-task'(el) { updateTask(el.dataset.date, el.dataset.id, { done: true }); },
  'stuck-split'(el) {
    const { date, id } = el.dataset;
    if (topTask(date)?.id !== id) ui.editTask = `${date}|${id}`;
    render();
    document.getElementById(`st-new-${date}-${id}`)?.focus();
  },
  'stuck-replan'(el) {
    const { date, id } = el.dataset;
    if (topTask(date)?.id !== id) ui.editTask = `${date}|${id}`;
    updateTask(date, id, { from: '' });
    render();
    document.querySelector(`[data-key="t|${date}|${id}|due"]`)?.focus();
    toast('오늘부터 다시 셉니다. 마감일이나 할 시간을 다시 정해 보세요.');
  },
  'tl-open'(el) { ui.tlOpen = `${el.dataset.date}|${el.dataset.s}`; render(); },
  'tl-cancel'() { ui.tlOpen = null; render(); },
  'tl-place'(el) {
    const date = el.dataset.date, v = id => document.getElementById(id)?.value || '';
    const sel = v('tl-task'), s = v('tl-s'), e = v('tl-e');
    if (toMin(s) == null || toMin(e) == null || toMin(e) <= toMin(s)) return toast('끝 시각이 시작보다 늦어야 합니다.');
    if (sel && sel !== '__new') updateTask(date, sel, { start: s, end: e });
    else {
      const text = v('tl-new').trim();
      if (!text) { document.getElementById('tl-new')?.focus(); return toast('새 과제 이름을 적어 주세요.'); }
      setTasks(date, [...getTasks(date), { id: uid(), text, memo: '', cue: '', due: '', start: s, end: e, done: false, projectId: null, milestoneId: null }]);
    }
    ui.tlOpen = null;
    askNotify();
    render();
  },
  'tl-unplace'(el) { updateTask(el.dataset.date, el.dataset.id, { start: '', end: '' }); },
  'routine-off'(el) { const d = el.dataset.date; store.set('days', d, { routineOff: !dayRec(d).routineOff }); },
  'goto-routine'() { ui.view = 'settings'; render(); document.getElementById('routine-card')?.scrollIntoView({ block: 'start' }); },
  'routine-add'(el) {
    const R = routineCopy(), id = uid();
    if (el.dataset.kind === 'act') {
      // 활동 시간: 마지막으로 쓴 영역, 오늘 요일, 저녁 한 시간으로 시작
      R.blocks.push({ id, title: '', start: '19:00', end: '20:00', days: [isoDow(parse(todayStr()))], area: defaultArea() });
    } else R.blocks.push({ id, title: '', start: '08:30', end: '12:30', days: [1, 2, 3, 4, 5] });
    saveRoutine(R);
    render();
    document.querySelector(`[data-key="rt|${id}|title"]`)?.focus();
  },
  'routine-del'(el) {
    const R = routineCopy(), b = R.blocks.find(x => x.id === el.dataset.id);
    if (!b || !confirm(`'${b.title || (isActivity(b) ? '이름 없는 활동' : '이름 없는 일과')}'을(를) 지울까요? 이미 남긴 기록은 그대로 둡니다.`)) return;
    R.blocks = R.blocks.filter(x => x.id !== b.id);
    saveRoutine(R);
  },
  'rt-log'(el) {
    const { date, id } = el.dataset, have = getLogs(date).find(l => l.rt === id);
    if (have) { setLogs(date, getLogs(date).filter(l => l.id !== have.id)); toast('이 활동 기록을 지웠습니다.'); return; }
    const b = routineOf(settings().routine).blocks.find(x => x.id === id);
    if (!b || !isActivity(b) || date > todayStr()) return;
    addLog(date, { text: b.title || '', area: b.area, min: toMin(b.end) - toMin(b.start), src: 'routine', rt: id });
    toast(`${blockName(b)} ${fmtDur(toMin(b.end) - toMin(b.start))}을 기록했습니다.`);
  },
  // ── 커리큘럼
  'cur-new'() { ui.curNew = true; render(); document.getElementById('nc-name')?.focus(); },
  'cur-new-cancel'() { ui.curNew = false; render(); },
  'cur-create'() {
    const parsed = parseCurriculum(document.getElementById('nc-text')?.value || '');
    const name = (inVal('nc-name') || parsed.name).slice(0, 80);
    if (!name) { document.getElementById('nc-name')?.focus(); toast('이름을 적거나, 붙여 넣는 글 첫 줄에 # 제목을 넣어 주세요.'); return; }
    const area = inVal('nc-area') || defaultArea(), id = uid();
    const list = parsed.items.map(x => ({ id: uid(), ...x }));
    const tm = list.length ? mapPatch(null, list) : null;
    store.patch('curricula', id, { name, area, pace: Number(inVal('nc-pace')) || 0, created: Date.now(), ...(parsed.guide ? { guide: parsed.guide } : {}), ...(tm ? { lessons: tm } : {}) });
    lsSet(LA_KEY, area);
    ui.curNew = false; ui.curId = id; ui.curLesson = null; ui.curOpen = null; ui.curGuide = false;
    render(); scrollTop();
    toast(curImportMsg(list, parsed) || '커리큘럼을 만들었습니다. 레슨을 더해 주세요.');
  },
  'cur-open'(el) { ui.view = 'curriculum'; ui.curId = el.dataset.id; ui.curLesson = null; ui.curOpen = null; ui.curEdit = null; ui.curPaste = false; ui.curGuide = false; ui.curGuideEdit = false; render(); scrollTop(); },
  'cur-back'() { ui.curId = null; ui.curLesson = null; ui.curOpen = null; ui.curDone = null; render(); scrollTop(); },
  'cur-lesson'(el) { ui.view = 'curriculum'; ui.curId = el.dataset.c; ui.curLesson = el.dataset.l; ui.curEdit = null; ui.curDone = null; render(); scrollTop(); },
  'cur-lesson-close'() { ui.curLesson = null; ui.curEdit = null; ui.curDone = null; render(); scrollTop(); },
  'cur-edit'(el) { ui.curEdit = ui.curEdit === el.dataset.l ? null : el.dataset.l; render(); },
  'cur-guide'() { ui.curGuide = !ui.curGuide; render(); if (!ui.curGuide) document.querySelector('.cur-guide')?.scrollIntoView({ block: 'nearest' }); },
  'cur-guide-edit'() { ui.curGuideEdit = !ui.curGuideEdit; render(); },
  'cur-arch-toggle'() { ui.curShowArch = !ui.curShowArch; render(); },
  async 'cur-tpl'() {
    try { await navigator.clipboard.writeText(CUR_TEMPLATE); toast('템플릿을 복사했습니다. 빈칸을 채워 AI에게 보내 주세요.'); }
    catch { ui.curTpl = true; render(); toast("복사가 막혀 있어 내용을 펼쳤습니다. 칸 안을 전부 선택해 복사해 주세요."); }
  },
  'cur-tpl-show'() { ui.curTpl = !ui.curTpl; render(); },
  'cur-done-open'(el) {
    const { c, l } = el.dataset;
    ui.curDone = isDoneOpen(c, l) && ui.curDone.at === (el.dataset.at || '') ? null : { cid: c, lid: l, at: el.dataset.at || '' };
    render();
    document.getElementById('cd-note')?.focus();
  },
  'cur-done-cancel'() { ui.curDone = null; render(); },
  'cur-done-save'() {
    const d = ui.curDone, cur = d && curOf(d.cid), l = cur && lessonsOf(cur).find(x => x.id === d.lid);
    if (!l) { ui.curDone = null; render(); return; }
    const min = Number(inVal('cd-min')) || 0, note = inVal('cd-note').slice(0, 140), t = todayStr();
    ui.curDone = null;
    completeLesson(d.cid, d.lid, { date: t, min, note });
    // 과제칸에 올려 둔 같은 레슨도 끝냄으로(과제 쪽 연결은 다시 돌지 않게 직접 저장)
    const task = curTaskOf(t, d.lid);
    if (task && !task.done) setTasks(t, getTasks(t).map(x => (x.id === task.id ? { ...x, done: true } : x)));
    toast(`'${l.text}' 끝냄${min ? ` · ${fmtDur(min)} 기록` : ''}`);
  },
  'cur-note-save'() {
    const n = ui.curNote, note = inVal('cn-text').slice(0, 140);
    ui.curNote = null;
    if (n && note) updLesson(n.cid, n.lid, { note }); else render();
  },
  'cur-note-skip'() { ui.curNote = null; render(); },
  'cur-task'(el) { lessonTask(el.dataset.c, el.dataset.l); },
  'cur-skip'(el) {
    const { c, l } = el.dataset, x = lessonsOf(curOf(c)).find(y => y.id === l);
    if (!x) return;
    updLesson(c, l, { skip: !x.skip });
    if (!x.skip) toast(`'${x.text}'을(를) 건너뛰었습니다. 레슨 목록에서 되살릴 수 있습니다.`);
  },
  'cur-undo'(el) { undoLesson(el.dataset.c, el.dataset.l); toast('끝냄을 취소했습니다. 그날 기록에서도 뺐습니다.'); },
  'cur-les-open'(el) { ui.curOpen = ui.curOpen === el.dataset.l ? null : el.dataset.l; if (ui.curOpen !== ui.curEdit) ui.curEdit = null; render(); },
  'cur-les-move'(el) {
    const { c, l } = el.dataset, list = lessonsOf(curOf(c)), i = list.findIndex(x => x.id === l), j = i + Number(el.dataset.dir);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setLessons(c, list);
  },
  'cur-les-del'(el) {
    const { c, l } = el.dataset, list = lessonsOf(curOf(c)), x = list.find(y => y.id === l);
    if (!x || !confirm(x.h ? `단원 제목 '${x.text}'을(를) 지울까요? 그 안의 레슨은 남습니다.` : `레슨 '${x.text}'을(를) 지울까요?${x.done ? ' 이미 남긴 기록은 그대로 둡니다.' : ''}`)) return;
    if (ui.curOpen === l) ui.curOpen = null;
    if (ui.curLesson === l) { ui.curLesson = null; ui.curEdit = null; }
    setLessons(c, list.filter(y => y.id !== l));
  },
  'cur-les-add'() {
    const c = curOf(ui.curId), text = inVal('cu-new').slice(0, 120);
    if (!c) return;
    if (!text) { document.getElementById('cu-new')?.focus(); return; }
    const min = Math.max(0, Math.min(600, Math.round(Number(inVal('cu-new-min')) || 0)));
    setLessons(c.id, [...lessonsOf(c), { id: uid(), text, ...(min ? { min } : {}) }]);
    document.getElementById('cu-new')?.focus();
    const a = document.getElementById('cu-new'), b = document.getElementById('cu-new-min');
    if (a) a.value = ''; if (b) b.value = '';
  },
  'cur-sec-add'() {
    const c = curOf(ui.curId), text = inVal('cu-new').slice(0, 80);
    if (!c) return;
    if (!text) { document.getElementById('cu-new')?.focus(); toast('단원 이름을 레슨 칸에 적고 다시 눌러 주세요.'); return; }
    setLessons(c.id, [...lessonsOf(c), { id: uid(), text, h: true }]);
    const a = document.getElementById('cu-new'); if (a) a.value = '';
  },
  'cur-paste-open'() { ui.curPaste = !ui.curPaste; render(); document.getElementById('cp-text')?.focus(); },
  'cur-paste-add'() {
    const c = curOf(ui.curId), parsed = parseCurriculum(document.getElementById('cp-text')?.value || '');
    if (!c) return;
    const items = parsed.items.map(x => ({ id: uid(), ...x }));
    if (!items.length && !parsed.guide) { toast('넣을 레슨을 찾지 못했습니다. 한 줄에 레슨 하나씩 적거나 번호 붙은 제목으로 적어 주세요.'); return; }
    ui.curPaste = false;
    setLessons(c.id, [...lessonsOf(c), ...items]);
    if (parsed.guide) store.patch('curricula', c.id, { guide: clipStr(c.guide ? `${c.guide}\n\n${parsed.guide}` : parsed.guide, 60000) });
    toast(`끝에 ${curImportMsg(items, parsed)}`);
  },
  'cur-archive'(el) {
    const c = curOf(el.dataset.id);
    if (!c) return;
    store.patch('curricula', c.id, { archived: !c.archived });
    if (!c.archived) { ui.curId = null; toast(`'${c.name}'을(를) 보관함으로 옮겼습니다.`); }
  },
  'cur-del'(el) {
    const c = curOf(el.dataset.id);
    if (!c || !confirm(`'${c.name}' 커리큘럼을 지울까요? 레슨 ${curInfo(c).total}개가 함께 지워집니다. 기록·통계에 남은 시간은 그대로 둡니다.`)) return;
    ui.curId = null;
    store.remove('curricula', c.id);
  },
  'routine-day'(el) {
    const R = routineCopy(), b = R.blocks.find(x => x.id === el.dataset.id), d = Number(el.dataset.d);
    if (!b) return;
    b.days = b.days.includes(d) ? b.days.filter(x => x !== d) : [...b.days, d].sort();
    saveRoutine(R);
  },
  'cl-go'() { const c = ui.checklist; ui.checklist = null; render(); c?.fn(); },
  'cl-cancel'() { ui.checklist = null; render(); },
  'cl-add'() {
    const inp = document.getElementById('cl-new'), text = inp?.value.trim();
    if (!text) { inp?.focus(); return; }
    inp.value = '';
    const C = checklistSet();
    saveChecklist({ ...C, items: [...C.items, text] });
  },
  'cl-del'(el) { const C = checklistSet(); saveChecklist({ ...C, items: C.items.filter((_, i) => i !== Number(el.dataset.i)) }); },
  'cal-sync'() { calSync({ interactive: true }); },
  async 'bridge-copy'() {
    let secret = calMeta().bridgeSecret;
    if (!secret) { secret = makeSecret(); store.set('meta', 'calendar', { bridgeSecret: secret }); }
    try {
      await navigator.clipboard.writeText(scriptCode(secret));
      toast('코드를 복사했습니다. script.google.com의 새 프로젝트에 붙여 넣어 주세요.');
    } catch {
      ui.bridgeShow = true;
      render();
      toast("복사가 막혀 있어 '코드 직접 보기'를 펼쳤습니다. 칸 안을 전부 선택해 복사해 주세요.");
    }
  },
  async 'bridge-test'() {
    const url = document.getElementById('bridge-url')?.value.trim() || '';
    const secret = calMeta().bridgeSecret;
    if (!secret) { toast("먼저 '코드 복사'를 눌러 Apps Script에 붙여 넣어 주세요."); return; }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { toast('웹 앱 URL은 https://script.google.com/macros/s/…/exec 형태입니다.'); return; }
    if (!navigator.onLine) { toast('오프라인이라 확인할 수 없습니다.'); return; }
    calBusy = true; render();
    try {
      const r = await bridgeCall(url, secret, 'ping', { calendarId: calMeta().calendarId || null, name: BASE_TITLE, timeZone: TZ });
      store.set('meta', 'calendar', { bridgeUrl: url, calendarId: r.calendarId });
      calError = '';
      toast('상시 연결됐습니다. 이제 로그인 없이 자동으로 반영됩니다.');
      calBusy = false;
      calSync();
    } catch (e) {
      toast(e.message);
    } finally {
      calBusy = false;
      render();
    }
  },
  'bridge-off'() {
    if (!confirm('상시 연결을 끊을까요? Apps Script와 캘린더는 그대로 남습니다. 다시 연결할 때는 같은 웹 앱 URL을 넣으면 됩니다.')) return;
    store.set('meta', 'calendar', { bridgeUrl: null });
    calError = '';
    toast('상시 연결을 끊었습니다.');
  },
  'cal-disconnect'() {
    if (!confirm(`캘린더 연결을 해제할까요? 구글 캘린더의 플래너 캘린더는 그대로 남으니, 필요 없으면 구글 캘린더에서 직접 지워 주세요.`)) return;
    gcal.revoke();
    store.set('meta', 'calendar', { calendarId: null, synced: [], syncedAt: null });
    toast('캘린더 연결을 해제했습니다.');
  },

  't-add'(el) {
    const date = el.dataset.date, inp = document.getElementById(`t-new-${date}`), text = inp?.value.trim();
    if (!text) { inp?.focus(); return; }
    const dueIn = document.getElementById(`t-new-due-${date}`), due = dueIn?.value || '';
    const area = document.getElementById(`t-new-area-${date}`)?.value || defaultArea();
    inp.value = '';
    if (dueIn) dueIn.value = '';
    lsSet(LA_KEY, area);
    setTasks(date, [...getTasks(date), { id: uid(), text, area, memo: '', cue: '', due, done: false, projectId: null, milestoneId: null }]);
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

  'mt-toggle'() { if (!mtRunning() && (mt.status === 'ready' || mt.status === 'done')) gateStart(() => mtToggle()); else mtToggle(); },
  'mt-reset'() { mtReset(); },
  'mt-add'() { mtAdd(60); },
  'mt-preset'(el) { mtPreset(Number(el.dataset.min)); },
  'mt-dismiss'(el) { mtDismiss(el.dataset.rec === '1'); },
  'mt-record'() { if (!mt.offer) return; recordFocus(mt.offer.min, mt.offer.date, document.getElementById('offer-area')?.value || mtArea()); mt.offer = null; mtSave(); scheduleRender(); },
  'mt-norecord'() { mt.offer = null; mtSave(); scheduleRender(); },
  'mt-pip'() { togglePip(); },
  'at-toggle'() { atToggle(); },
  'at-reset'() { atReset(); },
  'at-add'() { atAdd(60); },
  'at-preset'(el) { atPreset(Number(el.dataset.min)); },
  'at-dismiss'() { atDismiss(); },
  'at-again'() {
    atDismiss();
    const t = atm.setMs > 0 ? atm.setMs : AT_DEFAULT;
    Object.assign(atm, { status: 'ready', totalMs: t, remainMs: t });
    atToggle();
  },
  'timer-tab'(el) { setTimerTab(el.dataset.t); render(); },
  'timer-goto'(el) { setTimerTab(el.dataset.t); ui.view = 'timer'; render(); scrollTop(); },
  'music-open'() { ui.musicOpen = !ui.musicOpen; render(); },
  'pl-open'(el) { ui.plOpen = el.dataset.pl; ui.libPick = false; if (preview.playing) preview.pause(); refreshPlayers(); render(); },
  'pl-new'() {
    const inp = document.getElementById('pl-new-name'), name = inp?.value.trim();
    if (!name) { inp?.focus(); return; }
    inp.value = '';
    const id = uid();
    saveMusic({ playlists: [...clonePls(), { id, name, items: [], repeat: true }] });
    ui.plOpen = id;
    refreshPlayers();
  },
  'pl-del'(el) {
    const p = plById(el.dataset.pl), m = musicMeta();
    if (!p || !confirm(`'${p.name}' 플리를 지울까요? 곡은 '전체 곡'에 남습니다.`)) return;
    saveMusic({ playlists: clonePls().filter(x => x.id !== p.id), ...(m.studyPl === p.id ? { studyPl: null } : {}), ...(m.alarmPl === p.id ? { alarmPl: null } : {}), ...(m.alarm2Pl === p.id ? { alarm2Pl: null } : {}) });
    ui.plOpen = null;
    refreshPlayers();
  },
  'pl-repeat'(el) { saveMusic({ playlists: clonePls().map(p => (p.id === el.dataset.pl ? { ...p, repeat: p.repeat === false } : p)) }); refreshPlayers(); },
  'pl-remove'(el) { saveMusic({ playlists: clonePls().map(p => (p.id === el.dataset.pl ? { ...p, items: p.items.filter(x => x !== el.dataset.t) } : p)) }); refreshPlayers(); },
  'pl-add-track'(el) { saveMusic({ playlists: clonePls().map(p => (p.id === el.dataset.pl ? { ...p, items: [...p.items, el.dataset.t] } : p)) }); refreshPlayers(); scheduleDriveAuto(); },
  'pl-keep'(el) {
    const k = new Set(keepPls());
    k.add(el.dataset.pl);
    try { localStorage.setItem(KEEP_KEY, JSON.stringify([...k])); } catch { /* 무시 */ }
    driveSync({ interactive: true });
  },
  'lib-pick'() { ui.libPick = !ui.libPick; render(); },
  'lib-all'() { ui.libAll = !ui.libAll; render(); },
  'track-del'(el) {
    const t = trackById(el.dataset.t);
    if (!t || !confirm(`'${t.name}'을(를) 모든 플리와 드라이브, 각 기기에서 지울까요?`)) return;
    deleteTrack(t.id);
  },
  'drive-sync'() { driveSync({ interactive: true }); },
  'mp-play'(el) { if (mpLocked()) return; uiPlayer().play(Number(el.dataset.i)); },
  'mp-toggle'() { if (mpLocked()) return; uiPlayer().toggle(); },
  'mp-prev'() { if (mpLocked()) return; uiPlayer().prev(); },
  'mp-next'() { if (mpLocked()) return; uiPlayer().next(); },
  'theme-preset'(el) {
    const p = PRESETS.find(x => x.id === el.dataset.id);
    if (!p) return;
    ui.themeDraft = null;
    saveTheme(themeFrom(p, 'custom'));
  },
  'theme-auto'() { ui.themeDraft = null; saveTheme({ mode: 'auto' }); },
};

const changeActions = {
  'mt-area'(el) { mt.area = el.value; mtSave(); },
  'tarea'(el) { lsSet(LA_KEY, el.value); updateTask(el.dataset.date, el.dataset.id, { area: el.value }); },
  'parea'(el) { lsSet(LA_KEY, el.value); store.set('projects', el.dataset.id, { area: el.value }); },
  'area-field'(el) {
    const f = el.dataset.f, v = f === 'quiet' ? !el.checked : el.value.trim();
    if (f === 'text' && !v) { render(); return; } // 이름을 비우면 원래대로
    setAreas(areas().map(a => (a.id === el.dataset.id ? { ...a, [f]: v } : a)));
  },
  'pin-check'(el) {
    setPins(getPins().map(p => (p.id === el.dataset.id ? { ...p, doneOn: el.checked ? todayStr() : '' } : p)));
    pinTouch(); render(); pipRefresh();
  },
  'pin-text'(el) {
    const v = el.value.trim();
    if (!v) { render(); return; } // 빈칸으로 만들면 원래대로(지우려면 ×)
    setPins(getPins().map(p => (p.id === el.dataset.id ? { ...p, text: v } : p)));
    pinTouch(); pipRefresh();
  },
  'restore-pick'(el) {
    const it = ui.restore?.items.find(x => x.key === el.dataset.k);
    if (it) { it.on = el.checked; render(); }
  },
  tfield(el) {
    const { date, id } = el.dataset, f = el.dataset.tfield, v = el.value.trim();
    const t = getTasks(date).find(x => x.id === id);
    if (!t) return;
    if (f === 'text' && !v) { render(); return; } // 과제 이름은 비울 수 없음
    if ((t[f] || '') === v) return;
    const patch = { [f]: v };
    // 할 시간: 시작만 정하면 끝은 1시간 뒤로, 끝이 시작보다 빠르면 거절
    if (f === 'start' && v && (toMin(t.end) == null || toMin(t.end) <= toMin(v))) patch.end = toHM(Math.min(toMin(v) + 60, 1439));
    if (f === 'start' && !v) patch.end = '';
    if (f === 'end' && v && toMin(t.start) != null && toMin(v) <= toMin(t.start)) { toast('끝 시각이 시작보다 늦어야 합니다.'); render(); return; }
    if (f === 'end' && v && toMin(t.start) == null) { toast('시작 시각을 먼저 정해 주세요.'); render(); return; }
    updateTask(date, id, patch);
    if (f === 'start' && v) askNotify();
  },
  'step-toggle'(el) { updateSteps(el.dataset.date, el.dataset.id, s => s.map(x => (x.id === el.dataset.sid ? { ...x, done: el.checked } : x))); },
  'pl-role'(el) { saveMusic({ [el.dataset.role]: el.value || null }); refreshPlayers(); scheduleDriveAuto(); },
  'pl-name'(el) {
    const v = el.value.trim();
    if (!v) { render(); return; }
    saveMusic({ playlists: clonePls().map(p => (p.id === el.dataset.pl ? { ...p, name: v } : p)) });
  },
  'tl-sel'(el) { const n = document.getElementById('tl-new'); if (n) { n.hidden = el.value !== '__new'; if (!n.hidden) n.focus(); } },
  'cl-check'(el) { if (ui.checklist) ui.checklist.checked[el.dataset.i] = el.checked; },
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

/* ───────── 끌어서 순서 바꾸기 (터치·마우스 공통) ───────── */
// 목록: [data-sortable], 항목: [data-sort-id], 손잡이: .drag-handle
// 끄는 동안에는 다른 항목을 transform으로만 밀어 두고, 놓을 때 한 번에 저장합니다.
const GRIP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
let drag = null;

function sortCommit(list, ids) {
  if (list.dataset.sortable === 'tasks') {
    const date = list.dataset.date, cur = getTasks(date);
    setTasks(date, ids.map(id => cur.find(t => t.id === id)).filter(Boolean));
  } else if (list.dataset.sortable === 'pins') {
    const cur = getPins();
    setPins(ids.map(id => cur.find(p => p.id === id)).filter(Boolean));
  } else if (list.dataset.sortable === 'pl') {
    saveMusic({ playlists: clonePls().map(p => (p.id === list.dataset.pl ? { ...p, items: ids } : p)) });
    refreshPlayers();
  }
}

function dragStart(e, handle) {
  if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const el = handle.closest('[data-sort-id]'), list = el?.closest('[data-sortable]');
  if (!el || !list) return;
  e.preventDefault();
  const items = [...list.querySelectorAll(':scope > [data-sort-id]')];
  if (items.length < 2) return;
  const sy = scrollY;
  drag = {
    el, list, handle, items, from: items.indexOf(el), to: items.indexOf(el), id: e.pointerId,
    startY: e.clientY + sy, lastClientY: e.clientY,
    mids: items.map(it => { const r = it.getBoundingClientRect(); return r.top + sy + r.height / 2; }),
    shift: el.offsetHeight, raf: 0,
  };
  try { handle.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
  list.classList.add('sorting');
  el.classList.add('dragging');
  document.body.classList.add('is-dragging');
  try { navigator.vibrate?.(8); } catch { /* 무시 */ }
  handle.addEventListener('pointermove', dragMove);
  handle.addEventListener('pointerup', dragEnd);
  handle.addEventListener('pointercancel', dragEnd);
  drag.raf = requestAnimationFrame(autoScroll);
}

function dragLayout() {
  const d = drag, dy = d.lastClientY + scrollY - d.startY, center = d.mids[d.from] + dy;
  d.el.style.transform = `translateY(${dy}px)`;
  let to = 0;
  d.mids.forEach((m, i) => { if (i !== d.from && m < center) to++; });
  d.to = to;
  d.items.forEach((it, i) => {
    if (i === d.from) return;
    let s = 0;
    if (d.from < to && i > d.from && i <= to) s = -d.shift;
    if (d.from > to && i >= to && i < d.from) s = d.shift;
    it.style.transform = s ? `translateY(${s}px)` : '';
  });
}

function dragMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  drag.lastClientY = e.clientY;
  dragLayout();
}

// 화면 위·아래 가장자리로 끌면 저절로 스크롤
function autoScroll() {
  if (!drag) return;
  // 위쪽 고정 막대(탭 포함) 바로 아래와 화면 맨 아래 근처에서 자동으로 스크롤
  const head = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
  const y = drag.lastClientY, top = head + 36, bottom = innerHeight - 50;
  const v = y < top ? -Math.ceil((top - y) / 6) : y > bottom ? Math.ceil((y - bottom) / 6) : 0;
  if (v) { scrollBy(0, v); dragLayout(); }
  drag.raf = requestAnimationFrame(autoScroll);
}

function dragEnd(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const d = drag;
  drag = null;
  cancelAnimationFrame(d.raf);
  d.handle.removeEventListener('pointermove', dragMove);
  d.handle.removeEventListener('pointerup', dragEnd);
  d.handle.removeEventListener('pointercancel', dragEnd);
  document.body.classList.remove('is-dragging');
  d.list.classList.remove('sorting');
  d.el.classList.remove('dragging');
  d.items.forEach(it => { it.style.transform = ''; });
  const ids = d.items.map(it => it.dataset.sortId);
  const cancelled = e && e.type === 'pointercancel';
  if (!cancelled && d.to !== d.from) {
    const [moved] = ids.splice(d.from, 1);
    ids.splice(d.to, 0, moved);
    sortCommit(d.list, ids);
  }
  if (renderQueued) { renderQueued = false; scheduleRender(); }
}

$app.addEventListener('pointerdown', e => {
  const h = e.target.closest('.drag-handle');
  if (h && $app.contains(h)) dragStart(e, h);
});

$app.addEventListener('pointerdown', e => { if (e.target.closest?.('.pins')) pinTouch(); });
$app.addEventListener('keydown', e => { if (e.target.closest?.('.pins')) pinTouch(); }, true);
$app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !$app.contains(el)) return;
  actions[el.dataset.action]?.(el, e);
});

$app.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'pl-file') { if (el.files?.length) addFilesToPl(el.dataset.pl, [...el.files]); el.value = ''; return; }
  if (el.id === 'restore-file') { if (el.files?.[0]) restoreLoad(el.files[0]); el.value = ''; return; }
  if (el.dataset.routine) {
    const R = routineCopy(), f = el.dataset.routine, v = el.value.trim();
    if (f === 'cal' || f === 'area') {
      const b = R.blocks.find(x => x.id === el.dataset.id);
      if (!b) return;
      if (f === 'cal') b.cal = el.checked; else b.area = v;
      if (f === 'area' && v) lsSet(LA_KEY, v);
      saveRoutine(R);
      return;
    }
    if (f === 'dayStart' || f === 'dayEnd') {
      if (!v) { render(); return; }
      R[f] = v;
      if (toMin(R.dayEnd) <= toMin(R.dayStart)) { toast('하루 끝이 시작보다 늦어야 합니다.'); render(); return; }
    } else {
      const b = R.blocks.find(x => x.id === el.dataset.id);
      if (!b) return;
      if ((f === 'start' || f === 'end') && !v) { render(); return; }
      if (f === 'start' && toMin(b.end) <= toMin(v)) {
        // 시작을 끝보다 늦게 옮기면 길이를 유지한 채 끝도 함께 옮김
        const dur = toMin(b.end) - toMin(b.start) > 0 ? toMin(b.end) - toMin(b.start) : 60;
        b.end = toHM(Math.min(toMin(v) + dur, 1439));
      }
      b[f] = v;
      if (toMin(b.end) <= toMin(b.start)) { toast('끝 시각이 시작보다 늦어야 합니다.'); render(); return; }
    }
    saveRoutine(R);
    return;
  }
  if (el.dataset.cur) {
    const c = curOf(ui.curId), f = el.dataset.cur, v = el.value.trim();
    if (!c) return;
    if (f === 'name') { if (!v) { render(); return; } store.patch('curricula', c.id, { name: v.slice(0, 80) }); }
    else if (f === 'area') { store.patch('curricula', c.id, { area: v }); lsSet(LA_KEY, v); }
    else if (f === 'pace') store.patch('curricula', c.id, { pace: Number(v) || 0 });
    else if (f === 'lmin') store.patch('curricula', c.id, { lmin: Math.max(0, Math.min(600, Math.round(Number(v) || 0))) });
    else if (f === 'guide') store.patch('curricula', c.id, { guide: clipStr(v, 60000) });
    return;
  }
  if (el.dataset.cles) {
    const { c, l } = el.dataset, f = el.dataset.cles;
    let v = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (f === 'text' && !v) { render(); return; }
    if (f === 'min') v = Math.max(0, Math.min(600, Math.round(Number(v) || 0)));
    if (f === 'text') v = v.slice(0, 120);
    if (f === 'body') v = clipStr(v, 20000);
    updLesson(c, l, { [f]: v });
    return;
  }
  if (el.dataset.cl) {
    const C = checklistSet();
    if (el.dataset.cl === 'on') saveChecklist({ ...C, on: el.checked });
    else {
      const i = Number(el.dataset.i), v = el.value.trim(), items = [...C.items];
      if (v) items[i] = v; else items.splice(i, 1);
      saveChecklist({ ...C, items });
    }
    return;
  }
  if (el.dataset.color) { commitThemeDraft(); return; }
  if ('mtInput' in el.dataset || 'atInput' in el.dataset) return;
  if (el.dataset.tfield) { changeActions.tfield(el); if (el.dataset.tfield === 'alarm' && el.value) askNotify(); return; }
  if (el.dataset.alarm) {
    const A = alarmSet(), [k, sub] = el.dataset.alarm.split('.');
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (sub) { if (sub === 'time' && !v) { render(); return; } A[k] = { ...A[k], [sub]: v }; } else A[k] = v;
    store.set('meta', 'settings', { alarms: A });
    if (v === true) askNotify();
    return;
  }
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
  if ('atInput' in el.dataset) { atFromInputs(); return; }
  if (el.dataset.color) { themeInput(el); return; }
  if (el.id === 'mp-seek') uiPlayer().seek(Number(el.value) / 1000);
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
  if (store.status.phase === 'ready') { syncTheme(); autoCarry(); }
  if (reason === 'status' && store.status.phase === 'ready') { updateBadge(); return; }
  scheduleRender();
  pipRefresh();
  if (store.status.phase === 'ready') { scheduleCalAuto(); scheduleDriveAuto(); migrateLegacyMusic(); refreshPlayers(); }
});
// 화면 너비가 기준(1000px)을 넘나들면 배치를 다시 그림(창 크기 조절, 아이패드 가로·세로 전환)
try { WIDE.addEventListener('change', () => scheduleRender()); } catch { try { WIDE.addListener(() => scheduleRender()); } catch { /* 무시 */ } }
addEventListener('online', () => {
  if (gcal.available) gcal.loadGis().catch(() => {});
  scheduleCalAuto();
  scheduleDriveAuto();
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
  autoCarry();
  scheduleRender();
  pipRefresh();
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
if (atRunning() && atm.endTime <= Date.now()) atFinish(true);
cacheIds().then(ids => { cachedIds = ids; refreshPlayers(); }).catch(() => {});
if (gcal.available && navigator.onLine) gcal.loadGis().catch(() => {}); // 버튼을 누르는 순간 바로 연결 창을 열 수 있게 미리 불러 둠
render();
store.init();
