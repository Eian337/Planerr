// 시간표 계산 — 고정 일과와 시간을 정한 과제로 하루 타임라인을 만들고 빈 시간을 찾습니다(화면과 무관한 순수 함수).

const pad = n => String(n).padStart(2, '0');
export const toMin = hm => {
  if (!hm || typeof hm !== 'string' || !hm.includes(':')) return null;
  const [h, m] = hm.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
export const toHM = min => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

// 월=1 … 일=7
export const isoDow = dateObj => ((dateObj.getDay() + 6) % 7) + 1;

export const ROUTINE_DEFAULT = { dayStart: '07:00', dayEnd: '23:00', blocks: [] };

export function routineOf(raw) {
  const r = raw || {};
  return { ...ROUTINE_DEFAULT, ...r, blocks: Array.isArray(r.blocks) ? r.blocks : [] };
}

// 과제의 끝 시각(없으면 시작 + 30분)
export const taskEnd = t => {
  const s = toMin(t.start), e = toMin(t.end);
  return e != null && e > s ? e : s + 30;
};

// 구간 [s, e] 안에서 busy 항목을 뺀 빈 시간들
function gapsIn(s, e, busy, minGap) {
  const out = [];
  let cur = s;
  for (const b of [...busy].sort((x, y) => x.s - y.s)) {
    const bs = Math.min(Math.max(b.s, s), e);
    if (bs - cur >= minGap) out.push({ kind: 'gap', s: cur, e: bs });
    cur = Math.max(cur, Math.min(b.e, e));
  }
  if (e - cur >= minGap) out.push({ kind: 'gap', s: cur, e });
  return out;
}

// 타임라인 항목: { kind: 'fixed'|'task'|'gap', s, e, ... } 시간순
// 시작 시각이 고정 일과 안에 있는 과제는 그 일과의 tasks로 들어가고, 일과 안의 빈 시간은 gaps로 계산됨
export function buildTimeline({ fixed, tasks, dayStart, dayEnd, minGap = 10 }) {
  const fx = fixed
    .map(b => ({ kind: 'fixed', s: toMin(b.start), e: toMin(b.end), block: b, tasks: [], gaps: [] }))
    .filter(x => x.s != null && x.e != null && x.e > x.s)
    .sort((a, b) => a.s - b.s);
  const tk = tasks
    .filter(t => toMin(t.start) != null)
    .map(t => ({ kind: 'task', s: toMin(t.start), e: taskEnd(t), task: t }))
    .sort((a, b) => a.s - b.s);
  for (const t of tk) t.overlap = tk.some(o => o !== t && t.s < o.e && o.s < t.e); // 과제끼리 겹침
  const top = [];
  for (const t of tk) {
    const host = fx.find(f => t.s >= f.s && t.s < f.e);
    if (host) host.tasks.push(t); else top.push(t);
  }
  for (const f of fx) f.gaps = gapsIn(f.s, f.e, f.tasks, minGap);

  const ds = toMin(dayStart) ?? 420, de = toMin(dayEnd) ?? 1380;
  const gaps = gapsIn(ds, de, [...fx, ...tk], minGap);
  const order = { fixed: 0, task: 1, gap: 2 };
  return [...fx, ...top, ...gaps].sort((a, b) => a.s - b.s || order[a.kind] - order[b.kind]);
}
