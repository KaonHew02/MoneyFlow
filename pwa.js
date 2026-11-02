/**
 * MoneyFlow — hands the page to sw.js, so the home-screen app opens offline.
 *
 * A file of its own rather than a line in index.html because the
 * Content-Security-Policy there refuses inline script (see guard.js).
 *
 * Service workers only run on https:// and on localhost. Anywhere else — a
 * page double-clicked open from disk — this does nothing, and the app runs
 * exactly as it did before there was a worker at all.
 */
(function () {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function (err) {
            // Offline launch is a bonus on top of a working app. Failing to
            // get it is a line in the console, not a red bar.
            console.warn('MoneyFlow: offline support is unavailable —', err);
        });
    });
})();
