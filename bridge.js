// 구글 캘린더 상시 연결 — 개인 구글 계정의 Apps Script를 다리로 씁니다.
// 브라우저가 받는 구글 권한은 1시간 정도면 만료되지만, Apps Script는 계정 주인의 권한으로 계속 실행되므로
// 한 번 설정해 두면 어느 기기에서든 로그인 창 없이 캘린더에 반영됩니다.
// 앱 → (POST, 비밀 값 포함) → Apps Script 웹 앱 → 구글 캘린더 API
// 요청은 text/plain으로 보내 브라우저의 사전 확인(preflight)을 피합니다(Apps Script는 OPTIONS를 받지 못함).

export function makeSecret() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

function err(message, code) { return Object.assign(new Error(message), { code }); }

export async function bridgeCall(url, secret, op, payload = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, op, secret }),
      redirect: 'follow',
    });
  } catch {
    throw err("Apps Script에 연결하지 못했습니다. 배포할 때 액세스 권한을 '모든 사용자'로 했는지, 주소가 /exec로 끝나는지 확인해 주세요.", 'net');
  }
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* 아래에서 안내 */ }
  if (!j) throw err("Apps Script 응답을 읽지 못했습니다. 배포할 때 액세스 권한을 '모든 사용자'로 했는지 확인해 주세요.", 'resp');
  if (!j.ok) {
    if (j.error === 'secret') throw err('비밀 값이 맞지 않습니다. 설정에서 코드를 다시 복사해 Apps Script에 붙여 넣고 새로 배포해 주세요.', 'secret');
    throw err(`Apps Script 오류: ${j.error}`, 'script');
  }
  return j;
}

// 사용자가 script.google.com에 붙여 넣을 코드. 비밀 값이 들어간 채로 만들어 줌
export function scriptCode(secret) {
  return `// Planerr 캘린더 다리 (Google Apps Script)
// Planerr가 보낸 일정 목록에 맞춰 Planerr 전용 캘린더만 고칩니다. 원래 쓰던 다른 캘린더에는 손대지 않습니다.
// 이 코드는 Planerr 설정에서 복사한 그대로 쓰세요(아래 SECRET은 Planerr와 맞춰져 있습니다).
// 1) 왼쪽 '서비스' 옆 + → Google Calendar API 추가 → 저장(스크립트가 캘린더 API를 쓰려면 필요)
// 2) 위쪽 함수 목록에서 setup 을 골라 실행 → 권한 허용
// 3) 배포 → 새 배포 → 유형: 웹 앱, 실행: 나, 액세스 권한: 모든 사용자 → 배포 → 웹 앱 URL을 Planerr 설정에 붙여 넣기

var SECRET = '${secret}';
var API = 'https://www.googleapis.com/calendar/v3';

function setup() {
  CalendarApp.getDefaultCalendar(); // 캘린더 권한을 받기 위한 줄
  Logger.log('권한 허용 완료. 이제 배포하세요.');
}

function doGet() { return out({ ok: true, app: 'planerr-bridge' }); }

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (!req || req.secret !== SECRET) return out({ ok: false, error: 'secret' });
    if (req.op === 'ping') return out({ ok: true, calendarId: calId(req) });
    if (req.op === 'sync') { var id = calId(req); return out({ ok: true, calendarId: id, ops: sync(id, req.desired || [], req) }); }
    if (req.op === 'put') { put(calId(req), req.event); return out({ ok: true }); }
    if (req.op === 'del') { del(calId(req), req.id); return out({ ok: true }); }
    return out({ ok: false, error: 'op' });
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function api(method, path, body) {
  var opt = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(API + path, opt), code = r.getResponseCode(), text = r.getContentText();
  if (code >= 300) { var e = new Error('HTTP ' + code + ' ' + text.slice(0, 300)); e.status = code; throw e; }
  return text ? JSON.parse(text) : null;
}

// Planerr 캘린더: 한 번 정해지면 이 스크립트에 기억해 두고 그 캘린더만 다룸. 지워졌으면 새로 만듦
function calId(req) {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('calendarId') || req.calendarId;
  if (id) {
    try { api('get', '/calendars/' + encodeURIComponent(id)); props.setProperty('calendarId', id); return id; }
    catch (e) { if (e.status !== 404 && e.status !== 403 && e.status !== 410) throw e; }
  }
  var c = api('post', '/calendars', { summary: req.name || 'Planerr', timeZone: req.timeZone || 'Asia/Seoul', description: 'Planerr가 알림 일정을 넣는 캘린더입니다. 일정은 Planerr에서 고치면 자동으로 바뀝니다.' });
  props.setProperty('calendarId', c.id);
  return c.id;
}

function base(id) { return '/calendars/' + encodeURIComponent(id) + '/events'; }
function fnv(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
function t(x) { return x ? Date.parse(x.dateTime || x.date || 0) : NaN; }
function mins(e) { return ((e.reminders && e.reminders.overrides) || []).map(function (o) { return o.minutes; }).sort(function (a, b) { return a - b; }); }
function sig(e) { return fnv(JSON.stringify([e.summary || '', e.description || '', t(e.start), t(e.end), mins(e)])); }
function same(a, b) { return sig(a) === sig(b) && a.reminders && a.reminders.useDefault === false; }

function insert(id, ev) {
  try { api('post', base(id), ev); }
  catch (e) { if (e.status === 409) { ev.status = 'confirmed'; api('put', base(id) + '/' + ev.id, ev); } else throw e; } // 예전에 지운 일정과 ID가 같으면 되살림
}
function put(id, ev) {
  try { api('put', base(id) + '/' + ev.id, ev); }
  catch (e) { if (e.status === 404) insert(id, ev); else throw e; }
}
function del(id, eventId) {
  try { api('delete', base(id) + '/' + encodeURIComponent(eventId)); }
  catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
}

// 원하는 일정 목록(desired)에 맞춰 고침. 지난 일정은 기록으로 남겨 둠. 바꾼 개수를 돌려줌
function sync(id, desired, req) {
  var items = [], token = '';
  do {
    var q = 'timeMin=' + encodeURIComponent(req.from) + '&maxResults=2500&singleEvents=true&privateExtendedProperty=' + encodeURIComponent('planner=1') + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var r = api('get', base(id) + '?' + q);
    items = items.concat((r && r.items) || []);
    token = (r && r.nextPageToken) || '';
  } while (token);
  var have = {}, now = Date.now(), ops = 0, active = req.activeTimerIds || [];
  items.forEach(function (e) { if (e.status !== 'cancelled') have[e.id] = e; });
  desired.forEach(function (ev) {
    var cur = have[ev.id];
    delete have[ev.id];
    if (t(ev.end) < now) return;
    if (cur && same(cur, ev)) return;
    if (cur) api('put', base(id) + '/' + ev.id, ev); else insert(id, ev);
    ops++;
  });
  Object.keys(have).forEach(function (k) {
    var e = have[k], p = (e.extendedProperties && e.extendedProperties.private) || {};
    if (p.kind === 'timer') {
      var stale = t(e.end) < now - 600000 || (p.device === req.deviceId && active.indexOf(k) < 0);
      if (!stale) return;
    } else if (t(e.start) < now) {
      return;
    }
    del(id, k);
    ops++;
  });
  return ops;
}
`;
}
