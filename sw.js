// CLIPCUT Service Worker
// 버전 바꾸면 캐시 자동 갱신됨
const CACHE_VERSION = 'clipcut-v2.1';

const CACHE_STATIC = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// CDN 리소스 — 캐시해두면 오프라인에서도 폰트/라이브러리 로드됨
const CACHE_CDN = [
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Anybody:wght@400;700;900&display=swap',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js',
];

// ── 설치: 정적 파일 캐싱 ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      // 정적 파일은 반드시 캐싱
      return cache.addAll(CACHE_STATIC).then(() => {
        // CDN은 실패해도 설치 중단 안 함
        return Promise.allSettled(
          CACHE_CDN.map(url =>
            fetch(url, { mode: 'cors' })
              .then(res => { if (res.ok) cache.put(url, res); })
              .catch(() => {})
          )
        );
      });
    }).then(() => self.skipWaiting())
  );
});

// ── 활성화: 이전 캐시 삭제 ──────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── 요청 처리: Cache First → Network Fallback ──────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // POST / blob / chrome-extension 등은 캐시 건너뜀
  if (request.method !== 'GET') return;
  if (url.protocol === 'blob:' || url.protocol === 'chrome-extension:') return;

  // FFmpeg WASM 코어 — 용량 크므로 캐시 우선
  if (url.href.includes('ffmpeg-core')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // BGM 파일 — 네트워크 우선 (최신 파일), 실패 시 캐시
  if (url.href.includes('pixabay') || url.href.includes('.mp3')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 그 외 — Cache First
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok && url.origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => {
        // 오프라인 + 캐시 없음 → index.html 반환 (SPA 폴백)
        if (request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── 백그라운드 동기화 (향후 확장용) ──────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
