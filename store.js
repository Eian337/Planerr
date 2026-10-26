// 데이터 계층
// config.js에 Firebase 설정이 있으면 '클라우드 모드'(오프라인 캐시 + 기기 간 동기화),
// 없으면 이 기기의 브라우저에만 저장하는 '로컬 모드'로 동작합니다.
//
// 저장 구조 (클라우드: users/{uid}/{컬렉션}/{문서}, 로컬: 같은 모양의 JSON)
//   days/{YYYY-MM-DD}  하루 기록: task, action, cue, started, startedAt, focusMin, done, projectId, milestoneId
//   projects/{id}      장기 과제: name, start, deadline, buffer, milestones[{id,title,due,done}], archived
//   weeks/{월요일 날짜} 주간 목표: goals[{id,text,done,projectId}]
//   meta/settings      설정: timerMin
// 새 기능은 users/{uid} 아래에 컬렉션을 추가하면 되며, 보안 규칙을 고칠 필요가 없습니다.

import { firebaseConfig } from './config.js';

const LOCAL_KEY = 'planner.local.v1';
export const COLS = ['days', 'projects', 'weeks', 'meta'];
const emptyData = () => ({ days: {}, projects: {}, weeks: {}, meta: {} });
const clean = v => JSON.parse(JSON.stringify(v));
const hasConfig = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

