/* 圏外対策：アプリの骨組みと町丁目データを端末に保存。データ（Supabase）と地図（Google）はネット必須 */
const VERSION = 'v2';
const CACHE = 'chirashi-' + VERSION;
const SHELL = ['./', './index.html', './style.css', './app.js', './config.js', './manifest.json', './data/stations.json', './data/admin_aichi.geojson',
  './data/by_city/23425_蟹江町.geojson', './data/by_city/23208_津島市.geojson', './data/by_city/23232_愛西市.geojson', './data/by_city/23237_あま市.geojson', './data/by_city/23235_弥富市.geojson', './data/by_city/23424_大治町.geojson', './data/by_city/23427_飛島村.geojson',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js', 'https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('chirashi-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com') || u.hostname.endsWith('supabase.co') || u.hostname.endsWith('jma.go.jp') || u.hostname.endsWith('gsi.go.jp')) return; // 常にネット
  const isData = u.pathname.includes('/data/') || u.hostname === 'cdn.jsdelivr.net';
  if (isData) {
    // キャッシュ優先＋裏で更新
    e.respondWith(caches.open(CACHE).then(async c => { const hit = await c.match(e.request, { ignoreSearch: true }); const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null); return hit || (await net) || Response.error(); }));
    return;
  }
  // 骨組み：ネット優先、失敗したらキャッシュ（?v= の違いは無視）
  e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (e.request.mode === 'navigate' ? caches.match('./index.html', { ignoreSearch: true }) : Response.error())));
});
