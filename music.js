// 음악 재생기와 기기 저장소
// - Player: 곡 목록({ id, name, url })을 받아 재생만 담당(공부용·알람용·미리 듣기용으로 따로 씀)
// - 기기 저장소(IndexedDB 'planner-music'):
//     cache  — 이 기기에 받아 둔 곡 파일(곡 id → Blob). 플리 정보는 Firebase로 동기화되고, 파일은 구글 드라이브를 거쳐 기기마다 받음
//     tracks, study — v1.7 이전에 기기에만 저장하던 알람 음악·공부 플리(새 구조로 옮긴 뒤 비움)

const DB_NAME = 'planner-music';
const STORES = ['tracks', 'study', 'cache'];
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, s === 'cache' ? undefined : { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function withStore(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const cacheGet = id => withStore('cache', 'readonly', s => s.get(id)).then(v => v || null);
export const cachePut = (id, blob) => withStore('cache', 'readwrite', s => s.put(blob, id));
export const cacheDelete = id => withStore('cache', 'readwrite', s => s.delete(id));
export const cacheIds = () => withStore('cache', 'readonly', s => s.getAllKeys()).then(keys => new Set(keys || []));

export async function legacyTracks(store) {
  try {
    const rows = (await withStore(store, 'readonly', s => s.getAll())) || [];
    return rows.filter(r => r && r.blob).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  } catch { return []; }
}
export const legacyClear = store => withStore(store, 'readwrite', s => s.clear()).catch(() => {});

export class Player {
  constructor({ onChange, onTime } = {}) {
    this.list = [];          // [{ id, name, url }] — 이 기기에 있는 곡만
    this.cur = -1;
    this.playing = false;
    this.alarmPlaying = false;
    this.unlocked = false;
    this.repeat = false;
    this.onChange = onChange || (() => {});
    this.onTime = onTime || (() => {});
    this.aud = new Audio();
    this.aud.preload = 'auto';
    this.aud.addEventListener('ended', () => {
      if (this.cur < this.list.length - 1) this.play(this.cur + 1);
      else if (this.repeat && this.list.length) this.play(0);
      else { this.playing = false; this.alarmPlaying = false; this.onChange(); }
    });
    this.aud.addEventListener('timeupdate', () => this.onTime(this.aud.currentTime, this.aud.duration));
  }

  // 목록을 바꿔도 듣던 곡이 남아 있으면 이어서 재생
  setList(list, repeat) {
    const curId = this.list[this.cur]?.id;
    this.list = list;
    this.repeat = !!repeat;
    this.cur = curId ? list.findIndex(t => t.id === curId) : -1;
    if (curId && this.cur < 0) {
      this.aud.pause();
      this.aud.removeAttribute('src');
      this.playing = false;
      this.alarmPlaying = false;
    }
    this.onChange();
  }

  play(i) {
    if (i < 0 || i >= this.list.length) return Promise.resolve(false);
    this.cur = i;
    this.aud.muted = false;
    this.aud.src = this.list[i].url;
    return this.aud.play()
      .then(() => { this.playing = true; this.onChange(); return true; })
      .catch(() => { this.playing = false; this.onChange(); return false; });
  }

  toggle() {
    if (!this.list.length) return;
    if (this.cur < 0 || this.cur >= this.list.length) { this.play(0); return; }
    if (this.playing) this.pause();
    else this.resume();
  }

  prev() { if (this.cur > 0) this.play(this.cur - 1); else if (this.repeat && this.list.length) this.play(this.list.length - 1); }
  next() { if (this.cur < this.list.length - 1) this.play(this.cur + 1); else if (this.repeat && this.list.length) this.play(0); }

  seek(frac) {
    if (Number.isFinite(this.aud.duration) && this.aud.duration > 0) this.aud.currentTime = frac * this.aud.duration;
  }

  resume() {
    if (!this.list.length || this.playing) return Promise.resolve(this.playing);
    if (this.cur < 0 || this.cur >= this.list.length || !this.aud.src) return this.play(0);
    this.aud.muted = false;
    return this.aud.play().then(() => { this.playing = true; this.onChange(); return true; }).catch(() => false);
  }

  pause() {
    if (!this.playing) return;
    this.aud.pause();
    this.playing = false;
    this.alarmPlaying = false;
    this.onChange();
  }

  // 아이폰·아이패드는 사용자가 누르지 않은 상태에서 소리를 막으므로, 타이머 시작 버튼을 누를 때 미리 허락을 받아 둠
  unlock() {
    if (this.unlocked || !this.list.length || this.playing) return;
    this.unlocked = true;
    const a = this.aud;
    a.muted = true;
    a.src = this.list[0].url;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; this.unlocked = false; });
  }

  // 타이머 종료 시 첫 곡부터 재생. 재생하지 못하면 false
  playAlarm() {
    if (!this.list.length) return Promise.resolve(false);
    this.alarmPlaying = true;
    return this.play(0).then(ok => { if (!ok) this.alarmPlaying = false; return ok; });
  }

  stopAlarm() {
    if (!this.alarmPlaying) return;
    this.aud.pause();
    this.aud.currentTime = 0;
    this.playing = false;
    this.alarmPlaying = false;
    this.onChange();
  }
}
