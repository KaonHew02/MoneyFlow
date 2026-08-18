/**
 * MoneyFlow — the client's one door to its data.
 * ---------------------------------------------------------------------------
 * Every module goes through this file. No module builds a URL, parses a
 * response, or knows that a database exists. That is deliberate: when the app
 * eventually moves off this laptop — to a Node host, or to a hosted database
 * behind a static site — this file is rewritten and the eight modules do not
 * notice. See docs/DEPLOY.md.
 *
 * Two conventions the whole app relies on:
 *
 *   - **Money crosses the wire in sen**, as integers, in fields named
 *     `*_sen`. Ringgit only exists for display. `toSen` / `fromSen` are the
 *     only places the two meet.
 *   - **Dates are 'YYYY-MM-DD' strings**, never Date objects. A date-only
 *     string handed to `new Date()` is parsed as UTC and lands on the previous
 *     day everywhere east of Greenwich, Malaysia included.
 */

const MF = (() => {

    const BASE = '/api';

    /** Thrown with the server's own message, so callers can show it verbatim. */
    class ApiError extends Error {
        constructor(status, message) {
            super(message);
            this.status = status;
        }
    }

    /**
     * Opened straight off the disk, there is no server to talk to. Saying so
     * once, plainly, beats twenty failed requests and an empty screen.
     */
    const isFileProtocol = location.protocol === 'file:';

    async function call(method, path, body) {
        if (isFileProtocol) {
            throw new ApiError(0,
                'MoneyFlow is open as a file, so it cannot reach its database. ' +
                'Close this tab, run MoneyFlow.cmd, and use http://localhost:4780 instead.');
        }

        let res;
        try {
            res = await fetch(BASE + path, {
                method,
                headers: body === undefined ? {} : { 'content-type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        } catch (err) {
            throw new ApiError(0, 'MoneyFlow cannot reach its server. Is the MoneyFlow window still open?');
        }

        const text = await res.text();
        let payload = null;
        if (text) {
            try { payload = JSON.parse(text); }
            catch (err) { throw new ApiError(res.status, 'The server sent something unreadable.'); }
        }

        if (!res.ok) throw new ApiError(res.status, (payload && payload.error) || 'Something went wrong.');
        return payload;
    }

    /** Query strings, with empty values dropped rather than sent as ''. */
    function qs(params) {
        const search = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') search.set(key, value);
        });
        const text = search.toString();
        return text ? '?' + text : '';
    }

    const get  = (path, params) => call('GET', path + qs(params));
    const post = (path, body)   => call('POST', path, body);
    const put  = (path, body)   => call('PUT', path, body);
    const del  = (path)         => call('DELETE', path);

    /* ------------------------------------------------------------------ *
     * Money. Sen in, sen out — the rounding happens once, here.
     * ------------------------------------------------------------------ */

    const toSen   = (value) => Math.round((Number(String(value).replace(/[\s,]/g, '')) || 0) * 100);
    const fromSen = (sen) => (Number(sen) || 0) / 100;

    const fmt = (value, dp = 2) => Number(value).toLocaleString('en-MY',
        { minimumFractionDigits: dp, maximumFractionDigits: dp });

    /** 123450 → 'RM 1,234.50'. A negative leads with the minus, before the RM. */
    const money = (sen) => (sen < 0 ? '−' : '') + 'RM ' + fmt(Math.abs(fromSen(sen)));

    /* ------------------------------------------------------------------ *
     * Dates. Strings throughout.
     * ------------------------------------------------------------------ */

    const pad2 = (n) => (n < 10 ? '0' : '') + n;

    function todayIso() {
        const now = new Date();
        return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    }

    const monthOf = (iso) => String(iso).slice(0, 7);

    /** Split by hand — see the note at the top of this file. */
    const partsOf = (iso) => {
        const [y, m, d] = String(iso).split('-').map(Number);
        return { year: y, month: m, day: d };
    };

    /** Month arithmetic that does not overflow: '2026-12' + 1 → '2027-01'. */
    function shiftMonth(monthKey, delta) {
        const [y, m] = monthKey.split('-').map(Number);
        const total = y * 12 + (m - 1) + delta;
        return Math.floor(total / 12) + '-' + pad2((total % 12) + 1);
    }

    const lastDayOf = (monthKey) => {
        const [y, m] = monthKey.split('-').map(Number);
        return monthKey + '-' + pad2(new Date(Date.UTC(y, m, 0)).getUTCDate());
    };

    const monthRange = (monthKey) => ({ from: monthKey + '-01', to: lastDayOf(monthKey) });

    /* ------------------------------------------------------------------ *
     * Reference data. Fetched once per page load and held here, because
     * every module needs the account and category lists to render a single
     * row, and refetching them per render would be absurd.
     * ------------------------------------------------------------------ */

    let cache = null;

    async function bootstrap(force = false) {
        if (!cache || force) cache = await get('/bootstrap');
        return cache;
    }

    const ref = {
        get accounts()        { return (cache && cache.accounts) || []; },
        get categories()      { return (cache && cache.categories) || []; },
        get subcategories()   { return (cache && cache.subcategories) || []; },
        get paymentMethods()  { return (cache && cache.payment_methods) || []; },
        get settings()        { return (cache && cache.settings) || {}; },

        account:  (id) => ref.accounts.find((a) => a.id === Number(id)) || null,
        category: (id) => ref.categories.find((c) => c.id === Number(id)) || null,
        categoryByCode: (code, kind = 'expense') =>
            ref.categories.find((c) => c.code === code && c.kind === kind) || null,
        subcategoriesOf: (categoryId) =>
            ref.subcategories.filter((s) => s.category_id === Number(categoryId)),
        expenseCategories: () => ref.categories.filter((c) => c.kind === 'expense' && c.is_active),
        incomeCategories:  () => ref.categories.filter((c) => c.kind === 'income'  && c.is_active),
        activeAccounts:    () => ref.accounts.filter((a) => a.is_active),
    };

    /** After anything that moves money, balances in the cache are stale. */
    async function refreshAccounts() {
        const accounts = await get('/accounts');
        if (cache) cache.accounts = accounts;
        return accounts;
    }

    /* ------------------------------------------------------------------ *
     * Endpoints
     * ------------------------------------------------------------------ */

    const accounts = {
        list:   ()          => get('/accounts'),
        create: (body)      => post('/accounts', body).then(async (a) => { await refreshAccounts(); return a; }),
        update: (id, body)  => put(`/accounts/${id}`, body).then(async (a) => { await refreshAccounts(); return a; }),
        remove: (id)        => del(`/accounts/${id}`).then(async (r) => { await refreshAccounts(); return r; }),
    };

    const categories = {
        list:   ()     => get('/categories'),
        create: (body) => post('/categories', body).then(async (c) => { await bootstrap(true); return c; }),
    };

    const subcategories = {
        list:   ()     => get('/subcategories'),
        create: (body) => post('/subcategories', body).then(async (s) => { await bootstrap(true); return s; }),
    };

    /**
     * One filter endpoint serves the ledger, an account's history, a category
     * drill-down and every dashboard breakdown. Accepted keys: from, to,
     * month, type, account, category, subcategory, payment_method, source,
     * status, q, limit, offset.
     */
    const txn = {
        list:   (filters) => get('/transactions', filters),
        get:    (id)      => get(`/transactions/${id}`),
        create: (body)    => post('/transactions', body).then(after),
        update: (id, body) => put(`/transactions/${id}`, body).then(after),
        remove: (id)      => del(`/transactions/${id}`).then(after),
    };

    /** Every write moves a balance, so the account cache is refreshed with it. */
    async function after(result) {
        await refreshAccounts();
        return result;
    }

    const settings = {
        all: ()           => get('/settings'),
        put: (key, value) => put(`/settings/${encodeURIComponent(key)}`, { value }),
    };

    /* ------------------------------------------------------------------ *
     * Migration from the old localStorage app.
     *
     * The three old blobs are read here, in the browser, because that is the
     * only place they exist, and handed to the server in one request. It runs
     * once — a second pass would double every balance on the screen.
     * ------------------------------------------------------------------ */

    const LEGACY_KEYS = {
        ledger: 'moneyflow.ledger.v1',
        budget: 'moneyflow.budget.v1',
        card:   'moneyflow.card.v1',
    };

    /** The rename left some books under the old prefix; look there too. */
    function legacyRaw(key) {
        try {
            return localStorage.getItem(key)
                || localStorage.getItem(key.replace('moneyflow.', 'moneysplitor.'));
        } catch (err) {
            return null;   // private mode
        }
    }

    function legacyData() {
        const out = {};
        Object.entries(LEGACY_KEYS).forEach(([name, key]) => {
            const raw = legacyRaw(key);
            if (!raw) return;
            try { out[name] = JSON.parse(raw); } catch (err) { /* unreadable, skip */ }
        });
        return out;
    }

    const migration = {
        /** What is sitting in this browser, and has the database seen it yet. */
        async check() {
            const local = legacyData();
            const entries = (local.ledger && Array.isArray(local.ledger.entries))
                ? local.ledger.entries.length : 0;
            const server = await get('/import');
            return {
                hasLocal: !!(entries || local.budget || local.card),
                entries,
                alreadyImported: server.imported,
                detail: server.detail,
                data: local,
            };
        },

        /** Hands the blobs over. `budget_month` files the old single budget. */
        run(force = false) {
            const local = legacyData();
            return post('/import', {
                ledger: local.ledger || null,
                budget: local.budget || null,
                card: local.card || null,
                budget_month: monthOf(todayIso()),
                force,
            });
        },

        /**
         * Only after the user has seen the imported book and is satisfied.
         * Never called automatically — the old copy is the only fallback if
         * the import turns out to have gone wrong.
         */
        clearLocal() {
            Object.values(LEGACY_KEYS).forEach((key) => {
                try {
                    localStorage.removeItem(key);
                    localStorage.removeItem(key.replace('moneyflow.', 'moneysplitor.'));
                } catch (err) { /* nothing to do */ }
            });
        },
    };

    return {
        ApiError, isFileProtocol,
        bootstrap, ref, refreshAccounts,
        accounts, categories, subcategories, txn, settings, migration,
        toSen, fromSen, fmt, money,
        todayIso, monthOf, partsOf, shiftMonth, lastDayOf, monthRange, pad2,
    };
})();
