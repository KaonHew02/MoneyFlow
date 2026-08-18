/**
 * MoneyFlow — the client's one door to its data.
 * ---------------------------------------------------------------------------
 * Every module goes through this file. No module writes a query, knows a table
 * name, or knows that Supabase exists. That was the point of building it this
 * way: when the app moved off the local SQLite server, only this file changed
 * and the modules did not notice. See docs/DEPLOY.md.
 *
 * Two conventions the whole app relies on:
 *
 *   - **Money is held in sen**, as integers, in fields named `*_sen`. Ringgit
 *     exists only for display. `toSen` / `fromSen` are the only places the two
 *     meet.
 *   - **Dates are 'YYYY-MM-DD' strings**, never Date objects. A date-only
 *     string handed to `new Date()` is parsed as UTC and lands on the previous
 *     day everywhere east of Greenwich, Malaysia included.
 *
 * On security: the key in config.js is public and is meant to be. It grants
 * nothing by itself. Every table has Row Level Security, so a request can only
 * ever reach rows belonging to the session doing the asking — which the app
 * obtains anonymously, without a login screen. That is enforced by the
 * database, not by this file — nothing here can be bypassed by editing it.
 */

const MF = (() => {

    /* ------------------------------------------------------------------ *
     * Connection
     * ------------------------------------------------------------------ */

    const config = (typeof MF_CONFIG !== 'undefined') ? MF_CONFIG : null;

    /** Thrown with a message meant to be shown to the user as it is. */
    class ApiError extends Error {
        constructor(message, cause) {
            super(message);
            this.cause = cause;
        }
    }

    const CONFIG_HELP =
        'MoneyFlow is not connected to a database yet. Copy config.example.js ' +
        'to config.js and paste in your Supabase URL and anon key — ' +
        'see docs/LAUNCH.md, step 4.';

    let sb = null;

    /**
     * Both halves have to be filled in, and each is checked separately: the
     * project URL is easy to paste and the key easy to forget, which would
     * otherwise fail later as an unauthorised request rather than here as
     * "you have not finished setting up".
     */
    const stillPlaceholder = (value) => !value || /YOUR-(PROJECT|ANON-KEY)/i.test(value);

    const isConfigured = () => !!config &&
        !stillPlaceholder(config.url) && !stillPlaceholder(config.anonKey);

    function client() {
        if (sb) return sb;
        if (!isConfigured()) throw new ApiError(CONFIG_HELP);
        if (typeof supabase === 'undefined') {
            throw new ApiError('The Supabase library did not load. Check your internet connection.');
        }
        sb = supabase.createClient(config.url, config.anonKey);
        return sb;
    }

    /**
     * Turns a Postgres error into something a person can act on. The database
     * refuses malformed money for good reasons; the reasons are just not
     * phrased for humans.
     */
    function fail(error, what) {
        if (!error) return;
        const text = String(error.message || '');

        if (/row-level security/i.test(text)) {
            throw new ApiError('That record belongs to a different session. Reload the page.', error);
        }
        if (/txn_check|to_account_id/i.test(text)) {
            throw new ApiError('A transfer needs two different accounts, and only a transfer has a destination.', error);
        }
        if (/amount_sen/i.test(text)) {
            throw new ApiError('The amount has to be more than zero.', error);
        }
        if (/violates foreign key/i.test(text)) {
            throw new ApiError('That account or category no longer exists.', error);
        }
        if (/duplicate key/i.test(text)) {
            throw new ApiError('That already exists.', error);
        }
        if (/Failed to fetch|NetworkError/i.test(text)) {
            throw new ApiError('Cannot reach the database. Check your internet connection.', error);
        }
        throw new ApiError(what ? `${what}: ${text}` : text, error);
    }

    /** Every read and write funnels through here so no error escapes raw. */
    async function run(query, what) {
        const { data, error, count } = await query;
        fail(error, what);
        return count === undefined || count === null ? data : { data, count };
    }

    /* ------------------------------------------------------------------ *
     * The session — obtained without asking
     * ------------------------------------------------------------------ */

    /**
     * There is no sign-in screen, and no account to create. Row Level Security
     * still needs a *who* to match rows against, so on first load the app
     * quietly claims an anonymous account: a real row in `auth.users`, seeded
     * with the starter categories and accounts like any other, but with no
     * email and no password in front of it.
     *
     * What that buys: nothing to remember, nothing to type, and the database
     * still refuses to hand this browser anybody else's rows — the published
     * anon key on its own opens nothing.
     *
     * What it costs, and it is worth knowing: the session lives in this
     * browser's storage. Clear the site data, or open the app on another
     * device, and Supabase issues a fresh anonymous account — which means an
     * empty book. Same app, different reader, as far as the database knows.
     */
    const ANON_OFF =
        'Anonymous sign-ins are switched off for this project. In Supabase, go to ' +
        'Authentication → Sign In / Providers and turn on "Allow anonymous sign-ins".';

    const auth = {
        /**
         * Called once at start-up, and the only entry point. Returns a user
         * either way: the stored session if this browser has been here before,
         * a newly issued anonymous one if it has not.
         */
        async ensure() {
            const existing = await auth.user();
            if (existing) return existing;

            const { data, error } = await client().auth.signInAnonymously();

            if (error && /anonymous.*(disabled|not enabled|not allowed)/i.test(error.message)) {
                throw new ApiError(ANON_OFF, error);
            }
            // Supabase reports a failing signup trigger as this, which sounds
            // like its own fault and is almost always ours: seed_new_user()
            // threw, so creating the user was rolled back with it.
            if (error && /Database error saving new user/i.test(error.message)) {
                throw new ApiError(
                    'The session could not be created because the new-user seed failed. ' +
                    'Re-run supabase/schema.sql in the SQL editor (Step 1) and reload.', error);
            }
            fail(error, 'Could not start a session');
            return data.user;
        },

        async user() {
            if (!isConfigured()) return null;
            const { data } = await client().auth.getSession();
            return (data && data.session && data.session.user) || null;
        },

        /** Fires when a session is restored, refreshed, or newly issued. */
        onChange(handler) {
            client().auth.onAuthStateChange((event, session) => {
                if (event === 'SIGNED_OUT') cache = null;
                handler((session && session.user) || null, event);
            });
        },
    };

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
     * Reference data, fetched once per page load. Every module needs the
     * account and category lists to draw a single row; refetching them per
     * render would be absurd.
     * ------------------------------------------------------------------ */

    let cache = null;

    async function bootstrap(force = false) {
        if (cache && !force) return cache;

        const db = client();
        const [accounts, categories, subcategories, methods, settings] = await Promise.all([
            run(db.from('v_account_balance').select('*').order('is_active', { ascending: false })
                  .order('sort_order').order('name'), 'Loading accounts'),
            run(db.from('category').select('*').order('kind', { ascending: false })
                  .order('sort_order').order('label'), 'Loading categories'),
            run(db.from('subcategory').select('*').order('category_id').order('sort_order'),
                'Loading sub-categories'),
            run(db.from('payment_method').select('*').order('sort_order'), 'Loading payment methods'),
            run(db.from('setting').select('key, value'), 'Loading settings'),
        ]);

        cache = {
            accounts: accounts.map(shapeAccount),
            categories,
            subcategories,
            payment_methods: methods,
            settings: Object.fromEntries((settings || []).map((s) => [s.key, s.value])),
        };
        return cache;
    }

    /** The view names the key `account_id`; the app has always called it `id`. */
    const shapeAccount = (row) => ({ ...row, id: row.account_id });

    const ref = {
        get accounts()       { return (cache && cache.accounts) || []; },
        get categories()     { return (cache && cache.categories) || []; },
        get subcategories()  { return (cache && cache.subcategories) || []; },
        get paymentMethods() { return (cache && cache.payment_methods) || []; },
        get settings()       { return (cache && cache.settings) || {}; },

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

    /** After anything that moves money, the cached balances are stale. */
    async function refreshAccounts() {
        const rows = await run(client().from('v_account_balance').select('*')
            .order('is_active', { ascending: false }).order('sort_order').order('name'),
            'Loading accounts');
        const accounts = rows.map(shapeAccount);
        if (cache) cache.accounts = accounts;
        return accounts;
    }

    /* ------------------------------------------------------------------ *
     * Accounts, categories, settings
     * ------------------------------------------------------------------ */

    const accounts = {
        list: refreshAccounts,

        async create(body) {
            const row = await run(client().from('account').insert({
                name: String(body.name || '').trim(),
                group_type: body.group_type,
                currency: (body.currency || 'MYR').toUpperCase(),
                opening_sen: body.opening_sen !== undefined ? body.opening_sen : toSen(body.opening || 0),
                note: body.note || '',
                sort_order: body.sort_order || 0,
            }).select().single(), 'Adding the account');
            await refreshAccounts();
            return row;
        },

        async update(id, body) {
            const patch = {};
            ['name', 'group_type', 'currency', 'note', 'is_active', 'sort_order']
                .forEach((key) => { if (body[key] !== undefined) patch[key] = body[key]; });
            if (body.opening_sen !== undefined) patch.opening_sen = body.opening_sen;
            else if (body.opening !== undefined) patch.opening_sen = toSen(body.opening);

            const row = await run(client().from('account').update(patch).eq('id', id).select().single(),
                'Saving the account');
            await refreshAccounts();
            return row;
        },

        /**
         * Only removable while nothing points at it; otherwise it is retired,
         * which keeps every historical balance intact. The last active account
         * cannot go at all — a ledger with nowhere to record is not a ledger.
         */
        async remove(id) {
            const active = ref.accounts.filter((a) => a.is_active);
            if (active.length <= 1 && active.some((a) => a.id === Number(id))) {
                throw new ApiError('This is the only account left.');
            }

            const { count } = await run(client().from('txn')
                .select('id', { count: 'exact', head: true })
                .or(`account_id.eq.${Number(id)},to_account_id.eq.${Number(id)}`), 'Checking the account');

            if (count > 0) {
                await accounts.update(id, { is_active: false });
                return { id, retired: true, entries: count };
            }

            await run(client().from('account').delete().eq('id', id), 'Removing the account');
            await refreshAccounts();
            return { id, deleted: true };
        },
    };

    const categories = {
        list: () => run(client().from('category').select('*').order('sort_order'), 'Loading categories'),
        async create(body) {
            const kind = body.kind === 'income' ? 'income' : 'expense';
            const row = await run(client().from('category').insert({
                label: String(body.label || '').trim(),
                kind,
                bucket: kind === 'income' ? null : (body.bucket || 'wants'),
                icon: body.icon || '',
                hint: body.hint || '',
                sort_order: body.sort_order || 99,
            }).select().single(), 'Adding the category');
            await bootstrap(true);
            return row;
        },
    };

    const subcategories = {
        list: () => run(client().from('subcategory').select('*').order('sort_order'), 'Loading sub-categories'),
        async create(body) {
            const row = await run(client().from('subcategory').insert({
                category_id: Number(body.category_id),
                label: String(body.label || '').trim(),
                sort_order: body.sort_order || 99,
            }).select().single(), 'Adding the sub-category');
            await bootstrap(true);
            return row;
        },
    };

    const settings = {
        all: () => run(client().from('setting').select('key, value'), 'Loading settings')
                     .then((rows) => Object.fromEntries((rows || []).map((s) => [s.key, s.value]))),
        async put(key, value) {
            await run(client().from('setting').upsert({ key, value }, { onConflict: 'user_id,key' }),
                'Saving the setting');
            if (cache) cache.settings[key] = value;
            return { key, value };
        },
    };

    /* ------------------------------------------------------------------ *
     * Transactions
     *
     * One list function serves the ledger, an account's history, a category
     * drill-down and every dashboard breakdown. The rows come back flattened
     * into the same shape the rest of the app has always read.
     * ------------------------------------------------------------------ */

    const TXN_SELECT = `
        id, type, amount_sen, txn_date, note, currency, status,
        source_module, source_id, created_at, updated_at,
        account_id, to_account_id, category_id, subcategory_id, payment_method_id,
        account:account_id (name, group_type),
        to_account:to_account_id (name),
        category:category_id (label, code, bucket, icon),
        subcategory:subcategory_id (label),
        payment_method:payment_method_id (label)`;

    /** Nested objects in, flat `*_name` / `*_label` fields out. */
    function flatten(row) {
        if (!row) return row;
        const out = { ...row };
        out.account_name         = row.account ? row.account.name : null;
        out.account_group        = row.account ? row.account.group_type : null;
        out.to_account_name      = row.to_account ? row.to_account.name : null;
        out.category_label       = row.category ? row.category.label : null;
        out.category_code        = row.category ? row.category.code : null;
        out.category_bucket      = row.category ? row.category.bucket : null;
        out.category_icon        = row.category ? row.category.icon : null;
        out.subcategory_label    = row.subcategory ? row.subcategory.label : null;
        out.payment_method_label = row.payment_method ? row.payment_method.label : null;
        delete out.account; delete out.to_account; delete out.category;
        delete out.subcategory; delete out.payment_method;
        return out;
    }

    /**
     * Checks what the database cannot phrase kindly, and normalises the rest.
     * The constraints are still there underneath — this is for the message,
     * not for the safety.
     */
    function readFields(body) {
        const type = ['income', 'expense', 'transfer'].includes(body.type) ? body.type : null;
        if (!type) throw new ApiError('Pick whether this is money spent, received or moved.');

        const amount_sen = body.amount_sen !== undefined ? Number(body.amount_sen) : toSen(body.amount);
        if (!(amount_sen > 0)) throw new ApiError('Enter an amount greater than zero.');

        const txn_date = String(body.txn_date || body.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(txn_date)) throw new ApiError('Pick a date.');

        const account_id = Number(body.account_id) || null;
        if (!account_id) throw new ApiError('Pick an account.');

        let to_account_id = null;
        if (type === 'transfer') {
            to_account_id = Number(body.to_account_id) || null;
            if (!to_account_id) throw new ApiError('A transfer needs an account to move the money into.');
            if (to_account_id === account_id) throw new ApiError('A transfer needs two different accounts.');
        }

        return {
            type, amount_sen, txn_date, account_id, to_account_id,
            category_id: type === 'transfer' ? null : (Number(body.category_id) || null),
            subcategory_id: type === 'transfer' ? null : (Number(body.subcategory_id) || null),
            payment_method_id: Number(body.payment_method_id) || null,
            note: String(body.note || '').slice(0, 500),
            currency: (body.currency || 'MYR').toUpperCase(),
            status: body.status || 'cleared',
        };
    }

    const txn = {
        /**
         * Accepted filters: from, to, month, type, account, category,
         * subcategory, payment_method, source, status, q, limit, offset.
         */
        async list(filters = {}) {
            const f = filters || {};
            let query = client().from('txn').select(TXN_SELECT, { count: 'exact' });

            if (f.from)  query = query.gte('txn_date', f.from);
            if (f.to)    query = query.lte('txn_date', f.to);
            if (f.month) {
                const range = monthRange(f.month);
                query = query.gte('txn_date', range.from).lte('txn_date', range.to);
            }
            if (f.type)           query = query.eq('type', f.type);
            if (f.category)       query = query.eq('category_id', f.category);
            if (f.subcategory)    query = query.eq('subcategory_id', f.subcategory);
            if (f.payment_method) query = query.eq('payment_method_id', f.payment_method);
            if (f.source)         query = query.eq('source_module', f.source);
            if (f.status)         query = query.eq('status', f.status);
            // An account's history is both legs of every transfer it took part in.
            if (f.account) query = query.or(`account_id.eq.${Number(f.account)},to_account_id.eq.${Number(f.account)}`);
            if (f.q)       query = query.ilike('note', `%${f.q}%`);

            const limit  = Math.min(Number(f.limit) || 500, 5000);
            const offset = Math.max(Number(f.offset) || 0, 0);

            query = query.order('txn_date', { ascending: false })
                         .order('id', { ascending: false })
                         .range(offset, offset + limit - 1);

            const { data, count } = await query.then((res) => {
                fail(res.error, 'Loading transactions');
                return { data: res.data, count: res.count };
            });

            return { total: count, limit, offset, entries: (data || []).map(flatten) };
        },

        get: (id) => run(client().from('txn').select(TXN_SELECT).eq('id', id).single(),
            'Loading the transaction').then(flatten),

        async create(body) {
            const row = await run(client().from('txn').insert({
                ...readFields(body),
                source_module: body.source_module || 'ledger',
                source_id: body.source_id || null,
            }).select(TXN_SELECT).single(), 'Saving the entry');
            await refreshAccounts();
            return flatten(row);
        },

        async update(id, body) {
            const row = await run(client().from('txn').update(readFields(body))
                .eq('id', id).select(TXN_SELECT).single(), 'Saving the change');
            await refreshAccounts();
            return flatten(row);
        },

        /**
         * A plain ledger entry is removed. One written by another module is
         * not — a settled bill share or a card payment belongs to its parent
         * record, and deleting it would leave that record claiming a payment
         * that no longer exists. Those are voided, so the history still reads.
         */
        async remove(id) {
            const existing = await run(client().from('txn').select('id, source_module')
                .eq('id', id).single(), 'Finding the entry');

            if (existing.source_module && existing.source_module !== 'ledger') {
                await run(client().from('txn').update({ status: 'void' }).eq('id', id),
                    'Voiding the entry');
                await refreshAccounts();
                return { id, voided: true, source: existing.source_module };
            }

            await run(client().from('txn').delete().eq('id', id), 'Deleting the entry');
            await refreshAccounts();
            return { id, deleted: true };
        },
    };

    /* ------------------------------------------------------------------ *
     * Migration from the old localStorage app.
     *
     * The three old blobs are read here, in the browser, because that is the
     * only place they exist. It runs once — a second pass would double every
     * balance on the screen — and the local copy is never cleared until the
     * user has seen the imported book and said so.
     * ------------------------------------------------------------------ */

    const LEGACY_KEYS = {
        ledger: 'moneyflow.ledger.v1',
        budget: 'moneyflow.budget.v1',
        card:   'moneyflow.card.v1',
    };

    const IMPORT_FLAG = 'imported_from_localstorage';

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

    const senOrNull = (value) => {
        const text = String(value ?? '').replace(/[\s,]/g, '').replace(/^RM/i, '');
        if (!/^-?\d*(\.\d+)?$/.test(text) || text === '' || text === '-') return null;
        const sen = Math.round(Number(text) * 100);
        return Number.isSafeInteger(sen) ? sen : null;
    };

    const migration = {
        async check() {
            const local = legacyData();
            const entries = (local.ledger && Array.isArray(local.ledger.entries))
                ? local.ledger.entries.length : 0;
            const flag = (await settings.all())[IMPORT_FLAG] || null;
            return {
                hasLocal: !!(entries || local.budget || local.card),
                entries,
                alreadyImported: !!flag,
                detail: flag,
                data: local,
            };
        },

        /**
         * The stored copy is treated as untrusted: an entry pointing at an
         * account that no longer exists, or a transfer that lost its far side,
         * is dropped and reported rather than stored — one bad row would
         * otherwise corrupt every balance on the screen.
         */
        async run(force = false) {
            const flag = (await settings.all())[IMPORT_FLAG];
            if (flag && !force) throw new ApiError('This book has already been imported.');

            const local = legacyData();
            const ledger = local.ledger || {};
            const report = { accounts: 0, entries: 0, skipped: [], budget: 0, cards: 0 };
            const db = client();

            /* accounts, keeping a map from the old string ids */
            const accountIds = new Map();
            const savedAccounts = Array.isArray(ledger.accounts) ? ledger.accounts : [];
            const GROUPS = ['cash', 'bank', 'ewallet', 'savings', 'credit', 'investment'];

            if (savedAccounts.length) {
                const { count } = await run(db.from('txn').select('id', { count: 'exact', head: true }));
                // The seeded starter accounts only exist so a fresh session works.
                if (!count) await run(db.from('account').delete().neq('id', 0), 'Clearing starter accounts');

                const made = await run(db.from('account').insert(savedAccounts.map((a, i) => ({
                    name: String(a.name || 'Account').slice(0, 120),
                    group_type: GROUPS.includes(a.group) ? a.group : 'bank',
                    opening_sen: senOrNull(a.opening) ?? 0,
                    sort_order: i,
                }))).select(), 'Importing accounts');

                savedAccounts.forEach((a, i) => { if (made[i]) accountIds.set(String(a.id), made[i].id); });
                report.accounts = made.length;
            } else {
                ref.accounts.forEach((a) => accountIds.set(String(a.id), a.id));
            }

            /* entries */
            await bootstrap(true);
            const categoryByCode = new Map();
            ref.categories.forEach((c) => { if (c.code) categoryByCode.set(c.kind + ':' + c.code, c.id); });

            const rows = [];
            (Array.isArray(ledger.entries) ? ledger.entries : []).forEach((e) => {
                const drop = (why) => report.skipped.push({ entry: e && e.id, why });

                if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) return drop('bad date');
                const type = ['expense', 'income', 'transfer'].includes(e.type) ? e.type : 'expense';
                const amount = senOrNull(e.amount);
                if (amount === null || amount <= 0) return drop('bad amount');

                const from = accountIds.get(String(e.account));
                if (!from) return drop('unknown account');

                let to = null;
                if (type === 'transfer') {
                    to = accountIds.get(String(e.toAccount));
                    if (!to || to === from) return drop('transfer lost its far side');
                }

                const kind = type === 'income' ? 'income' : 'expense';
                rows.push({
                    type,
                    amount_sen: amount,
                    txn_date: String(e.date),
                    account_id: from,
                    to_account_id: to,
                    category_id: type === 'transfer'
                        ? null : (categoryByCode.get(kind + ':' + String(e.category)) ?? null),
                    note: String(e.note || '').slice(0, 500),
                    source_module: 'ledger',
                });
            });

            // In batches: one insert of several thousand rows can time out.
            for (let i = 0; i < rows.length; i += 200) {
                await run(db.from('txn').insert(rows.slice(i, i + 200)), 'Importing entries');
                report.entries += Math.min(200, rows.length - i);
            }

            /* budget */
            const budget = local.budget;
            if (budget) {
                const periodKey = monthOf(todayIso());
                const head = await run(db.from('budget').upsert({
                    period_type: 'month',
                    period_key: periodKey,
                    income_sen: senOrNull(budget.income) ?? 0,
                    rule: ['502030', '702010', 'off'].includes(budget.rule) ? budget.rule : '502030',
                }, { onConflict: 'user_id,period_type,period_key' }).select().single(), 'Importing the budget');

                const lines = [];
                Object.entries(budget.amounts || {}).forEach(([code, value]) => {
                    const categoryId = categoryByCode.get('expense:' + code);
                    const sen = senOrNull(value);
                    if (categoryId && sen) lines.push({ budget_id: head.id, category_id: categoryId, planned_sen: sen });
                });

                // User-added rows had no category of their own; they get one now.
                for (const [i, c] of (Array.isArray(budget.custom) ? budget.custom : []).entries()) {
                    const label = String((c && c.label) || '').trim();
                    const sen = senOrNull(c && c.amount);
                    if (!label || !sen) continue;
                    const made = await categories.create({
                        label, kind: 'expense',
                        bucket: ['needs', 'wants', 'save'].includes(c.bucket) ? c.bucket : 'wants',
                        sort_order: 50 + i,
                    });
                    lines.push({ budget_id: head.id, category_id: made.id, planned_sen: sen });
                }

                if (lines.length) {
                    await run(db.from('budget_line').upsert(lines, { onConflict: 'budget_id,category_id' }),
                        'Importing the budget lines');
                }
                report.budget = 1;
            }

            /* credit card */
            const card = local.card;
            const cardBalance = card ? senOrNull(card.balance) : null;
            if (cardBalance > 0) {
                const rate = Number(String(card.rate).replace(/[^\d.]/g, ''));
                const minPct = Number(String(card.minPct).replace(/[^\d.]/g, ''));
                await run(db.from('credit_card').insert({
                    name: 'Credit card',
                    balance_sen: cardBalance,
                    apr_bp: rate > 0 ? Math.round(rate * 100) : 1800,
                    min_pct_bp: minPct > 0 ? Math.round(minPct * 100) : 500,
                    min_floor_sen: senOrNull(card.minFloor) ?? 2500,
                    plan_payment_sen: senOrNull(card.payment),
                }), 'Importing the card');
                report.cards = 1;
            }

            await settings.put(IMPORT_FLAG, { at: new Date().toISOString(), ...report });
            await bootstrap(true);
            return report;
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
        ApiError, isConfigured, auth,
        bootstrap, ref, refreshAccounts,
        accounts, categories, subcategories, txn, settings, migration,
        toSen, fromSen, fmt, money,
        todayIso, monthOf, partsOf, shiftMonth, lastDayOf, monthRange, pad2,
    };
})();
