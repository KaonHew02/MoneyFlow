/**
 * MoneyFlow — the service worker. What lets the home-screen app open with no
 * signal.
 *
 * The records were never the problem: they live in IndexedDB on the phone and
 * need no network. The *app* was — index.html, app.js and the rest came from
 * GitHub Pages on every launch, so in a lift or on a plane the icon on the
 * home screen opened onto Safari's "not connected" page.
 *
 * The rule is **network first, cache as the fallback**:
 *
 *   - Online, every file comes from the network exactly as before, and a copy
 *     is kept. An update on Pages reaches the phone on the next launch, with
 *     no "close it twice to see the new version" dance.
 *
 *   - Offline, the kept copy is served instead.
 *
 * Cache-first would open faster, but it serves yesterday's app.js until the
 * worker notices, and a finance app quietly running old code is worse than
 * one that takes a second longer to open.
 *
 * "The network" has to mean the server, not the browser's own HTTP cache.
 * Pages sends every file with a ten-minute max-age, so a plain fetch of the
 * page was answered from that cache for ten minutes after a push — the old
 * index.html, asking for the old ?v= scripts. Anything without a ?v= stamp is
 * therefore fetched `no-cache`: always asked of the server, which answers a
 * cheap "304, unchanged" when it is. Stamped files keep the HTTP cache, since
 * a new version arrives under a new address anyway.
 *
 * Copies are kept by path, ignoring the ?v= stamp. index.html is the one place
 * that stamp is bumped, so this file does not have to be touched alongside it:
 * a new `app.js?v=22` replaces the kept `app.js?v=21` rather than piling up
 * beside it.
 *
 * Only this app's own files and the icon font are touched. Google sign-in, the
 * Drive API and the exchange-rate lookup go straight to the network, never
 * through here — a cached Drive response is a stale ledger, and a cached
 * sign-in response is a security bug.
 */

const CACHE = 'moneyflow-app';

/** Fetched once at install, so the very first launch already works offline. */
const SHELL = [
    './',
    'index.html',
    'style.css',
    'phone.css',
    'guard.js',
    'store.js',
    'app.js',
    'drive-config.js',
    'drive.js',
    'pwa.js',
    'logo.svg',
    'logo-dark.svg',
    'logo-icon.svg',
    'manifest.webmanifest',
    'icons/icon-180.png',
    'icons/icon-192.png',
    'icons/icon-512.png',
];

const ICON_FONT = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/';

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll(SHELL);
        // The icon font is nice to have, not a reason to refuse to install.
        await Promise.allSettled([
            'font/bootstrap-icons.min.css',
            'font/fonts/bootstrap-icons.woff2',
            'font/fonts/bootstrap-icons.woff',
        ].map((file) => cache.add(new Request(ICON_FONT + file, { mode: 'cors' }))));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) {
            if (name !== CACHE) await caches.delete(name);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    const ours = url.origin === self.location.origin;
    if (!ours && !req.url.startsWith(ICON_FONT)) return;

    // A navigation cannot be refetched with new options as it stands; `new
    // Request` turns its mode into same-origin and keeps its redirect mode.
    const ask = ours && !url.searchParams.has('v') ? new Request(req, { cache: 'no-cache' }) : req;
    event.respondWith(networkFirst(req, ask, event));
});

async function networkFirst(req, ask, event) {
    const cache = await caches.open(CACHE);
    try {
        const res = await fetch(ask);
        // Only whole, readable answers are kept. A 404 or an opaque response
        // kept here would be served back offline as if it were the app.
        if (res.ok && res.type !== 'opaque') {
            const copy = res.clone();
            event.waitUntil((async () => {
                await cache.delete(req, { ignoreSearch: true });
                await cache.put(req, copy);
            })());
        }
        return res;
    } catch (err) {
        const kept = await cache.match(req, { ignoreSearch: true })
            || (req.mode === 'navigate' && (await cache.match('./') || await cache.match('index.html')));
        if (kept) return kept;
        throw err;
    }
}
