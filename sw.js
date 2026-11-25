/* Offline cache: network first for pages, cache fallback. */
var CACHE = 'habits-v25';
var FILES = ['./', 'index.html', 'config.js', 'css/style.css', 'js/data.js', 'js/ideas.js', 'js/app.js', 'js/ai.js', 'js/theme.js', 'js/data-extra.js', 'js/todoist.js', 'js/screen.js', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // fonts, Worker, Todoist: straight to the network
  // 'no-cache' revalidates with the server, so an online visitor never gets stale site files
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(function (r) {
    if (r.ok) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    }
    return r;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (m) { return m || caches.match('index.html'); });
  }));
});
