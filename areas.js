// 영역(학업·자기개발·여가 등)과 그 안의 세부 영역(과목·활동) — 두 단계까지
// 저장: meta/areas.items = { id: { text(이름), parent(위 영역 id, 없으면 영역), emoji, color('#rrggbb'), focus, archived, o(순서) } }
// 아직 한 번도 고치지 않았으면 기본 영역 세 개를 씀. 지운 영역은 archived로 남겨, 그 영역을 쓰던 과제·프로젝트가 계속 표시되게 함
import { listOfMap } from './tasks.js';

export const DEFAULT_AREA = 'study';
export const DEFAULT_AREAS = [
  // focus: 이 영역 과제가 '지금 할 과제'로 올라올 수 있는지
  { id: 'study', text: '학업', parent: null, emoji: '📚', color: '#4a7fd4', focus: true },
  { id: 'growth', text: '자기개발', parent: null, emoji: '🌱', color: '#2f9e6e', focus: true },
  { id: 'leisure', text: '여가', parent: null, emoji: '🎮', color: '#c2569f', focus: true },
];

export function areaList(meta) {
  const l = listOfMap(meta?.items);
  return l.length ? l : DEFAULT_AREAS.map(a => ({ ...a }));
}

// 영역 id → 표시에 필요한 정보. 모르는 id는 기본 영역으로
export function areaInfo(list, id) {
  const live = list.filter(a => !a.archived);
  const a = list.find(x => x.id === id) || list.find(x => x.id === DEFAULT_AREA) || live.find(x => !x.parent) || list[0] || DEFAULT_AREAS[0];
  const top = (a.parent && list.find(x => x.id === a.parent)) || a;
  return {
    a, top,
    color: a.color || top.color || '#888888',
    emoji: a.emoji || top.emoji || '•',
    label: a.parent ? a.text : top.text,
    full: a.parent ? `${top.text} · ${a.text}` : top.text,
  };
}

export const topAreas = list => list.filter(a => !a.parent && !a.archived);
export const subAreas = (list, pid) => list.filter(a => a.parent === pid && !a.archived);
