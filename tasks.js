// 하루 과제 목록의 저장 형식 — 목록 순서 = 우선순위
//   days/{날짜}.tmap = { 과제 id: { text, memo, steps, due, …, o(순서) } }
// 과제마다, 항목마다 따로 저장해서 여러 기기가 같은 날 과제를 고쳐도 서로 덮어쓰지 않고 합쳐집니다
// (같은 과제의 같은 항목을 두 기기가 동시에 고친 경우에만 나중에 저장된 쪽이 남음).
// 예전 형식도 읽습니다: v1.10까지의 tasks 배열, 그보다 전의 '하루 과제 하나'(task). 다음에 저장할 때 tmap으로 옮깁니다.
// 예전의 '첫 행동'(action)은 '뭘 할지' 메모(memo)로 읽습니다.

import { DELETE } from './store.js';

export const isTask = t => !!t && typeof t === 'object' && typeof t.text === 'string';
const legacyTask = t => (t.memo === undefined && t.action ? { ...t, memo: t.action } : t);

// 객체 키 순서가 달라도(서버에서 받은 것과 기기에서 만든 것) 같은 값이면 같다고 봄
const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
export const sameVal = (a, b) => stable(a) === stable(b);
// 빈 값('', 빈 배열, false, null)은 '없음'과 같게 봄 — 처음 저장할 때 빈 항목은 쓰지 않아 다른 기기의 값을 지우지 않음
const isEmpty = v => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length);

// 순서 있는 맵({ id: { text, …, o } }) ↔ 목록. 과제 말고 상시 과제칸 같은 다른 목록에도 씀
export function listOfMap(m) {
  if (!m || typeof m !== 'object') return [];
  return Object.entries(m).filter(([, t]) => isTask(t)).map(([id, t]) => ({ ...t, id }))
    .sort((a, b) => (a.o ?? 0) - (b.o ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ o, ...t }) => t);
}

// 맵(m)을 새 목록(list)으로 바꾸려면 저장할 내용: 새 항목은 빈 값을 뺀 전체, 고친 항목은 바뀐 값만, 빠진 항목은 지움. 없으면 null
export function mapPatch(m, list) {
  const base = new Map(m && typeof m === 'object' ? Object.entries(m).filter(([, t]) => isTask(t)) : []);
  const tm = {}, keep = new Set();
  list.forEach((t, i) => {
    const nt = { ...t, o: i };
    keep.add(t.id);
    const old = base.get(t.id);
    if (!old) {
      const full = { id: t.id, text: typeof t.text === 'string' ? t.text : '' };
      for (const [k, v] of Object.entries(nt)) if (!(k in full) && (k === 'o' || !isEmpty(v))) full[k] = v;
      tm[t.id] = full;
      return;
    }
    const d = {};
    for (const k of new Set([...Object.keys(old), ...Object.keys(nt)])) {
      if (k === 'id' || sameVal(old[k], nt[k])) continue;
      if (nt[k] === undefined) { if (!isEmpty(old[k])) d[k] = DELETE; } else d[k] = nt[k];
    }
    if (Object.keys(d).length) tm[t.id] = d;
  });
  for (const id of base.keys()) if (!keep.has(id)) tm[id] = DELETE;
  return Object.keys(tm).length ? tm : null;
}

export function tasksOf(r) {
  r = r || {};
  if (r.tmap && typeof r.tmap === 'object') {
    const list = listOfMap(r.tmap);
    // 아직 예전 버전인 기기가 배열로 저장한 과제는 뒤에 붙여 보여 줌(다음 저장 때 tmap으로 옮겨짐)
    if (Array.isArray(r.tasks)) {
      const ids = new Set(list.map(t => t.id));
      list.push(...r.tasks.filter(t => isTask(t) && !ids.has(t.id)).map(legacyTask));
    }
    return list;
  }
  if (Array.isArray(r.tasks)) return r.tasks.filter(isTask).map(legacyTask);
  if (r.task) return [{ id: 'legacy', text: r.task, memo: r.action || '', cue: r.cue || '', done: !!r.done, projectId: r.projectId || null, milestoneId: r.milestoneId || null }];
  return [];
}

// 하루 기록(r)을 새 목록(list)으로 바꾸려면 저장할 내용: 새 과제는 빈 항목을 뺀 전체, 고친 과제는 바뀐 항목만, 빠진 과제는 지움.
// 바꿀 것이 없으면 null
export function taskPatch(r, list) {
  r = r || {};
  const tm = mapPatch(r.tmap, list);
  const patch = {};
  if (tm) patch.tmap = tm;
  // 예전 형식은 tmap으로 옮겼으니 지움(남겨 두면 예전 과제가 다시 보일 수 있음)
  if (Array.isArray(r.tasks)) patch.tasks = DELETE;
  if (r.task !== undefined) patch.task = DELETE;
  return Object.keys(patch).length ? patch : null;
}
