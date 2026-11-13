// 커리큘럼 — AI에게 줄 템플릿과, 붙여넣은 글을 레슨 목록으로 읽는 함수(화면과 무관한 순수 함수)
//
// 저장: curricula/{id} = { name, area, pace(주 n개, 0이면 정하지 않음), created, archived,
//                          lessons: { id: { text, min(예상 분), memo, h(단원 제목이면 true), opt(선택 레슨), date(잡아 둔 날),
//                                           done(끝낸 날짜), note(한 줄 남김), skip(건너뜀), o(순서) } } }

export const CUR_TEMPLATE = `아래 형식으로 커리큘럼을 짜 주세요. 결과는 플래너 앱(Planerr)에 그대로 붙여 넣어 쓸 것입니다.

[배우려는 것]: (예: 화성학 기초부터 짧은 곡 완성까지)
[지금 수준]:
[쓸 수 있는 시간]: (예: 평일 하루 20–30분, 주말 1시간)
[끝냈을 때 되고 싶은 모습]:

형식
- 첫 줄은 '# 커리큘럼 이름'
- 단원은 '## 단원 이름'
- 레슨은 한 줄에 하나씩 '- 레슨 이름 | 예상 시간 | 메모'
  예) - 장3화음과 단3화음 구분 | 25분 | 건반으로 직접 쳐 보며 소리 차이 듣기
- 예상 시간과 메모는 빼도 됩니다. 메모에는 할 일이나 참고 링크를 짧게
- 꼭 하지 않아도 되는 레슨은 이름 앞에 '(선택)'
- 날짜·요일·주차는 넣지 않기(진도는 앱에서 관리합니다)
- 형식 밖의 설명은 맨 끝에 짧게만

짤 때 지킬 것
- 레슨 하나는 15–40분 안에 끝나는 크기로 작게
- 며칠 빠져도 다음 레슨을 이어 할 수 있게 짜고, 밀린 것을 몰아서 해야 하는 구조는 피하기
- 복습·반복 연습을 따로 길게 몰아넣지 말고 필요한 곳에 가볍게 섞기
- 단원이 끝날 때마다 작은 결과물(짧은 곡 조각, 그림 한 장, 글 한 단락 등)이 남게
`;

// '25분', '1시간', '1시간 30분', '1.5h', '40 min' → 분. 없으면 0
export function parseMin(s) {
  if (!s) return 0;
  const h = String(s).match(/(\d+(?:\.\d+)?)\s*(?:시간|hours?|hrs?|h(?![a-z]))/i);
  const m = String(s).match(/(\d+)\s*(?:분|minutes?|mins?|m(?![a-z]))/i);
  const v = Math.round((h ? parseFloat(h[1]) * 60 : 0) + (m ? parseInt(m[1], 10) : 0));
  return v > 0 && v <= 600 ? v : 0;
}
// 이 칸이 시간만 적은 칸인지(예: '약 25분', '(30분)', '~1시간')
const isTimePart = p => parseMin(p) > 0 && /^[\s(~약]*\d/.test(p) && p.replace(/[\d.\s()~약]|시간|분|hours?|hrs?|minutes?|mins?|h|m/gi, '') === '';

const LIST = /^(?:[-*•·]|\d+[.)]|\[[ xX]?\])\s+/;
const OPT = /^(?:\((?:선택|optional)\)|\[(?:선택|optional)\]|선택\s*[:)])\s*/i;
const clip = (s, n) => s.length > n ? s.slice(0, n) : s;
const unmd = s => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]+)`/g, '$1').trim();

function lessonOf(raw) {
  let s = unmd(raw.replace(LIST, '').replace(/^\[[ xX]?\]\s*/, ''));
  let opt = false;
  if (OPT.test(s)) { opt = true; s = s.replace(OPT, ''); }
  let text = s, min = 0, memo = '';
  if (s.includes('|')) {
    const parts = s.split('|').map(x => x.trim());
    text = parts.shift();
    const rest = [];
    for (const p of parts) { if (!min && isTimePart(p)) min = parseMin(p); else if (p) rest.push(p); }
    memo = rest.join(' · ');
  } else {
    // '레슨 이름 (25분)', '레슨 이름 - 25분', '레슨 이름 — 25분: 메모'
    const t = s.match(/^(.*?)\s*[(\[]\s*(?:약\s*)?([\d.]+\s*(?:시간|분|h|m|min)[^)\]]*)[)\]]\s*(.*)$/i)
      || s.match(/^(.*?)\s+[-–—]\s*(?:약\s*)?([\d.]+\s*(?:시간|분|min)(?:\s*\d+\s*분)?)\s*(?:[:：\-–—]\s*(.*))?$/i)
      || s.match(/^(.*?\S)\s+(?:약\s*)?(\d+(?:\.\d+)?\s*(?:시간(?:\s*\d+\s*분)?|분|min))$/i);
    if (t && t[1] && parseMin(t[2])) { text = t[1]; min = parseMin(t[2]); memo = (t[3] || '').replace(/^[:：\-–—]\s*/, ''); }
    else {
      const c = s.match(/^(.{2,}?)\s*[:：]\s+(.+)$/);
      if (c && !/^https?$/i.test(c[1])) { text = c[1]; memo = c[2]; }
    }
  }
  if (OPT.test(text)) { opt = true; text = text.replace(OPT, ''); }
  text = clip(text.trim(), 120);
  return text ? { text, min, memo: clip(memo.trim(), 300), opt } : null;
}

// 붙여 넣은 글 → { name, items: [{ h: true, text } | { text, min, memo, opt }] }
// '#' 첫 줄은 이름, '##' 이하는 단원, 목록 줄(-, *, 1.)은 레슨. 목록 줄이 하나도 없으면 제목이 아닌 줄을 모두 레슨으로 봄
export function parseCurriculum(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let name = '', inCode = false;
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (!line || /^(?:-{3,}|\*{3,}|_{3,})$/.test(line) || /^>/.test(line)) continue;
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      const t = clip(unmd(hm[2].replace(/#+\s*$/, '')), 80);
      if (hm[1].length === 1 && !name && !rows.some(x => x.kind !== 'p')) name = t;
      else if (t) rows.push({ kind: 'h', text: t });
      continue;
    }
    rows.push({ kind: LIST.test(line) ? 'li' : 'p', text: line });
  }
  const hasList = rows.some(r => r.kind === 'li');
  const items = [];
  for (const r of rows) {
    if (r.kind === 'h') items.push({ h: true, text: r.text });
    else if (r.kind === 'li' || !hasList) { const l = lessonOf(r.text); if (l) items.push(l); }
  }
  // 레슨이 없는 단원 제목은 빼고, 끝에 남은 단원 제목(설명 머리 등)도 뺌
  const out = items.filter((x, i) => !x.h || (items[i + 1] && !items[i + 1].h));
  return { name, items: out.slice(0, 400) };
}
