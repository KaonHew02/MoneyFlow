/**
 * One-time migration of the browser's localStorage into the database.
 *
 * The old app kept three unrelated blobs — `moneyflow.ledger.v1`,
 * `.budget.v1`, `.card.v1` — with string ids and amounts held as typed text.
 * The client posts them here verbatim and this turns them into rows.
 *
 * Two things matter more than tidiness:
 *
 *   - it runs in one transaction, so a half-migrated book is impossible;
 *   - it refuses to run twice, because a second pass would double every
 *     entry and every balance on the screen. `force` is there for a retry
 *     after a wipe, and says so.
 *
 * The stored copy is treated as untrusted: an entry pointing at an account
 * that no longer exists, or a transfer that lost its far side, is dropped and
 * reported rather than stored — the same rule the old loader applied, kept
 * because it is what stops one bad row corrupting every balance.
 */

const db = require('../db');
const { bad } = require('../http');
const v = require('../valid');

const IMPORT_FLAG = 'imported_from_localstorage';

/** Amounts arrive as whatever was typed into a text field. */
function senOrNull(value) {
    const text = String(value ?? '').replace(/[\s,]/g, '').replace(/^RM/i, '');
    if (!/^-?\d*(\.\d+)?$/.test(text) || text === '' || text === '-') return null;
    const sen = Math.round(Number(text) * 100);
    return Number.isSafeInteger(sen) ? sen : null;
}

const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

function status() {
    const row = db.get('SELECT value FROM setting WHERE key = ?', IMPORT_FLAG);
    return {
        imported: !!row,
        detail: row ? JSON.parse(row.value) : null,
        counts: {
            accounts: db.get('SELECT COUNT(*) AS n FROM account').n,
            transactions: db.get('SELECT COUNT(*) AS n FROM txn').n,
            budgets: db.get('SELECT COUNT(*) AS n FROM budget').n,
            cards: db.get('SELECT COUNT(*) AS n FROM credit_card').n,
        },
    };
}

