/**
 * ====================================================================
 * MoneyFlow — where the records actually live
 * --------------------------------------------------------------------
 * This was `localStorage` directly, and localStorage has one hard problem:
 * browsers cap it at about 5 MB per **origin**, and no setting anywhere
 * raises it. On GitHub Pages that cap is worse than it sounds, because
 * `you.github.io` is a single origin — every project published under the
 * account shares the same five megabytes.
 *
 * IndexedDB, in the same browser and the same origin, is offered a share of
 * free disk instead: three gigabytes on the machine this was written on, six
 * hundred times the room, for no loss of anything. It works offline, it needs
 * no account, and it is just as instant.
 *
 * The catch is that it is asynchronous, and this app reads its records
 * synchronously all over the place. So:
 *
 *   **Everything is mirrored in memory.** `init()` reads every record out of
 *   IndexedDB once, before the app starts. After that `get` is a plain object
 *   lookup — synchronous, instant, and the twenty-odd call sites in app.js did
 *   not have to change shape.
 *
 *   **Writes never block.** `set` updates the mirror synchronously and queues
 *   the disk write. Nothing in the app has ever read a value back immediately
 *   after writing it, so nothing waits.
 *
 *   **Writes are coalesced per key.** Typing an amount fires a save per
 *   keystroke; only the last one for each key needs to reach the disk.
 *
 * Preferences — the theme, the sidebar, the Drive stamp — deliberately stay in
 * localStorage. They are tiny, they are wanted before the first paint, and a
 * theme that flickers because it waited for a database is a worse theme.
 *
 * If IndexedDB is missing or refuses to open, this falls back to localStorage
 * and the app is exactly what it was. That path is not a rare curiosity: it is
 * what the test harness runs on.
 * ====================================================================
 */

