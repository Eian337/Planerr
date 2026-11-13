// 간단한 마크다운 → HTML (커리큘럼 안내·레슨 설명 보기용). 글자는 모두 이스케이프한 뒤 정해진 표시만 태그로 바꿈
// 지원: 제목(#), 문단(줄바꿈 유지), **굵게**, *기울임*, `코드`, [글](링크), 맨 주소, 목록(-, *, 1.)과 들여쓴 하위 목록,
//       체크 목록([ ], [x]), 인용(>), 코드 블록(```), 표(| a | b |), 가로줄(---)

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const A = u => `<a href="${u}" target="_blank" rel="noopener">`;

function inline(src) {
  const codes = [];
  let s = String(src).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `${A(u)}${t}</a>`);
  s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, (_, p, u) => `${p}${A(u)}${u.length > 48 ? `${u.slice(0, 46)}…` : u}</a>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?![\s*])(.+?)(?<!\s)\*(?![*\w])/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}
const check = t => {
  const m = t.match(/^\[([ xX])\]\s+(.*)$/s);
  return m ? `<span class="md-cb">${m[1] === ' ' ? '☐' : '☑'}</span> ${inline(m[2])}` : inline(t);
};
const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());

function listHtml(items) {
  let html = '';
  const stack = [];
  for (const it of items) {
    const top = stack[stack.length - 1], tag = it.ord ? 'ol' : 'ul';
    if (!top || it.ind > top.ind) { html += `<${tag}>`; stack.push({ ind: it.ind, tag }); }
    else {
      while (stack.length > 1 && it.ind < stack[stack.length - 1].ind) html += `</li></${stack.pop().tag}>`;
      html += '</li>';
    }
    html += `<li>${it.text.split('\n').map(check).join('<br>')}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

// head: 가장 높은 제목 수준을 몇 번째 제목 태그로 보여 줄지(기본 h4). 나머지는 그 아래로 차례로
export function renderMd(src, { head = 4 } = {}) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let inCode = false;
  const levels = lines.filter(l => { if (/^\s*```/.test(l)) inCode = !inCode; return !inCode && /^#{1,6}\s/.test(l.trim()); }).map(l => l.trim().match(/^#+/)[0].length);
  const top = levels.length ? Math.min(...levels) : 1;
  const out = [], para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para.length = 0; } };
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i], line = raw.trim();
    let m;
    if (/^```/.test(line)) {
      flush();
      const buf = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line) { flush(); i++; continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*$/))) {
      flush();
      const lv = Math.min(6, head + m[1].length - top);
      out.push(`<h${lv} class="md-h">${inline(m[2])}</h${lv}>`);
      i++;
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (line.startsWith('>')) {
      flush();
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) buf.push(lines[i++].trim().replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMd(buf.join('\n'), { head })}</blockquote>`);
      continue;
    }
    if (line.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      flush();
      const hd = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${hd.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${hd.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(?:[-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length) {
        const r = lines[i].replace(/\t/g, '  '), mm = r.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (mm) { items.push({ ind: mm[1].length, ord: /\d/.test(mm[2]), text: mm[3] }); i++; continue; }
        if (r.trim() && /^\s{2,}/.test(r) && items.length) { items[items.length - 1].text += `\n${r.trim()}`; i++; continue; }
        break;
      }
      out.push(listHtml(items));
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out.join('');
}

// 미리보기용: 마크다운 표시를 걷어낸 앞부분 글자
export function plainPreview(src, n = 120) {
  const t = String(src || '').replace(/```[\s\S]*?```/g, ' ').split('\n').map(l => l.trim())
    .filter(l => l && !/^(?:#{1,6}\s|\||-{3,}|>?\s*$)/.test(l))
    .map(l => l.replace(/^>\s?/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/\*\*|`/g, '')).join(' ');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
