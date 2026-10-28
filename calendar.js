// 구글 캘린더 연동 — 플래너가 직접 만든 '학업 플래너' 캘린더에만 알림 일정을 맞춰 넣습니다.
// 권한(calendar.app.created)은 이 앱이 만든 캘린더와 그 일정만 다룰 수 있어서, 원래 쓰던 다른 캘린더에는 손대지 않습니다.
// 브라우저에서 받는 권한은 1시간 정도면 만료되고, 다시 받을 때는 버튼 같은 사용자 동작이 필요합니다.

const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const API = 'https://www.googleapis.com/calendar/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'planner.gcal.token.v1';
const EVER_KEY = 'planner.gcal.granted.v1';

// 같은 일정에는 항상 같은 ID를 붙여, 여러 기기에서 보내도 중복되지 않게 함(구글 규칙: 0-9, a-v만 허용 → 16진수 사용)
export const hexId = s => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const mins = e => (e.reminders?.overrides || []).map(o => o.minutes).sort((a, b) => a - b);
const t = x => Date.parse(x?.dateTime || x?.date || 0);
export const eventSig = e => fnv(JSON.stringify([e.summary || '', e.description || '', t(e.start), t(e.end), mins(e)]));
const same = (a, b) => eventSig(a) === eventSig(b) && a.reminders?.useDefault === false;

function err(message, extra) { return Object.assign(new Error(message), extra); }

export class GCal {
  constructor({ clientId }) {
    this.clientId = clientId || '';
    this.gisReady = null;
    this.token = (() => {
      try { const v = JSON.parse(localStorage.getItem(TOKEN_KEY)); return v && v.exp > Date.now() ? v : null; } catch { return null; }
    })();
  }

  get available() { return !!this.clientId; }
  get hasToken() { return !!(this.token && this.token.exp > Date.now() + 60000); }

  clearToken() {
    this.token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
  }

  // 구글 로그인 도구(GIS)를 미리 불러 둠 — 버튼을 누르는 순간 바로 창을 열어야 브라우저가 막지 않음
  loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!this.gisReady) {
      this.gisReady = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = GIS_SRC; s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { this.gisReady = null; s.remove(); reject(err('구글 연결 도구를 불러오지 못했습니다.', { code: 'gis' })); };
        document.head.appendChild(s);
      });
    }
    return this.gisReady;
  }

  // 사용자 동작(버튼) 안에서 불러야 함
  authorize() {
    const go = () => new Promise((resolve, reject) => {
      const oauth2 = window.google.accounts.oauth2;
      const timer = setTimeout(() => reject(err('구글 연결 창이 응답하지 않습니다.', { code: 'popup' })), 120000);
      const client = oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: r => {
          clearTimeout(timer);
          if (r.error) return reject(err(r.error_description || r.error, { code: r.error }));
          if (oauth2.hasGrantedAllScopes && !oauth2.hasGrantedAllScopes(r, SCOPE)) return reject(err('캘린더 권한을 허용하지 않았습니다.', { code: 'scope' }));
          this.token = { v: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
          try { localStorage.setItem(TOKEN_KEY, JSON.stringify(this.token)); localStorage.setItem(EVER_KEY, '1'); } catch { /* 무시 */ }
          resolve(this.token);
        },
        error_callback: e => { clearTimeout(timer); reject(err(e?.message || '구글 연결 창을 열 수 없었습니다.', { code: 'popup', type: e?.type })); },
      });
      let granted = false;
      try { granted = localStorage.getItem(EVER_KEY) === '1'; } catch { /* 무시 */ }
      client.requestAccessToken({ prompt: granted ? '' : 'consent' });
    });
    return window.google?.accounts?.oauth2 ? go() : this.loadGis().then(go);
  }

  revoke() {
    try { if (this.token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(this.token.v, () => {}); } catch { /* 무시 */ }
    this.clearToken();
    try { localStorage.removeItem(EVER_KEY); } catch { /* 무시 */ }
  }

  async api(method, path, body) {
    if (!this.hasToken) throw err('캘린더 연결이 만료됐습니다.', { status: 401 });
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${this.token.v}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* 본문 없음 */ }
    if (!res.ok) {
      if (res.status === 401) this.clearToken();
      throw err(data?.error?.message || `HTTP ${res.status}`, { status: res.status });
    }
    return data;
  }

  async createCalendar(summary, timeZone) {
    const r = await this.api('POST', '/calendars', { summary, timeZone, description: '학업 플래너가 알림 일정을 넣는 캘린더입니다. 일정은 플래너에서 고치면 자동으로 바뀝니다.' });
    return r.id;
  }
}

export const eventsPath = calId => `/calendars/${encodeURIComponent(calId)}/events`;

export async function insertEvent(gcal, base, ev) {
  try {
    await gcal.api('POST', base, ev);
  } catch (e) {
    // 예전에 지운 일정과 ID가 같으면 409 → 되살려서 덮어씀
    if (e.status === 409) await gcal.api('PUT', `${base}/${ev.id}`, { ...ev, status: 'confirmed' });
    else throw e;
  }
}

async function remove(gcal, path) {
  try { await gcal.api('DELETE', path); } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
}

// 원하는 일정 목록(desired)에 맞춰 캘린더를 고침. 지난 일정은 건드리지 않음. 바꾼 개수를 돌려줌
export async function syncCalendar(gcal, calId, desired, { from, deviceId, activeTimerId }) {
  const base = eventsPath(calId);
  const items = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ timeMin: from.toISOString(), maxResults: '2500', singleEvents: 'true', privateExtendedProperty: 'planner=1' });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await gcal.api('GET', `${base}?${q}`);
    items.push(...(r?.items || []));
    pageToken = r?.nextPageToken || '';
  } while (pageToken);

  const have = new Map(items.filter(e => e.status !== 'cancelled').map(e => [e.id, e]));
  const now = Date.now();
  let ops = 0;
  for (const ev of desired) {
    const cur = have.get(ev.id);
    have.delete(ev.id);
    if (t(ev.end) < now) continue;
    if (cur && same(cur, ev)) continue;
    if (cur) await gcal.api('PUT', `${base}/${ev.id}`, ev);
    else await insertEvent(gcal, base, ev);
    ops++;
  }
  for (const [id, e] of have) {
    const p = e.extendedProperties?.private || {};
    if (p.kind === 'timer') {
      const stale = t(e.end) < now - 10 * 60000 || (p.device === deviceId && id !== activeTimerId);
      if (!stale) continue;
    } else if (t(e.start) < now) {
      continue; // 지난 일정은 기록으로 남겨 둠
    }
    await remove(gcal, `${base}/${id}`);
    ops++;
  }
  return ops;
}
