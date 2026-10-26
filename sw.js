// 서비스 워커 — 앱 파일을 기기에 저장해 두어 오프라인에서도 열리게 합니다.
// 온라인이면 항상 새 파일을 먼저 받아 오므로(네트워크 우선), GitHub에 올린 업데이트는
// 다음에 온라인 상태로 앱을 열 때 반영됩니다. 파일을 추가하면 아래 SHELL 목록에도 넣어 주세요.

const VERSION = 'v1.0.0';
const CACHE = `study-planner-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './store.js',
  './config.js',
  './vendor/firebase.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('study-planner-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase 통신 등은 건드리지 않음
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT)),
    ]);
    if (res && res.ok) cache.put(req.url, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req.url, { ignoreSearch: true })
      || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (hit) return hit;
    return new Response('오프라인 상태이고 저장된 파일이 없습니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
