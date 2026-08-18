/**
 * MoneyFlow — the sign-in gate.
 *
 * On a public web address the login is not a convenience, it is the security.
 * Row Level Security decides what a request may see based on who is asking, so
 * until someone has signed in, there is nothing to show and nothing to save.
 *
 * This file owns the gate and the sign-out button, and nothing else. It hands
 * control to the app by dispatching `mf:signedin` on `document` once a session
 * exists, so the modules never have to know how a session was obtained.
 */

(() => {

    const $ = (id) => document.getElementById(id);

    const gate     = () => $('gate');
    const gateForm = () => $('gateForm');
    const gateMsg  = () => $('gateMessage');

    let mode = 'signin';   // or 'signup'

    /* ------------------------------------------------------------------ */

    function say(text, tone = 'bad') {
        const el = gateMsg();
        if (!el) return;
        el.textContent = text || '';
        el.hidden = !text;
        el.className = 'gate-message is-' + tone;
    }

    function busy(on) {
        const button = $('gateSubmit');
        if (!button) return;
        button.disabled = on;
        button.textContent = on ? 'Working…'
            : (mode === 'signin' ? 'Sign in' : 'Create account');
    }

    function setMode(next) {
        mode = next;
        $('gateTitle').textContent = mode === 'signin' ? 'Welcome back' : 'Create your account';
        $('gateSubmit').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
        $('gateSwitch').textContent = mode === 'signin'
            ? 'No account yet? Create one' : 'Already have an account? Sign in';
        $('gateForgot').hidden = mode !== 'signin';
        say('');
    }

    function showGate() {
        document.body.classList.add('is-locked');
        if (gate()) gate().hidden = false;
    }

    function showApp(user) {
        document.body.classList.remove('is-locked');
        if (gate()) gate().hidden = true;
        const who = $('whoami');
        if (who) who.textContent = user.email || '';
        document.dispatchEvent(new CustomEvent('mf:signedin', { detail: { user } }));
    }

    /* ------------------------------------------------------------------ */

    async function onSubmit(event) {
        event.preventDefault();
        const email = $('gateEmail').value.trim();
        const password = $('gatePassword').value;

        if (!email) return say('Enter your email address.');
        if (password.length < 6) return say('The password needs at least 6 characters.');

        busy(true);
        try {
            if (mode === 'signup') {
                await MF.auth.signUp(email, password);

                // With "Confirm email" on, signing up returns no session — the
                // account exists but cannot be used until the emailed link is
                // clicked. Every outcome here has to say something: an earlier
                // version fell through silently, which reads as a dead button.
                const user = await MF.auth.user();
                if (user) { showApp(user); return; }

                setMode('signin');
                say('Account created. If email confirmation is switched on for this ' +
                    'project, click the link in your inbox first — then sign in here.', 'good');
                return;
            }

            await MF.auth.signIn(email, password);
            const user = await MF.auth.user();
            if (user) showApp(user);
            else say('Signed in, but no session came back. Try once more.');
        } catch (err) {
            say(err.message);
        } finally {
            busy(false);
        }
    }

    async function onForgot(event) {
        event.preventDefault();
        const email = $('gateEmail').value.trim();
        if (!email) return say('Type your email address first, then click this again.');
        try {
            await MF.auth.sendReset(email);
            say('Sent. Check your email for a link to set a new password.', 'good');
        } catch (err) {
            say(err.message);
        }
    }

    async function onSignOut() {
        await MF.auth.signOut();
        location.reload();
    }

    /* ------------------------------------------------------------------ */

    let started = false;

    async function start() {
        // Attaching the listeners twice is worse than not attaching them: each
        // click would fire both copies, toggling sign-in to sign-up and back,
        // and the screen would sit there looking broken for no visible reason.
        if (started) return;
        started = true;

        // Not configured yet: say exactly what is missing rather than failing
        // at the first query with something cryptic.
        if (!MF.isConfigured()) {
            showGate();
            $('gateForm').hidden = true;
            $('gateSwitch').hidden = true;
            $('gateTitle').textContent = 'Not connected yet';
            say('Copy config.example.js to config.js and paste in your Supabase URL ' +
                'and anon key. See docs/LAUNCH.md, step 4.');
            return;
        }

        gateForm().addEventListener('submit', onSubmit);
        $('gateSwitch').addEventListener('click', (e) => {
            e.preventDefault();
            setMode(mode === 'signin' ? 'signup' : 'signin');
        });
        $('gateForgot').addEventListener('click', onForgot);
        const out = $('signOut');
        if (out) out.addEventListener('click', onSignOut);

        try {
            const user = await MF.auth.user();
            if (user) showApp(user);
            else showGate();
        } catch (err) {
            showGate();
            say(err.message);
        }
    }

    // These scripts sit at the end of <body>, so the document is normally still
    // parsing. If that ever changes — a `defer`, a bundler, a moved tag — the
    // event has already been and gone, and waiting for it would hang the gate
    // forever on a blank screen.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
