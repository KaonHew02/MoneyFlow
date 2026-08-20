/**
 * ====================================================================
 * MoneyFlow — the copy that lives in Google Drive
 * --------------------------------------------------------------------
 * localStorage stays the working store. It is instant, it works with no
 * network and no account, and the app is fully usable if this file never
 * loads at all. Drive is the *second* copy: the one that survives a cleared
 * browser, and the one you can pull down onto another machine.
 *
 * That ordering is the whole design. An app that cannot open its own ledger
 * because Google is having a bad morning is a worse app than one that keeps
 * its records locally and syncs when it can.
 *
 * What goes up is exactly what Export writes — `backupEnvelope()` from app.js,
 * the same shape, the same version field. So a file pulled off Drive can be
 * fed to Import, and a file made by Export can be dropped into the Drive
 * folder by hand. One format, three routes in.
 *
 * On scope: this asks for `drive.file`, which grants access only to files this
 * app itself created. It cannot read your other documents, and it cannot list
 * your Drive. That is deliberate and it is also why it needs no review from
 * Google — the wider scopes do.
 * ====================================================================
 */

(() => {

    const $ = (id) => document.getElementById(id);

    const SCOPE = 'https://www.googleapis.com/auth/drive.file';
    const API   = 'https://www.googleapis.com/drive/v3';
    const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

    const cfg = (typeof MF_DRIVE !== 'undefined') ? MF_DRIVE : null;

    const configured = () => !!cfg
        && !/YOUR-CLIENT-ID/i.test(cfg.clientId || '')
        && !!cfg.folderId;

    /** The current access token, and when it stops being any use. */
    let token = null;
    let tokenExpires = 0;
    let tokenClient = null;

    /** The Drive file id, once found or created. Cached so each save is one call. */
    let fileId = null;

    const valid = () => token && Date.now() < tokenExpires - 60000;

    /* ------------------------------------------------------------------ *
     * Signing in
     * ------------------------------------------------------------------ */

    /**
     * Google's library is loaded from their CDN by a tag in index.html. If the
     * network is down, or a blocker ate it, every Drive button has to fail
     * with something a person can act on rather than `google is not defined`.
     */
    function library() {
        if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
            throw new Error('Google’s sign-in library did not load. Check your internet '
                + 'connection, or whether an extension is blocking accounts.google.com.');
        }
        return google.accounts.oauth2;
    }

    /**
     * Asks for a token, silently if Google already knows the answer.
     *
     * `prompt: ''` means "do not put a window in front of them if you do not
     * have to". The first time, and after a consent is revoked, Google ignores
     * that and shows the picker anyway — which is correct, and is the only
     * time this should interrupt anyone.
     */
    function authorize(interactive) {
        return new Promise((resolve, reject) => {
            if (valid()) return resolve(token);

            const oauth2 = library();

            if (!tokenClient) {
                tokenClient = oauth2.initTokenClient({
                    client_id: cfg.clientId,
                    scope: SCOPE,
                    callback: () => {},          // replaced per request, below
                });
            }

            tokenClient.callback = (response) => {
                if (response.error) {
                    // access_denied is a person clicking Cancel, not a fault.
                    if (/access_denied|user_cancel/i.test(response.error)) {
                        return reject(new Error('Sign-in was cancelled, so nothing was sent to Drive.'));
                    }
                    return reject(new Error('Google refused the sign-in: ' + response.error));
                }
                token = response.access_token;
                tokenExpires = Date.now() + (Number(response.expires_in || 3600) * 1000);
                resolve(token);
            };

            tokenClient.error_callback = (err) => {
                reject(new Error(err && err.type === 'popup_closed'
                    ? 'The Google sign-in window was closed before it finished.'
                    : 'The Google sign-in window could not open. Allow pop-ups for this site and try again.'));
            };

            tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
        });
    }

    /* ------------------------------------------------------------------ *
     * Talking to Drive
     * ------------------------------------------------------------------ */

    /**
     * Every Drive response goes through here. A 401 means the token went stale
     * mid-flight, which is normal after an hour and is worth exactly one silent
     * retry rather than an error in someone's face.
     */
    async function call(url, options = {}, retrying = false) {
        const response = await fetch(url, {
            ...options,
            headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token },
        });

        if (response.status === 401 && !retrying) {
            token = null;
            await authorize(false);
            return call(url, options, true);
        }

        if (!response.ok) {
            let detail = '';
            try {
                const body = await response.json();
                detail = (body.error && body.error.message) || '';
            } catch (err) { /* a non-JSON error body tells us nothing extra */ }

            if (response.status === 403 && /insufficient|permission/i.test(detail)) {
                throw new Error('Google allowed the sign-in but refused the folder. Check that the '
                    + 'folder ID in drive-config.js is a folder you can edit.');
            }
            if (response.status === 404) {
                throw new Error('That folder no longer exists, or this account cannot see it. '
                    + 'Check the folder ID in drive-config.js.');
            }
            throw new Error('Drive refused the request (' + response.status + ')'
                + (detail ? ': ' + detail : '.'));
        }

        return response;
    }

    /**
     * Finds the app's file in the folder, or reports that there is not one yet.
     *
     * The query is scoped to the folder *and* the name, because a `drive.file`
     * search only ever sees files this app made — so a file the user dragged
     * in by hand is invisible here, and a second one would otherwise be
     * created silently beside it.
     */
    async function findFile() {
        if (fileId) return fileId;

        const query = encodeURIComponent(
            `'${cfg.folderId}' in parents and name = '${cfg.filename}' and trashed = false`);
        const response = await call(
            `${API}/files?q=${query}&fields=files(id,name,modifiedTime)&pageSize=1`);
        const body = await response.json();

        fileId = (body.files && body.files[0] && body.files[0].id) || null;
        return fileId;
    }

    async function readFile(id) {
        const response = await call(`${API}/files/${id}?alt=media`);
        return response.json();
    }

    /** When Drive last saw a change, so a pull can say how old its copy is. */
    async function fileModified(id) {
        const response = await call(`${API}/files/${id}?fields=modifiedTime`);
        const body = await response.json();
        return body.modifiedTime || null;
    }

    /**
     * Creates the file the first time and updates it every time after. The
     * create is a multipart upload because the metadata (name, parent folder)
     * and the content have to arrive together, or the file lands in the root
     * of My Drive instead of the folder that was asked for.
     */
    async function writeFile(envelope) {
        const body = JSON.stringify(envelope, null, 2);
        const id = await findFile();

        if (id) {
            await call(`${UPLOAD}/files/${id}?uploadType=media`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            return id;
        }

        const boundary = 'moneyflow-' + Math.random().toString(36).slice(2);
        const metadata = { name: cfg.filename, parents: [cfg.folderId], mimeType: 'application/json' };
        const multipart =
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
            + JSON.stringify(metadata)
            + `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`
            + body
            + `\r\n--${boundary}--`;

        const response = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
            body: multipart,
        });

        fileId = (await response.json()).id;
        return fileId;
    }

    /* ------------------------------------------------------------------ *
     * The two buttons
     * ------------------------------------------------------------------ */

    function notConfigured() {
        backupSay('Drive is not set up yet',
            'Paste your Google OAuth client ID into drive-config.js — docs/DRIVE.md walks '
            + 'through making one. Until then, Export and Import still work and still keep '
            + 'your records safe.');
    }

    async function push(btn) {
        if (!configured()) return notConfigured();

        try {
            flashButton(btn, '<i class="bi bi-arrow-repeat"></i><span>Saving…</span>');
            await authorize(false);
            await writeFile(backupEnvelope());
            remember();
            flashButton(btn, '<i class="bi bi-check-lg"></i><span>In Drive</span>');
        } catch (err) {
            backupSay('Could not save to Drive', err.message);
        }
    }

    /**
     * Pulling is the dangerous direction — it replaces what is on this machine
     * — so it goes through the same confirmation Import does, and says what is
     * in both copies before anyone agrees to anything.
     */
    async function pull(btn) {
        if (!configured()) return notConfigured();

        try {
            flashButton(btn, '<i class="bi bi-arrow-repeat"></i><span>Reading…</span>');
            await authorize(false);

            const id = await findFile();
            if (!id) {
                return backupSay('There is nothing in Drive yet',
                    'MoneyFlow has not written to that folder before. Press "To Drive" first, '
                    + 'and this becomes the way to get those records onto another computer.');
            }

            const envelope = await readFile(id);
            if (!envelope || envelope.format !== 'moneyflow.backup') {
                return backupSay('That Drive file is not readable',
                    'The file in the folder is not a MoneyFlow backup. Rename or remove it and '
                    + 'press "To Drive" to write a fresh one.');
            }

            const modified = (await fileModified(id) || '').slice(0, 10) || 'an unknown date';

            askConfirm(
                'Replace what is here with the Drive copy?',
                'Drive holds ' + backupSummary(envelope) + ', last written ' + modified + '. '
                + 'This browser holds ' + backupSummary(backupEnvelope()) + ', and all of it will be '
                + 'replaced. If this machine has the newer figures, cancel and press "To Drive" instead.',
                'Use the Drive copy',
                () => backupApply(envelope));
        } catch (err) {
            backupSay('Could not read from Drive', err.message);
        }
    }

    /* ------------------------------------------------------------------ *
     * Sending it up on its own
     * ------------------------------------------------------------------ *
     * Off by default, and it has to be: this file's whole promise is that
     * nothing leaves the browser unless someone presses a button. A switch
     * makes that a choice rather than a change made on everyone's behalf.
     *
     * Two rules keep it from being obnoxious once it is on:
     *
     *   It never opens a sign-in window. A popup nobody asked for gets
     *   blocked, and a popup that is not blocked is worse. If the token has
     *   lapsed the auto-push simply stands down and the stamp goes stale,
     *   which is exactly the signal that says "press the button".
     *
     *   It waits for the typing to stop. A push per keystroke would be a
     *   hundred writes to Drive for one evening's entries.
     */
    const AUTO_KEY  = 'moneyflow.drive.auto';
    const AUTO_WAIT = 60000;

    let autoTimer = null;

    const autoOn = () => {
        try { return localStorage.getItem(AUTO_KEY) === 'on'; } catch (err) { return false; }
    };

    function setAuto(on) {
        try { localStorage.setItem(AUTO_KEY, on ? 'on' : 'off'); } catch (err) { /* not vital */ }
        paintAuto();
        // The stamp's wording depends on the switch — "Auto is waiting on you"
        // is only true while it is on — so it is repainted with it.
        showStamp();
        if (on) schedule(); else clearTimeout(autoTimer);
    }

    function paintAuto() {
        const btn = $('driveAuto');
        if (!btn) return;
        const on = autoOn();
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', String(on));
        btn.title = on
            ? 'Sending a copy to Drive about a minute after you stop editing. Click to stop.'
            : 'Off — nothing goes to Drive unless you press "To Drive". Click to send it automatically.';
    }

    /** Called by app.js whenever a record changes. */
    function schedule() {
        if (!autoOn() || !configured()) return;
        clearTimeout(autoTimer);
        autoTimer = setTimeout(run, AUTO_WAIT);
    }

    async function run() {
        if (!autoOn() || !configured()) return;
        // Silent or not at all — see above.
        if (!valid()) { showStamp(); return; }

        try {
            await writeFile(backupEnvelope());
            remember();
        } catch (err) {
            // A failed automatic push is not worth a dialog in front of
            // someone who did not ask for one. The stamp going stale is the
            // honest signal, and pressing the button gives the real error.
            showStamp();
        }
    }

    /** How full this browser is, for the stamp's tooltip. */
    function storageNote() {
        if (typeof storeUsedBytes !== 'function') return '';
        const used = storeUsedBytes();
        const share = used / (5 * 1024 * 1024) * 100;
        const line = 'This browser is holding ' + (used / 1024 / 1024).toFixed(2) +
            ' MB of records — about ' + (share < 1 ? 'under 1' : Math.round(share)) +
            '% of what it allows. You are warned here long before it matters.';
        return String.fromCharCode(10, 10) + line;
    }

    /* ------------------------------------------------------------------ *
     * "Last saved" — the only status worth showing
     * ------------------------------------------------------------------ */

    const STAMP_KEY = 'moneyflow.drive.lastPush';

    function remember() {
        try { localStorage.setItem(STAMP_KEY, new Date().toISOString()); } catch (err) { /* not vital */ }
        showStamp();
    }

    function showStamp() {
        const el = $('driveStamp');
        if (!el) return;

        let stamp = null;
        try { stamp = localStorage.getItem(STAMP_KEY); } catch (err) { stamp = null; }

        if (!stamp) {
            // Auto cannot start itself. It never opens a Google sign-in window
            // — a popup nobody asked for gets blocked — so on a browser that
            // has never pushed, it stands down every time and does so in
            // silence. Left as a neutral "Not in Drive yet", that reads like a
            // fact rather than the switch quietly doing nothing.
            const waiting = autoOn() && configured();
            // An instruction, not a riddle. "Auto is waiting on you" was read
            // as a status and left the reader asking whether they had to do
            // anything — which is the one thing the label exists to answer.
            el.textContent = waiting ? 'Press To Drive to start Auto' : 'Not in Drive yet';
            el.classList.toggle('is-stale', waiting);
            el.title = (waiting
                ? 'Auto is on, but Google will only sign you in when you ask it to — so the '
                  + 'very first copy has to be one you send. Press "To Drive" once; after that '
                  + 'Auto keeps it up to date on its own.'
                : 'Nothing has been sent to Drive from this browser.') + storageNote();
            return;
        }

        const then = new Date(stamp);
        const days = Math.floor((Date.now() - then.getTime()) / 86400000);
        el.textContent = days === 0 ? 'Saved to Drive today'
            : days === 1 ? 'Saved to Drive yesterday'
            : 'Saved to Drive ' + days + ' days ago';
        // Stale is worth noticing, and worth noticing quietly.
        el.classList.toggle('is-stale', days >= 7);

        // The storage figure has nowhere else sensible to live. It is not
        // worth a line on screen until it matters — the alert bar handles
        // that — but someone who wonders should be able to look without
        // opening the console.
        el.title = 'Last sent ' + then.toLocaleString() + storageNote();
    }

    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ *
     * Coming back to an empty browser
     * ------------------------------------------------------------------ *
     * The moment a Drive copy actually earns its keep: this machine has no
     * records, and there may well be a book sitting in the folder. Without
     * this you would have to know to press "From Drive" — and someone whose
     * browser has just been cleared is exactly the person who does not.
     *
     * It offers rather than does. A pull replaces what is here, and a silent
     * one would be a network call and a sign-in nobody asked for — and a
     * sign-in popup not started by a click gets blocked anyway.
     *
     * **It must not be asked before the records are loaded.** They come out of
     * IndexedDB asynchronously, so for a moment after DOMContentLoaded the
     * store is legitimately empty and this would announce that a full book was
     * missing. That is exactly what it did until it was made to wait.
     */
    function offerPull() {
        const bar = $('driveOffer');
        if (!bar) return;
        if (!configured() || typeof storeIsEmpty !== 'function' || !storeIsEmpty()) return;
        bar.hidden = false;
    }

    function start() {
        const up = $('drivePush');
        if (up) up.addEventListener('click', () => push(up));

        const down = $('drivePull');
        if (down) down.addEventListener('click', () => pull(down));

        const auto = $('driveAuto');
        if (auto) auto.addEventListener('click', () => setAuto(!autoOn()));

        // The only way in from app.js. It is a no-op when the switch is off,
        // so the record modules need to know nothing about any of this.
        window.MFDriveTouch = schedule;

        const offer = $('driveOfferPull');
        if (offer) {
            offer.addEventListener('click', () => {
                const bar = $('driveOffer');
                if (bar) bar.hidden = true;
                pull(offer);
            });
        }

        const dismiss = $('driveOfferNo');
        if (dismiss) {
            dismiss.addEventListener('click', () => {
                const bar = $('driveOffer');
                if (bar) bar.hidden = true;
            });
        }

        paintAuto();
        showStamp();

        // Only once app.js says the records are in memory. Either order is
        // possible: on the localStorage fallback the app is ready before this
        // runs, and on IndexedDB it is not.
        if (window.MFReady) offerPull();
        else document.addEventListener('moneyflow:ready', offerPull, { once: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
