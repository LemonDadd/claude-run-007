// 离线缓存：应用外壳与已访问的数据块采用 cache-first
const CACHE = 'bishun-zitie-v4';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/data-loader.js',
  'js/player.js',
  'js/sheet.js',
  'js/exporter.js',
  'vendor/jspdf.umd.min.js',
  'data/index.json',
  'data/templates.json',
  'data/t2s.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        // 数据块等静态资源动态入缓存
        if (res.ok && (url.pathname.startsWith('/data/') || url.pathname.startsWith('/js/') ||
            url.pathname.startsWith('/css/') || url.pathname.startsWith('/vendor/'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