const MFStore = (() => {

    const DB_NAME = 'moneyflow';
    const DB_VERSION = 1;
    const SHELF = 'records';

    /** Every record key this app owns. Preferences are not in here. */
    const RECORD_KEYS = [
        'moneyflow.ledger.v1',
        'moneyflow.categories.v1',
        'moneyflow.budget.v1',
        'moneyflow.goals.v1',
        'moneyflow.commit.v1',
        'moneyflow.card.v1',
        'moneyflow.grow.v1',
        'moneyflow.split.v1',
    ];

    /** The one before the rename, so a very old book still opens. */
    const legacyKey = (key) => key.replace('moneyflow.', 'moneysplitor.');

    let db = null;
    const mirror = Object.create(null);

    /** Keys written since the last flush, and the timer that will flush them. */
    const dirty = new Set();
    let flushTimer = null;

    /**
     * Told the outcome of every flush: an error when one could not be made,
     * and `null` when one lands. Both matter — a warning that never clears
     * itself is a warning people learn to ignore. app.js paints it.
     */
    let report = () => {};

    /* ------------------------------------------------------------------ *
     * Opening
     * ------------------------------------------------------------------ */

    function open() {
        return new Promise((resolve) => {
            let idb = null;
            try { idb = window.indexedDB; } catch (err) { idb = null; }
            if (!idb) return resolve(null);

            let request;
            try { request = idb.open(DB_NAME, DB_VERSION); } catch (err) { return resolve(null); }

            request.onupgradeneeded = () => {
                const conn = request.result;
                if (!conn.objectStoreNames.contains(SHELF)) conn.createObjectStore(SHELF);
            };
            request.onsuccess = () => resolve(request.result);

            // Private windows in some browsers allow `indexedDB` to exist and
            // then refuse to open it. That is a fallback, not a failure.
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        });
    }

    const readAll = (conn) => new Promise((resolve) => {
        let out = {};
        try {
            const tx = conn.transaction(SHELF, 'readonly');
            const shelf = tx.objectStore(SHELF);
            RECORD_KEYS.forEach((key) => {
                const request = shelf.get(key);
                request.onsuccess = () => {
                    if (typeof request.result === 'string') out[key] = request.result;
                };
            });
            tx.oncomplete = () => resolve(out);
            tx.onerror = () => resolve(out);
            tx.onabort = () => resolve(out);
        } catch (err) { resolve(out); }
    });

    const fromLocal = (key) => {
        try {
            return localStorage.getItem(key) || localStorage.getItem(legacyKey(key));
        } catch (err) { return null; }
    };

    /**
     * Reads everything into the mirror, and moves an existing localStorage book
     * across the first time.
     *
     * The old copy is **left where it is**. A migration that deletes the only
     * other copy of someone's records, on the strength of one write it has not
     * verified, is not a migration anyone should ship.
     */
    const hydrateFromLocal = () => {
        RECORD_KEYS.forEach((key) => {
            const held = fromLocal(key);
            if (held !== null && held !== undefined) mirror[key] = held;
        });
        return { backend: 'localStorage', migrated: 0 };
    };

    const haveIdb = () => {
        try { return !!window.indexedDB; } catch (err) { return false; }
    };

    /**
     * The synchronous path, for when there is no IndexedDB to wait for.
     *
     * It exists so the app can start in the same tick it always did wherever
     * IndexedDB is absent — which is every jsdom test in this repo. Returns
     * false when there *is* a database, and the caller must then await `init`.
     */
    function initSync(handler) {
        if (typeof handler === 'function') report = handler;
        if (haveIdb()) return false;
        hydrateFromLocal();
        return true;
    }

    async function init(handler) {
        if (typeof handler === 'function') report = handler;

        db = await open();

        if (!db) return hydrateFromLocal();

        const found = await readAll(db);
        Object.keys(found).forEach((key) => { mirror[key] = found[key]; });

        let migrated = 0;
        RECORD_KEYS.forEach((key) => {
            if (mirror[key] !== undefined) return;
            const held = fromLocal(key);
            if (held === null || held === undefined) return;
            mirror[key] = held;
            dirty.add(key);
            migrated++;
        });
        if (migrated) await flush();

        return { backend: 'indexedDB', migrated };
    }

    /* ------------------------------------------------------------------ *
     * Reading and writing
     * ------------------------------------------------------------------ */

    const get = (key) => (mirror[key] === undefined ? null : mirror[key]);

    function set(key, value) {
        mirror[key] = String(value);
        dirty.add(key);
        schedule();
        return true;
    }

    function remove(key) {
        delete mirror[key];
        dirty.add(key);
        schedule();
        return true;
    }

    /**
     * Coalescing only earns its keep on IndexedDB, where a write is a
     * transaction. localStorage is synchronous and was written on every
     * keystroke for the whole life of this app before now — so on the fallback
     * the write happens immediately, which also means a reload a millisecond
     * later finds it, and nothing has to know which backend it is on.
     */
    function schedule() {
        if (!db) { flush(); return; }
        if (flushTimer) return;
        // Long enough to swallow a burst of keystrokes, short enough that
        // closing the tab a moment later still finds the write done.
        flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 250);
    }

    /** Writes every dirty key. Resolves whether it worked or not — the caller
     *  is a timer, and the failure goes to `onFailure` instead. */
    function flush() {
        if (!dirty.size) return Promise.resolve(true);

        const keys = Array.from(dirty);
        dirty.clear();

        if (!db) {
            let ok = true;
            keys.forEach((key) => {
                try {
                    if (mirror[key] === undefined) localStorage.removeItem(key);
                    else localStorage.setItem(key, mirror[key]);
                } catch (err) { ok = false; report(err); }
            });
            if (ok) report(null);
            return Promise.resolve(ok);
        }

        return new Promise((resolve) => {
            let tx;
            try { tx = db.transaction(SHELF, 'readwrite'); }
            catch (err) { report(err); return resolve(false); }

            const shelf = tx.objectStore(SHELF);
            keys.forEach((key) => {
                try {
                    if (mirror[key] === undefined) shelf.delete(key);
                    else shelf.put(mirror[key], key);
                } catch (err) { /* the transaction's own error handler reports it */ }
            });

            tx.oncomplete = () => { report(null); resolve(true); };
            tx.onerror = () => { report(tx.error || new Error('write failed')); resolve(false); };
            tx.onabort = () => { report(tx.error || new Error('write aborted')); resolve(false); };
        });
    }

    /* ------------------------------------------------------------------ *
     * How much room there is
     * ------------------------------------------------------------------ */

    /** What the mirror weighs, in bytes, by key. */
    function usage() {
        return RECORD_KEYS
            .filter((key) => mirror[key] !== undefined)
            .map((key) => ({ key, bytes: (key.length + mirror[key].length) * 2 }))
            .sort((a, b) => b.bytes - a.bytes);
    }

    /**
     * The ceiling. On IndexedDB the browser will say, and it is measured in
     * gigabytes; on the fallback it is the five megabytes localStorage allows
     * and no browser will tell you that, so it is stated here.
     */
    let budget = 5 * 1024 * 1024;
    const budgetBytes = () => budget;

    async function measure() {
        if (!db) return budget;
        try {
            const est = await navigator.storage.estimate();
            if (est && est.quota) budget = est.quota;
        } catch (err) { /* the default stands */ }
        return budget;
    }

    /* ------------------------------------------------------------------ *
     * Asking not to be thrown away
     * ------------------------------------------------------------------ *
     * By default a browser treats an origin's storage as **best-effort**: it
     * may clear it when the disk gets tight, without asking. That is a fine
     * default for a site caching images and a poor one for the only copy of
     * somebody's ledger. `persist()` asks for the durable kind instead.
     *
     * Asked **once**, and only once there is something worth keeping — Firefox
     * puts a permission prompt in front of this, and a prompt on an empty
     * first visit is a prompt about nothing.
     */
    const ASKED_KEY = 'moneyflow.store.persistAsked';

    async function persist() {
        try {
            if (!navigator.storage || !navigator.storage.persist) return 'unsupported';
            if (await navigator.storage.persisted()) return 'already';
            if (localStorage.getItem(ASKED_KEY)) return 'asked before';

            localStorage.setItem(ASKED_KEY, '1');
            return (await navigator.storage.persist()) ? 'granted' : 'refused';
        } catch (err) {
            return 'unsupported';
        }
    }

    const persisted = async () => {
        try {
            return !!(navigator.storage && navigator.storage.persisted
                && await navigator.storage.persisted());
        } catch (err) { return false; }
    };

    return {
        RECORD_KEYS, init, initSync, get, set, remove, flush, usage, budgetBytes, measure,
        persist, persisted,
        backend: () => (db ? 'indexedDB' : 'localStorage'),
    };
})();
