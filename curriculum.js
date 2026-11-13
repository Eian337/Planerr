// 커리큘럼 — AI에게 줄 템플릿과, 붙여 넣은 글을 안내·단원·레슨으로 읽는 함수(화면과 무관한 순수 함수)
//
// 저장: curricula/{id} = { name, area, pace(주 n개, 0이면 정하지 않음), lmin(레슨 기본 분), guide(안내, 마크다운), created, archived,
//                          lessons: { id: { text, min(예상 분), memo, body(설명, 마크다운), h(단원 제목이면 true), opt(선택 레슨),
//                                           date(잡아 둔 날), done(끝낸 날짜), note(한 줄 남김), skip(건너뜀), o(순서) } } }

export const CUR_TEMPLATE = `아래 형식으로 커리큘럼을 짜 주세요. 결과는 플래너 앱(Planerr)에 그대로 붙여 넣어 씁니다.
앱은 이 글 하나만 보고 공부를 진행합니다. 그러니 레슨마다 그 자리에서 바로 할 수 있을 만큼의 설명과 과제를 레슨 아래에 적어 주세요.

[배우려는 것]:
[지금 수준]: (이미 되는 것 / 아직 없는 것)
[쓸 수 있는 시간과 도구]: (예: 평일 하루 10–20분, 주말 1시간 / 쓸 수 있는 기기·프로그램)
[끝냈을 때 되고 싶은 모습]:

━━ 형식 ━━

# 커리큘럼 이름

첫 단원 제목 전까지는 '안내'입니다. 이 커리큘럼을 쓰는 방법, 진행 원칙, 준비물, 같이 굴릴 습관 등을 ## 소제목으로 나눠 자유롭게 씁니다.

## 1단원 이름
단원 소개(선택). 이 단원에서 다루는 것과 고르는 요령을 두세 줄로.

### 1. 레슨 이름 | 15분
레슨 본문. 앱에서 레슨을 열면 이 부분이 그대로 보입니다. 아래 소제목은 예시이니 주제에 맞게 바꿔도 됩니다.
#### 무엇
#### 해 볼 것
#### 흔한 함정
#### 끝난 기준

### 2. (선택) 레슨 이름 | 10분
…

## 2단원 이름
### 3. 레슨 이름
…

━━ 형식 규칙 ━━
- 레슨 제목은 '### 번호. 이름 | 예상 시간'. 번호는 단원이 바뀌어도 1부터 다시 세지 말고 이어서 붙이기
- 예상 시간은 빼도 됩니다. 꼭 하지 않아도 되는 레슨은 이름 앞에 '(선택)'
- 본문에는 목록, 표, **굵게**, 인용(>), 코드 블록을 써도 됩니다
- 날짜·요일·주차는 넣지 않기(진도는 앱에서 관리합니다)
- 진행 기록용 체크 목록은 넣지 않기(앱이 끝낸 날짜와 한 줄 메모를 기록합니다)

━━ 짤 때 지킬 것 ━━
- 레슨 하나는 10–40분 안에 끝나는 크기로 작게
- 며칠 빠져도 다음 레슨을 이어 할 수 있게 짜고, 밀린 것을 몰아서 해야 하는 구조는 피하기
- 복습·반복 연습을 따로 길게 몰아넣지 말고 필요한 곳에 가볍게 섞기
- 앞쪽 레슨은 바로 할 수 있게 자세히 쓰고, 먼 레슨은 다룰 범위·과제·끝난 기준만 적은 지도로 두어도 됩니다(도착했을 때 설명을 채움)
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

const LIST = /^(?:[-*•·]|\d+[.)])\s+/;
const OPT = /^(?:\((?:선택|optional)\)|\[(?:선택|optional)\]|선택\s*[:)])\s*/i;
const OPT_END = /\s*[\[(](?:선택|optional)[\])]\s*$/i;
// 레슨 제목으로 보이는 번호: '순번 3 ·', '레슨 3', '3.', '3강', '1.2', 'H3 —'
const NUM = /^(?:(?:순번|레슨|lesson|step|day|unit|part|제)\s*\d+|\d+\.\d+|\d+\s*(?:[.)·:]|강|과|회|번|일차|주차)(?=\s|$)|[A-Za-z]{1,2}\d{1,3}(?=[\s.:·—–-]|$))/i;
// 앱이 번호를 붙이므로 앞 번호는 떼어 냄(H3 같은 기호는 남김)
const NUM_PFX = /^(?:(?:순번|레슨|lesson|step|day|unit|part|제)\s*\d+\s*(?:강|과|회|번)?|\d+\.\d+|\d+\s*(?:강|과|회|번|일차|주차)?)\s*[.)·:\-–—|]?\s+/i;
const CHECK = /^\s*[-*]\s+\[[ xX]\]/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);
const unmd = s => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
// 앞뒤 빈 줄과 끝의 가로줄을 걷어 냄
const tidy = lines => {
  const a = [...lines];
  while (a.length && (!a[0].trim() || HR.test(a[0]))) a.shift();
  while (a.length && (!a[a.length - 1].trim() || HR.test(a[a.length - 1]))) a.pop();
  return a.join('\n');
};

// 한 줄(목록 줄이나 제목) → 레슨 { text, min, memo, opt }
function lessonOf(raw, head = false) {
  let s = unmd(raw.replace(LIST, '').replace(/^\[[ xX]?\]\s*/, ''));
  let opt = false;
  if (OPT.test(s)) { opt = true; s = s.replace(OPT, ''); }
  if (OPT_END.test(s)) { opt = true; s = s.replace(OPT_END, ''); }
  let text = s, min = 0, memo = '';
  if (s.includes('|')) {
    const parts = s.split('|').map(x => x.trim());
    text = parts.shift();
    const rest = [];
    for (const p of parts) { if (!min && isTimePart(p)) min = parseMin(p); else if (p) rest.push(p); }
    memo = rest.join(' · ');
  } else {
    // '레슨 이름 (25분)', '레슨 이름 - 25분', '레슨 이름 — 25분: 메모', '레슨 이름 20분'
    const t = s.match(/^(.*?)\s*[(\[]\s*(?:약\s*)?([\d.]+\s*(?:시간|분|h|m|min)[^)\]]*)[)\]]\s*(.*)$/i)
      || s.match(/^(.*?)\s+[-–—]\s*(?:약\s*)?([\d.]+\s*(?:시간|분|min)(?:\s*\d+\s*분)?)\s*(?:[:：\-–—]\s*(.*))?$/i)
      || s.match(/^(.*?\S)\s+(?:약\s*)?(\d+(?:\.\d+)?\s*(?:시간(?:\s*\d+\s*분)?|분|min))$/i);
    if (t && t[1] && parseMin(t[2])) { text = t[1]; min = parseMin(t[2]); memo = (t[3] || '').replace(/^[:：\-–—]\s*/, ''); }
    else if (!head) {
      const c = s.match(/^(.{2,}?)\s*[:：]\s+(.+)$/);
      if (c && !/^https?$/i.test(c[1])) { text = c[1]; memo = c[2]; }
    }
  }
  if (OPT.test(text)) { opt = true; text = text.replace(OPT, ''); }
  if (OPT_END.test(text)) { opt = true; text = text.replace(OPT_END, ''); }
  text = clip(text.trim(), 120);
  return text ? { text, min, memo: clip(memo.trim(), 300), opt } : null;
}

// 제목 줄 목록(코드 블록 안은 뺌)
function headsOf(lines) {
  const out = [];
  let inCode = false;
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { inCode = !inCode; return; }
    const m = !inCode && raw.trim().match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (m) out.push({ i, level: m[1].length, text: unmd(m[2]) });
  });
  return out;
}

// 제목 중심 문서. L = 레슨 제목 수준. numbered면 번호 붙은 제목만 레슨
function parseHeadings(lines, heads, L, numbered) {
  const isLesson = h => h.level === L && (!numbered || NUM.test(h.text));
  // 단원 = 레슨보다 위 수준이면서, 같은 수준 이하의 다음 제목 전에 레슨이 하나라도 있는 제목
  const isSection = new Set();
  heads.forEach((h, k) => {
    if (h.level >= L) return;
    for (let j = k + 1; j < heads.length && heads[j].level > h.level; j++) if (isLesson(heads[j])) { isSection.add(k); return; }
  });
  // 맨 처음 제목이 '#'이면 커리큘럼 이름(그 앞의 글은 인사말로 보고 버림).
  // 단, '#' 제목이 여럿이고 첫 '#'이 곧바로 레슨을 품고 있으면 이름이 아니라 첫 단원으로 봄
  let name = '', hk = 0, from = 0;
  const first = heads[0];
  const tops = heads.filter(h => h.level === 1).length;
  const holdsLessonsDirectly = first && isSection.has(0) && !heads.slice(1).some((h, j) => h.level < L && isSection.has(j + 1) && h.level > first.level);
  if (first && first.level === 1 && !isLesson(first) && !(tops > 1 && holdsLessonsDirectly)) {
    name = clip(first.text, 80);
    isSection.delete(0);
    hk = 1; from = first.i + 1;
  }
  const guide = [], items = [], dropped = [];
  let cur = { kind: 'guide', lines: [] };
  const close = () => {
    if (cur.kind === 'guide') {
      const body = cur.lines.filter(l => l.trim() && !/^#{1,6}\s/.test(l.trim()) && !HR.test(l) && !/^\*\*[^*]+\*\*$/.test(l.trim()));
      const checks = body.filter(l => CHECK.test(l)).length;
      // 진행 기록용 체크 목록은 앱이 대신 기록하므로 뺌
      if (checks >= 5 && checks >= body.length * 0.6) { dropped.push(cur.title || '체크 목록'); return; }
      const t = tidy(cur.lines);
      if (t) guide.push(t);
    } else {
      const b = clip(tidy(cur.lines), 20000);
      if (b) cur.item.body = b;
      items.push(cur.item);
    }
  };
  for (let i = from; i < lines.length; i++) {
    const h = heads[hk] && heads[hk].i === i ? heads[hk] : null;
    if (!h) { cur.lines.push(lines[i]); continue; }
    const k = hk++;
    if (isLesson(h)) {
      close();
      const l = lessonOf(h.text.replace(NUM_PFX, ''), true) || { text: clip(h.text, 120), min: 0, memo: '', opt: false };
      cur = { kind: 'lesson', item: l, lines: [] };
    } else if (isSection.has(k)) {
      close();
      cur = { kind: 'sec', item: { h: true, text: clip(h.text, 80) }, lines: [] };
    } else if (h.level > L && cur.kind !== 'guide') {
      cur.lines.push(lines[i]); // 레슨·단원 안의 소제목
    } else {
      close();
      cur = { kind: 'guide', title: h.text, lines: [lines[i]] };
    }
  }
  close();
  // 레슨이 하나도 없는 단원 제목은 뺌
  const out = items.filter((x, i) => !x.h || (items[i + 1] && !items[i + 1].h));
  return { name, guide: clip(guide.join('\n\n'), 60000), items: out.slice(0, 400), dropped };
}

// 목록 중심 문서: '#' 이름, '##' 단원, 목록 줄 = 레슨, 레슨 줄 아래 들여쓴 줄 = 그 레슨 설명, 첫 제목·목록 전의 글 = 안내
function parseList(lines) {
  let name = '', inCode = false, seen = false;
  const rows = [], guide = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (!line) continue;
    if (HR.test(line)) { rows.push({ kind: 'hr' }); continue; }
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      const t = clip(unmd(hm[2].replace(/#+\s*$/, '')), 80);
      if (hm[1].length === 1 && !name && !seen) name = t;
      else if (t) { rows.push({ kind: 'h', text: t }); seen = true; }
      continue;
    }
    if (LIST.test(line) && !/^\s{2,}/.test(raw)) { rows.push({ kind: 'li', text: line }); seen = true; continue; }
    if (/^\s{2,}/.test(raw)) { rows.push({ kind: 'ind', text: line }); continue; }
    rows.push({ kind: 'p', text: line, before: !seen });
  }
  const hasList = rows.some(r => r.kind === 'li');
  const items = [];
  let last = null;
  for (const r of rows) {
    if (r.kind === 'h') { items.push({ h: true, text: r.text }); last = null; }
    else if (r.kind === 'li' || (r.kind === 'p' && !hasList)) { const l = lessonOf(r.text); if (l) { items.push(l); last = l; } }
    else if (r.kind === 'ind' && last) last.body = last.body ? `${last.body}\n${r.text}` : r.text;
    else if (r.kind === 'p' && r.before && hasList) guide.push(r.text);
    else if (r.kind === 'hr') last = null;
  }
  const out = items.filter((x, i) => !x.h || (items[i + 1] && !items[i + 1].h));
  return { name, guide: guide.join('\n'), items: out.slice(0, 400), dropped: [] };
}

// 붙여 넣은 글 → { name, guide, items: [{ h: true, text, body } | { text, min, memo, opt, body }], dropped, mode }
// 번호 붙은 제목('### 3. …', '## 순번 3 · …')이 여럿이면 제목 하나를 레슨 하나로, 그 아래 글을 설명으로 읽음
// AI가 결과 전체를 \`\`\`markdown 블록으로 감싸 주는 경우가 많아, 제목이 든 마크다운 블록은 울타리만 걷어 냄
function unwrapFences(lines) {
  const out = [], inside = [], outside = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^```\s*([\w-]*)\s*$/);
    if (!m) { out.push(lines[i]); outside.push(lines[i]); continue; }
    let j = i + 1;
    while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) j++;
    const inner = lines.slice(i + 1, j);
    const md = /^(?:markdown|md|text|txt)?$/i.test(m[1]) && inner.some(l => /^#{1,6}\s/.test(l.trim()));
    if (md) { out.push(...inner); inside.push(...inner); } else { const blk = lines.slice(i, Math.min(j + 1, lines.length)); out.push(...blk); outside.push(...blk); }
    i = j;
  }
  // 감싼 블록 밖에 제목이 없으면 밖의 글(인사·맺음말)은 버림
  if (inside.length && !outside.some(l => /^#{1,6}\s/.test(l.trim()))) return inside;
  return out;
}

export function parseCurriculum(src) {
  const lines = unwrapFences(String(src || '').replace(/\r/g, '').split('\n'));
  const heads = headsOf(lines);
  const count = lv => heads.filter(h => h.level === lv && NUM.test(h.text)).length;
  let best = 0, L = 0;
  for (const lv of [2, 3, 4]) { const n = count(lv); if (n > best) { best = n; L = lv; } }
  if (best >= 2) return { ...parseHeadings(lines, heads, L, true), mode: 'heading' };
  const n2 = heads.filter(h => h.level === 2).length, n3 = heads.filter(h => h.level === 3).length;
  if (n3 >= 2 && n2 >= 1) return { ...parseHeadings(lines, heads, 3, false), mode: 'heading' };
  if (lines.some(l => LIST.test(l.trim()))) return { ...parseList(lines), mode: 'list' };
  if (n2 >= 2) return { ...parseHeadings(lines, heads, 2, false), mode: 'heading' };
  return { ...parseList(lines), mode: 'list' };
}
