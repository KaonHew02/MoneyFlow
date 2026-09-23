/**
 * MoneyFlow — the first script on the page, and the only one with no job of
 * its own. It used to sit inline in index.html; it lives in a file now so the
 * Content-Security-Policy there can refuse inline script altogether. That
 * refusal is what turns an injected `<script>` or `onerror=` — the shape every
 * cross-site-scripting attack takes — into a line in the console instead of
 * someone else's code running against your records.
 *
 * Four things, all before any script that can fail:
 *
 *   1. A red bar when something throws, because a half-started app is worse
 *      than a stopped one: the buttons wired before the throw keep working,
 *      the ones after it do nothing whatever you press, and the page looks
 *      completely normal the whole time.
 *
 *   2. No form on this page ever submits. Each one used to carry
 *      `onsubmit="return false;"`, which is inline script and so is refused by
 *      the same policy. One listener here says it for all of them.
 *
 *   3. The hand-off. store.js, app.js and drive.js need a few things from one
 *      another, and they used to pass them as globals — so anyone with the
 *      console open could type `ledgerState` or `backupApply(…)` and change
 *      the records from there. Now each script puts what it offers on a shelf
 *      here and takes what it needs, and the shelf is gone the moment the page
 *      has finished loading. After that nothing of the app is left on
 *      `window` to reach by name.
 *
 *   4. Speed bumps for the curious: a warning in the console, and no
 *      right-click "Inspect" or DevTools keys. None of this is a lock — the
 *      browser's own menu still opens DevTools, and nothing a web page does
 *      can stop that. What they stop is the casual attempt, and the warning
 *      stops the "paste this into your console" trick, which works on people
 *      rather than on code.
 */
(function () {
    var shown = false;

    function say(what) {
        // The first one is the cause. Everything after it is an echo, and a
        // stack of red bars helps nobody.
        if (shown) return;
        shown = true;

        var bar = document.createElement('div');
        bar.setAttribute('role', 'alert');
        bar.style.cssText = 'position:fixed;z-index:99999;left:0;right:0;top:0;padding:12px 16px;'
            + 'background:#7f1d1d;color:#fff;font:14px/1.45 system-ui,-apple-system,sans-serif;'
            + 'box-shadow:0 2px 12px rgba(0,0,0,.4);-webkit-user-select:text;user-select:text';
        bar.textContent = 'MoneyFlow hit an error, so part of this page will not respond: '
            + what + ' — your records are untouched. Reload the page, and quote that line to '
            + 'whoever maintains this.';

        var put = function () { (document.body || document.documentElement).appendChild(bar); };
        if (document.body) put(); else document.addEventListener('DOMContentLoaded', put);
    }

    window.addEventListener('error', function (event) {
        // A script from another origin is reported as a bare "Script error."
        // with nothing usable attached — Google's sign-in library, most often.
        // There is nothing to tell anyone, and it is not this app's fault.
        if (/^script error/i.test(event.message || '')) return;
        var file = (event.filename || '').split('/').pop().split('?')[0];
        say((event.message || 'an unnamed error')
            + (file ? ' (' + file + (event.lineno ? ':' + event.lineno : '') + ')' : ''));
    });

    // Work that failed with nobody waiting on it — the shape every hang in
    // this app has taken so far.
    window.addEventListener('unhandledrejection', function (event) {
        var why = event.reason;
        say('a background step failed — ' + ((why && why.message) || String(why)));
    });

    // Capture phase, on the document: it runs before anything else hears the
    // submit, and it covers forms that are added to the page later.
    document.addEventListener('submit', function (event) {
        event.preventDefault();
    }, true);

    /* ------------------------------------------------------------------ *
     * 3. The hand-off
     * ------------------------------------------------------------------ *
     * `take` removes what it hands over, so each thing reaches exactly the
     * script that asked for it. Every script takes what it needs as it runs,
     * and they all run before DOMContentLoaded — this listener is registered
     * first of all, so it fires first, and it throws the shelf away. Anything
     * a missing script never collected goes with it.
     */
    var shelf = Object.create(null);

    Object.defineProperty(window, 'MFHandoff', {
        configurable: true,
        value: Object.freeze({
            put: function (name, value) { if (shelf) shelf[name] = value; },
            take: function (name) {
                if (!shelf) return undefined;
                var value = shelf[name];
                delete shelf[name];
                return value;
            },
        }),
    });

    document.addEventListener('DOMContentLoaded', function () {
        delete window.MFHandoff;
        shelf = null;
    });

    // app.js reports a module that failed to load through the same bar: one
    // place on the page where "this is broken" is said, whoever noticed it.
    shelf.trouble = say;

    /* ------------------------------------------------------------------ *
     * 4. Speed bumps
     * ------------------------------------------------------------------ *
     * Set this to false while working on the app itself — a right-click and
     * F12 are the first things anyone debugging it reaches for.
     */
    var SPEED_BUMPS = true;
    if (!SPEED_BUMPS) return;

    if (window.console && console.log) {
        console.log('%cStop!', 'color:#dc2626;font:700 40px/1.2 system-ui,-apple-system,sans-serif');
        console.log('%cThis is a tool built into the browser for developers. If someone told you to '
            + 'paste something here — to unlock a feature, or to "fix" MoneyFlow — it is a trick. '
            + 'Code pasted here can read, change or delete every record in this browser.',
            'font:15px/1.5 system-ui,-apple-system,sans-serif');
    }

    // Right-click still works where it earns its place: in a text box, for
    // paste and spelling, and over selected text, for copy. Everywhere else
    // all it would offer is "Inspect".
    document.addEventListener('contextmenu', function (event) {
        var target = event.target;
        if (target && target.closest && target.closest('input, textarea, select, [contenteditable]')) return;
        if (window.getSelection && String(window.getSelection())) return;
        event.preventDefault();
    });

    // F12, and the keys for DevTools, the console, the element picker and the
    // page source: Ctrl+Shift+I/J/C and Ctrl+U, or Cmd+Option+I/J/C/U on a Mac.
    // Ctrl+Alt is left alone on purpose: on many keyboards that is AltGr, and
    // AltGr+C or AltGr+U types a letter.
    var DEVTOOLS_KEYS = ['KeyI', 'KeyJ', 'KeyC'];
    document.addEventListener('keydown', function (event) {
        var code = event.code || '';
        var devtools = event.key === 'F12'
            || (event.ctrlKey && event.shiftKey && DEVTOOLS_KEYS.indexOf(code) !== -1)
            || (event.metaKey && event.altKey && (DEVTOOLS_KEYS.indexOf(code) !== -1 || code === 'KeyU'))
            || (event.ctrlKey && !event.shiftKey && !event.altKey && code === 'KeyU');
        if (devtools) event.preventDefault();
    }, true);
})();