function importLocalStorage({ body }) {
    const already = db.get('SELECT value FROM setting WHERE key = ?', IMPORT_FLAG);
    if (already && !body.force) {
        bad('This book has already been imported. Pass force to import again.');
    }

    const report = { accounts: 0, entries: 0, skipped: [], budget: 0, cards: 0 };

    db.tx(() => {
        const now = db.stamp();
        const accountIds = new Map();   // old string id -> new integer id

        /* ---- accounts ------------------------------------------------- */
        const ledger = body.ledger && typeof body.ledger === 'object' ? body.ledger : {};
        const savedAccounts = Array.isArray(ledger.accounts) ? ledger.accounts : [];

        // The seeded starter accounts are only there so a fresh install works.
        // If the user brings their own and has never recorded against the
        // seeds, the seeds go — otherwise they would sit in the list forever.
        if (savedAccounts.length && db.get('SELECT COUNT(*) AS n FROM txn').n === 0) {
            db.run('DELETE FROM account');
        }

        const insertAccount = `INSERT INTO account
            (name, group_type, opening_sen, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`;
        const GROUPS = ['cash', 'bank', 'ewallet', 'savings', 'credit', 'investment'];

        savedAccounts.forEach((a, i) => {
            if (!a || !a.id) return;
            const info = db.run(insertAccount,
                String(a.name || 'Account').slice(0, 120),
                GROUPS.includes(a.group) ? a.group : 'bank',
                senOrNull(a.opening) ?? 0, i, now, now);
            accountIds.set(String(a.id), Number(info.lastInsertRowid));
            report.accounts += 1;
        });

        /* ---- categories ----------------------------------------------- */
        const categoryByCode = new Map();
        db.all('SELECT id, code, kind FROM category WHERE code IS NOT NULL')
          .forEach((c) => categoryByCode.set(c.kind + ':' + c.code, c.id));

        /* ---- entries --------------------------------------------------- */
        const insertTxn = `INSERT INTO txn
            (type, amount_sen, txn_date, account_id, to_account_id, category_id,
             note, source_module, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ledger', 'cleared', ?, ?)`;

        (Array.isArray(ledger.entries) ? ledger.entries : []).forEach((e) => {
            const drop = (why) => report.skipped.push({ entry: e && e.id, why });

            if (!e || !isIsoDate(e.date))            return drop('bad date');
            const type = ['expense', 'income', 'transfer'].includes(e.type) ? e.type : 'expense';
            const amount = senOrNull(e.amount);
            if (amount === null || amount <= 0)      return drop('bad amount');

            const from = accountIds.get(String(e.account));
            if (!from)                               return drop('unknown account');

            let to = null;
            if (type === 'transfer') {
                to = accountIds.get(String(e.toAccount));
                if (!to || to === from)              return drop('transfer lost its far side');
            }

            const kind = type === 'income' ? 'income' : 'expense';
            const categoryId = type === 'transfer'
                ? null
                : (categoryByCode.get(kind + ':' + String(e.category)) ?? null);

            db.run(insertTxn, type, amount, String(e.date), from, to, categoryId,
                String(e.note || '').slice(0, 500), now, now);
            report.entries += 1;
        });

        /* ---- budget ---------------------------------------------------- */
        const budget = body.budget && typeof body.budget === 'object' ? body.budget : null;
        if (budget) {
            const periodKey = /^\d{4}-\d{2}$/.test(String(body.budget_month || ''))
                ? String(body.budget_month)
                : new Date().toISOString().slice(0, 7);

            const info = db.run(
                `INSERT INTO budget (period_type, period_key, income_sen, rule, created_at, updated_at)
                 VALUES ('month', ?, ?, ?, ?, ?)
                 ON CONFLICT (period_type, period_key) DO UPDATE
                   SET income_sen = excluded.income_sen, rule = excluded.rule,
                       updated_at = excluded.updated_at`,
                periodKey, senOrNull(budget.income) ?? 0,
                ['502030', '702010', 'off'].includes(budget.rule) ? budget.rule : '502030',
                now, now);

            const budgetId = Number(info.lastInsertRowid)
                || db.get('SELECT id FROM budget WHERE period_type = ? AND period_key = ?',
                          'month', periodKey).id;

            const line = db.prepare(`INSERT INTO budget_line
                (budget_id, category_id, planned_sen, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (budget_id, category_id) DO UPDATE
                  SET planned_sen = excluded.planned_sen, updated_at = excluded.updated_at`);

            Object.entries(budget.amounts || {}).forEach(([code, value]) => {
                const categoryId = categoryByCode.get('expense:' + code);
                const sen = senOrNull(value);
                if (categoryId && sen !== null && sen > 0) line.run(budgetId, categoryId, sen, now, now);
            });

            // User-added rows had no category of their own; they get one now.
            (Array.isArray(budget.custom) ? budget.custom : []).forEach((c, i) => {
                const label = String((c && c.label) || '').trim();
                const sen = senOrNull(c && c.amount);
                if (!label || sen === null || sen <= 0) return;
                const made = db.run(
                    `INSERT INTO category (code, label, kind, bucket, sort_order, created_at, updated_at)
                     VALUES (NULL, ?, 'expense', ?, ?, ?, ?)`,
                    label.slice(0, 120),
                    ['needs', 'wants', 'save'].includes(c.bucket) ? c.bucket : 'wants',
                    50 + i, now, now);
                line.run(budgetId, Number(made.lastInsertRowid), sen, now, now);
            });

            report.budget = 1;
        }

        /* ---- credit card ------------------------------------------------ */
        const card = body.card && typeof body.card === 'object' ? body.card : null;
        const cardBalance = card ? senOrNull(card.balance) : null;
        if (cardBalance !== null && cardBalance > 0) {
            const rate = Number(String(card.rate).replace(/[^\d.]/g, ''));
            const minPct = Number(String(card.minPct).replace(/[^\d.]/g, ''));
            db.run(
                `INSERT INTO credit_card
                   (name, balance_sen, apr_bp, min_pct_bp, min_floor_sen, plan_payment_sen,
                    created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                'Credit card', cardBalance,
                Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) : 1800,
                Number.isFinite(minPct) && minPct > 0 ? Math.round(minPct * 100) : 500,
                senOrNull(card.minFloor) ?? 2500,
                senOrNull(card.payment), now, now);
            report.cards = 1;
        }

        db.run(`INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            IMPORT_FLAG, JSON.stringify({ at: now, ...report }), now);
    });

    return report;
}

module.exports = {
    routes: [
        ['GET',  '/api/import', status],
        ['POST', '/api/import', importLocalStorage],
    ],
};
