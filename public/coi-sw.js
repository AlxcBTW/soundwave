/*
 * Cross-origin isolation for hosts that cannot send headers (GitHub Pages). The analysis runs its
 * model on several threads, which needs SharedArrayBuffer, which a page only gets when it is served
 * with Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy. This worker adds both headers to
 * every response the page receives. Registered by src/main.tsx on the website only; the desktop app
 * and the development server send the headers themselves.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // A request the browser may only answer from its cache, made for another origin, cannot be repeated here.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  event.respondWith(
    fetch(request).then((response) => {
      // Opaque responses (no-cors) cannot be read or changed.
      if (response.status === 0) return response;
      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }),
  );
});