export class Store {
  constructor() {
    this.data = emptyData();
    this.listeners = new Set();
    this.status = {
      mode: hasConfig ? 'cloud' : 'local',
      phase: 'loading', // loading → (login | syncing) → ready, 또는 error
      user: null,
      online: navigator.onLine,
      pending: false,
      error: null,
    };
    this._pending = {};
    this._unsubs = [];
    addEventListener('online', () => this._setStatus({ online: true }));
    addEventListener('offline', () => this._setStatus({ online: false }));
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // reason: 'data'(화면 전체를 다시 그림) | 'status'(동기화 표시만 갱신)
  _emit(reason = 'data') {
    for (const fn of this.listeners) { try { fn(reason); } catch (e) { console.error(e); } }
  }

  _setStatus(p) {
    const big = ('phase' in p && p.phase !== this.status.phase) || ('error' in p && p.error !== this.status.error);
    Object.assign(this.status, p);
    this._emit(big ? 'data' : 'status');
  }

  clearError() { this._setStatus({ error: null }); }

  async init() {
    if (!hasConfig) {
      this._loadLocal();
      this._setStatus({ phase: 'ready' });
      return;
    }
    let fb;
    try {
      fb = this.fb = await import('./vendor/firebase.js');
    } catch (e) {
      console.error(e);
      this._setStatus({ phase: 'error', error: '앱 구성 요소를 불러오지 못했습니다. 처음 한 번은 인터넷에 연결된 상태로 열어 주세요.' });
      return;
    }
    try {
      const app = fb.initializeApp(firebaseConfig);
      try {
        this.db = fb.initializeFirestore(app, {
          localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
        });
      } catch (e) {
        console.warn('오프라인 캐시를 쓸 수 없어 메모리 캐시로 동작합니다.', e);
        this.db = fb.initializeFirestore(app, { localCache: fb.memoryLocalCache() });
      }
      this.auth = fb.getAuth(app);
    } catch (e) {
      console.error(e);
      this._setStatus({ phase: 'error', error: 'Firebase 설정을 확인해 주세요: ' + (e.code || e.message) });
      return;
    }
    fb.onAuthStateChanged(this.auth, user => this._onUser(user));
  }

  _onUser(user) {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
    this._pending = {};
    this.data = emptyData();
    if (!user) {
      this._setStatus({ phase: 'login', user: null, pending: false });
      return;
    }
    this._setStatus({ phase: 'syncing', user: { uid: user.uid, email: user.email } });
    const fb = this.fb;
    const seen = new Set();
    for (const c of COLS) {
      const ref = fb.collection(this.db, 'users', user.uid, c);
      this._unsubs.push(fb.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
        const first = !seen.has(c);
        seen.add(c);
        const changed = first || snap.docChanges().length > 0;
        if (changed) {
          const obj = {};
          snap.forEach(d => { obj[d.id] = d.data(); });
          this.data[c] = obj;
        }
        this._pending[c] = snap.metadata.hasPendingWrites;
        this.status.pending = Object.values(this._pending).some(Boolean);
        if (seen.size === COLS.length && this.status.phase !== 'ready') {
          this._setStatus({ phase: 'ready' });
          return;
        }
        this._emit(changed ? 'data' : 'status');
      }, err => {
        console.error(err);
        seen.add(c);
        const msg = err.code === 'permission-denied'
          ? '동기화 권한이 없습니다. Firestore 보안 규칙을 확인해 주세요.'
          : '동기화 오류: ' + (err.code || err.message);
        this._setStatus({ error: msg, ...(seen.size === COLS.length ? { phase: 'ready' } : {}) });
      }));
    }
  }

  // 문서 일부 필드만 덮어쓰기(병합). 오프라인이면 기기에 저장해 두었다가 연결되면 올라갑니다.
  set(col, id, patch) {
    patch = clean(patch);
    const next = { ...(this.data[col][id] || {}), ...patch, updatedAt: Date.now() };
    this.data[col] = { ...this.data[col], [id]: next };
    if (this.status.mode === 'local') { this._saveLocal(); this._emit('data'); return; }
    const uid = this.status.user?.uid;
    if (!uid) return;
    this._emit('data');
    this.fb.setDoc(this.fb.doc(this.db, 'users', uid, col, id), { ...patch, updatedAt: next.updatedAt }, { merge: true })
      .catch(e => this._setStatus({ error: '저장하지 못했습니다: ' + (e.code || e.message) }));
  }

  remove(col, id) {
    const copy = { ...this.data[col] };
    delete copy[id];
    this.data[col] = copy;
    if (this.status.mode === 'local') { this._saveLocal(); this._emit('data'); return; }
    const uid = this.status.user?.uid;
    if (!uid) return;
    this._emit('data');
    this.fb.deleteDoc(this.fb.doc(this.db, 'users', uid, col, id))
      .catch(e => this._setStatus({ error: '삭제하지 못했습니다: ' + (e.code || e.message) }));
  }

  // 로컬 모드에서 쓰던 기록을 현재 저장소로 옮김(이미 있는 문서는 건너뜀). 옮긴 개수를 돌려줍니다.
  importData(src) {
    if (!src) return 0;
    const writes = [];
    for (const c of COLS) {
      for (const [id, v] of Object.entries(src[c] || {})) {
        if (!this.data[c][id]) writes.push([c, id, clean(v)]);
      }
    }
    if (!writes.length) return 0;
    for (const [c, id, v] of writes) this.data[c] = { ...this.data[c], [id]: v };
    if (this.status.mode === 'local') { this._saveLocal(); this._emit('data'); return writes.length; }
    const uid = this.status.user?.uid;
    if (!uid) return 0;
    for (let i = 0; i < writes.length; i += 400) {
      const batch = this.fb.writeBatch(this.db);
      for (const [c, id, v] of writes.slice(i, i + 400)) batch.set(this.fb.doc(this.db, 'users', uid, c, id), v);
      batch.commit().catch(e => this._setStatus({ error: '가져오기에 실패했습니다: ' + (e.code || e.message) }));
    }
    this._emit('data');
    return writes.length;
  }

  localBackup() {
    try { const raw = localStorage.getItem(LOCAL_KEY); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }

  login(email, pw) { return this.fb.signInWithEmailAndPassword(this.auth, email, pw); }
  signup(email, pw) { return this.fb.createUserWithEmailAndPassword(this.auth, email, pw); }
  resetPassword(email) { return this.fb.sendPasswordResetEmail(this.auth, email); }
  logout() { return this.fb.signOut(this.auth); }

  _loadLocal() {
    const saved = this.localBackup();
    if (saved) this.data = { ...emptyData(), ...saved };
  }

  _saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.data)); }
    catch { this._setStatus({ error: '이 기기에 저장하지 못했습니다. 저장 공간을 확인해 주세요.' }); }
  }
}
