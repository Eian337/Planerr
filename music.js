// 음악 목록 — 올린 음악 파일을 이 기기의 IndexedDB에 저장해 새로고침해도 목록이 남게 합니다.
// 목록마다 저장소가 따로 있습니다: 'tracks'(알람 음악), 'study'(공부 플레이리스트)
// (음악 파일은 용량이 커서 기기 간 동기화하지 않습니다.)

const DB_NAME = 'planner-music';
const STORES = ['tracks', 'study'];
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
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
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class Music {
  constructor({ store = 'tracks', defaultRepeat = false, onChange, onTime, onError }) {
    this.store = store;
    this.list = [];          // [{ id, name, url }]
    this.cur = -1;
    this.playing = false;
    this.alarmPlaying = false;
    this.unlocked = false;
    this.repeatKey = store === 'tracks' ? 'planner.music.repeat' : `planner.music.repeat.${store}`;
    this.repeat = (() => { try { const v = localStorage.getItem(this.repeatKey); return v === null ? defaultRepeat : v === '1'; } catch { return defaultRepeat; } })();
    this.onChange = onChange || (() => {});
    this.onTime = onTime || (() => {});
    this.onError = onError || (() => {});
    this.aud = new Audio();
    this.aud.preload = 'auto';
    this.aud.addEventListener('ended', () => {
      if (this.cur < this.list.length - 1) this.play(this.cur + 1);
      else if (this.repeat && this.list.length) this.play(0);
      else { this.playing = false; this.alarmPlaying = false; this.onChange(); }
    });
    this.aud.addEventListener('timeupdate', () => this.onTime(this.aud.currentTime, this.aud.duration));
  }

  async load() {
    try {
      const rows = (await withStore(this.store, 'readonly', s => s.getAll())) || [];
      rows.sort((a, b) => a.order - b.order);
      this.list = rows.map(t => ({ id: t.id, name: t.name, url: URL.createObjectURL(t.blob) }));
    } catch (e) {
      console.warn('음악 목록을 불러오지 못했습니다.', e);
    }
    this.onChange();
  }

  async add(files) {
    let order = this.list.length;
    let failed = 0;
    for (const file of files) {
      const id = newId();
      try {
        await withStore(this.store, 'readwrite', s => s.put({ id, name: file.name, blob: file, order: order++ }));
      } catch (e) {
        console.warn(e);
        failed++;
      }
      this.list.push({ id, name: file.name, url: URL.createObjectURL(file) });
    }
    try { navigator.storage?.persist?.(); } catch { /* 무시 */ }
    if (failed) this.onError(`저장 공간이 부족해 ${failed}곡은 이 기기에 저장하지 못했습니다(새로고침하면 사라짐).`);
    this.onChange();
  }

  _saveOrder() {
    const ids = this.list.map(t => t.id);
    withStore(this.store, 'readwrite', s => {
      ids.forEach((id, i) => {
        const g = s.get(id);
        g.onsuccess = () => { if (g.result) { g.result.order = i; s.put(g.result); } };
      });
    }).catch(e => console.warn(e));
  }

  // 끌어서 바꾼 순서(id 목록)를 그대로 적용
  reorder(ids) {
    const curId = this.list[this.cur]?.id;
    const byId = new Map(this.list.map(t => [t.id, t]));
    const next = ids.map(id => byId.get(id)).filter(Boolean);
    if (next.length !== this.list.length) return;
    this.list = next;
    this.cur = curId ? next.findIndex(t => t.id === curId) : -1;
    this._saveOrder();
    this.onChange();
  }

  move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this.list.length) return;
    [this.list[i], this.list[j]] = [this.list[j], this.list[i]];
    if (this.cur === i) this.cur = j; else if (this.cur === j) this.cur = i;
    this._saveOrder();
    this.onChange();
  }

  remove(i) {
    const t = this.list[i];
    if (!t) return;
    if (this.cur === i) { this.aud.pause(); this.playing = false; this.alarmPlaying = false; this.cur = -1; }
    else if (this.cur > i) this.cur--;
    URL.revokeObjectURL(t.url);
    this.list.splice(i, 1);
    withStore(this.store, 'readwrite', s => s.delete(t.id)).catch(e => console.warn(e));
    this._saveOrder();
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
    if (this.playing) { this.aud.pause(); this.playing = false; this.alarmPlaying = false; this.onChange(); }
    else this.aud.play().then(() => { this.playing = true; this.onChange(); }).catch(() => {});
  }

  prev() { if (this.cur > 0) this.play(this.cur - 1); else if (this.repeat && this.list.length) this.play(this.list.length - 1); }
  next() { if (this.cur < this.list.length - 1) this.play(this.cur + 1); else if (this.repeat && this.list.length) this.play(0); }

  toggleRepeat() {
    this.repeat = !this.repeat;
    try { localStorage.setItem(this.repeatKey, this.repeat ? '1' : '0'); } catch { /* 무시 */ }
    this.onChange();
  }

  seek(frac) {
    if (Number.isFinite(this.aud.duration) && this.aud.duration > 0) this.aud.currentTime = frac * this.aud.duration;
  }

  // 공부 플레이리스트용: 멈춘 곳부터 이어서 재생 / 일시정지
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
