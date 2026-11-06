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

/**
 * No zooming, the way a phone app does not zoom.
 *
 * iOS ignores user-scalable and maximum-scale for gestures, and the one CSS
 * value that stops a double tap (touch-action: manipulation, in style.css) is
 * also the one that allows a pinch, so the pinch is refused here.
 *
 * Touch screens only: a trackpad pinch on a computer is left alone.
 */
(function () {
    if (!('ontouchstart' in window)) return;

    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
        document.addEventListener(name, function (event) { event.preventDefault(); });
    });

    document.addEventListener('touchmove', function (event) {
        if (event.touches.length > 1 && event.cancelable) event.preventDefault();
    }, { passive: false });
})();
