/**
 * MoneyFlow — getting a session, without ever asking for one.
 *
 * There is no login screen. The database is still per-person underneath — Row
 * Level Security decides what a request may see by matching rows against
 * whoever is asking — so something has to establish a *whoever*. This file is
 * that something, and it does the job silently: it restores the session this
 * browser already holds, or claims a fresh anonymous one, and then hands
 * control to the app by dispatching `mf:signedin` on `document`.
 *
 * The app is deliberately not held hostage to that succeeding. The screens run
 * on their own and stay useful with no database behind them, so a failure here
 * shows up as a strip across the top rather than a locked door — which is the
 * whole point of taking the gate out.
 */

(() => {

    const strip = () => document.getElementById('connError');

    function warn(text) {
        const el = strip();
        if (!el) return;
        el.textContent = text || '';
        el.hidden = !text;
    }

    // Attaching twice would issue two anonymous accounts on a first visit and
    // strand the data in whichever one lost the race.
    let started = false;

    async function start() {
        if (started) return;
        started = true;

        // Not configured yet: say exactly what is missing rather than failing
        // at the first query with something cryptic.
        if (!MF.isConfigured()) {
            warn('Not connected to a database — nothing will be saved. Copy config.example.js ' +
                 'to config.js and paste in your Supabase URL and anon key. See docs/LAUNCH.md.');
            return;
        }

        try {
            const user = await MF.auth.ensure();
            warn('');
            document.dispatchEvent(new CustomEvent('mf:signedin', { detail: { user } }));
        } catch (err) {
            warn(err.message);
        }
    }

    // These scripts sit at the end of <body>, so the document is normally still
    // parsing. If that ever changes — a `defer`, a bundler, a moved tag — the
    // event has already been and gone, and waiting for it would leave the app
    // running with no session and no explanation.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
