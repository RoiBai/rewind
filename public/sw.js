const CACHE_NAME = 'rewind-shell-v99';
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const withBase = (path) => `${BASE_PATH}${path}`;
const APP_SHELL = [
  withBase('/'),
  withBase('/index.html'),
  withBase('/manifest.json'),
  withBase('/icons/icon-192.png'),
  withBase('/icons/icon-512.png'),
  withBase('/icons/apple-touch-icon.png'),
  withBase('/screenshots/app.png'),
  withBase('/illustrations/loop.svg')
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(withBase('/index.html'), copy));
          return response;
        })
        .catch(() => caches.match(withBase('/index.html')))
    );
    return;
  }

  if (new URL(request.url).pathname.startsWith(withBase('/unity/'))) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
