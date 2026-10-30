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

// 타임라인 항목: { kind: 'fixed'|'task'|'gap', s, e, ... } 시간순
export function buildTimeline({ fixed, tasks, dayStart, dayEnd, minGap = 10 }) {
  const fx = fixed
    .map(b => ({ kind: 'fixed', s: toMin(b.start), e: toMin(b.end), block: b }))
    .filter(x => x.s != null && x.e != null && x.e > x.s);
  const tk = tasks
    .filter(t => toMin(t.start) != null)
    .map(t => ({ kind: 'task', s: toMin(t.start), e: taskEnd(t), task: t }));
  for (const t of tk) t.overlap = fx.some(f => t.s < f.e && f.s < t.e);

  const busy = [...fx, ...tk].sort((a, b) => a.s - b.s);
  const ds = toMin(dayStart) ?? 420, de = toMin(dayEnd) ?? 1380;
  const gaps = [];
  let cur = ds;
  for (const it of busy) {
    const s = Math.min(Math.max(it.s, ds), de);
    if (s - cur >= minGap) gaps.push({ kind: 'gap', s: cur, e: s });
    cur = Math.max(cur, Math.min(it.e, de));
  }
  if (de - cur >= minGap) gaps.push({ kind: 'gap', s: cur, e: de });

  const order = { fixed: 0, task: 1, gap: 2 };
  return [...busy, ...gaps].sort((a, b) => a.s - b.s || order[a.kind] - order[b.kind]);
}
