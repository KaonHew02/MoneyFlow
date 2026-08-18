/**
 * Reference data: accounts, categories, sub-categories, payment methods and
 * user settings — the tables every module reads before it can show anything.
 *
 * `/api/bootstrap` hands the whole lot over in one request so a page load is
 * one round trip rather than five.
 */

const db = require('../db');
const { bad, notFound } = require('../http');
const v = require('../valid');

const ACCOUNT_GROUPS = ['cash', 'bank', 'ewallet', 'savings', 'credit', 'investment'];

/* ---------------------------------------------------------------- accounts */

const accountsWithBalances = () => db.all(
    `SELECT account_id AS id, name, group_type, currency, is_active, balance_sen
       FROM v_account_balance
      ORDER BY is_active DESC, sort_order, name`);

function createAccount({ body }) {
    const now = db.stamp();
    const info = db.run(
        `INSERT INTO account (name, group_type, currency, opening_sen, note, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        v.name(body.name),
        v.oneOf(body.group_type, ACCOUNT_GROUPS, 'group_type'),
        v.text(body.currency || 'MYR', 3).toUpperCase(),
        body.opening_sen === undefined ? v.toSen(body.opening ?? 0, 'opening') : Number(body.opening_sen),
        v.text(body.note, 500),
        Number(body.sort_order) || 0,
        now, now);
    return db.get('SELECT * FROM account WHERE id = ?', info.lastInsertRowid);
}

function updateAccount({ params, body }) {
    const id = v.id(params.id);
    const existing = db.get('SELECT * FROM account WHERE id = ?', id);
    if (!existing) notFound('No such account');

    db.run(
        `UPDATE account SET name = ?, group_type = ?, currency = ?, opening_sen = ?,
                            note = ?, is_active = ?, sort_order = ?, updated_at = ?
          WHERE id = ?`,
        body.name === undefined ? existing.name : v.name(body.name),
        body.group_type === undefined ? existing.group_type
            : v.oneOf(body.group_type, ACCOUNT_GROUPS, 'group_type'),
        body.currency === undefined ? existing.currency : v.text(body.currency, 3).toUpperCase(),
        body.opening_sen === undefined && body.opening === undefined
            ? existing.opening_sen
            : (body.opening_sen === undefined ? v.toSen(body.opening, 'opening') : Number(body.opening_sen)),
        body.note === undefined ? existing.note : v.text(body.note, 500),
        body.is_active === undefined ? existing.is_active : (body.is_active ? 1 : 0),
        body.sort_order === undefined ? existing.sort_order : Number(body.sort_order) || 0,
        db.stamp(), id);

    return db.get('SELECT * FROM account WHERE id = ?', id);
}

/**
 * An account is only removable while nothing points at it; otherwise it is
 * retired, which keeps every historical balance intact. The last active
 * account cannot go at all — a ledger with nowhere to record is not a ledger.
 */
function deleteAccount({ params }) {
    const id = v.id(params.id);
    if (!db.get('SELECT id FROM account WHERE id = ?', id)) notFound('No such account');

    const active = db.get('SELECT COUNT(*) AS n FROM account WHERE is_active = 1').n;
    if (active <= 1 && db.get('SELECT is_active FROM account WHERE id = ?', id).is_active) {
        bad('This is the only account left');
    }

    const used = db.get(
        'SELECT COUNT(*) AS n FROM txn WHERE account_id = ? OR to_account_id = ?', id, id).n;
    if (used > 0) {
        db.run('UPDATE account SET is_active = 0, updated_at = ? WHERE id = ?', db.stamp(), id);
        return { id, retired: true, entries: used };
    }

    db.run('DELETE FROM account WHERE id = ?', id);
    return { id, deleted: true };
}

/* -------------------------------------------------------------- categories */

const categories = () => db.all(
    `SELECT id, code, label, kind, bucket, icon, hint, is_active
       FROM category ORDER BY kind DESC, sort_order, label`);

const subcategories = () => db.all(
    `SELECT id, category_id, label, is_active
       FROM subcategory ORDER BY category_id, sort_order, label`);

function createCategory({ body }) {
    const now = db.stamp();
    const kind = v.oneOf(body.kind || 'expense', ['expense', 'income'], 'kind');
    const info = db.run(
        `INSERT INTO category (code, label, kind, bucket, icon, hint, sort_order, created_at, updated_at)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.name(body.label, 'label'), kind,
        kind === 'income' ? null : v.oneOf(body.bucket || 'wants', ['needs', 'wants', 'save'], 'bucket'),
        v.text(body.icon, 60), v.text(body.hint, 200),
        Number(body.sort_order) || 99, now, now);
    return db.get('SELECT * FROM category WHERE id = ?', info.lastInsertRowid);
}

function createSubcategory({ body }) {
    const categoryId = v.id(body.category_id, 'category_id');
    if (!db.get('SELECT id FROM category WHERE id = ?', categoryId)) bad('No such category');
    const now = db.stamp();
    const info = db.run(
        `INSERT INTO subcategory (category_id, label, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        categoryId, v.name(body.label, 'label'), Number(body.sort_order) || 99, now, now);
    return db.get('SELECT * FROM subcategory WHERE id = ?', info.lastInsertRowid);
}

/* ---------------------------------------------------------------- settings */

const paymentMethods = () => db.all(
    'SELECT id, code, label, is_active FROM payment_method ORDER BY sort_order, label');

function settings() {
    const out = {};
    db.all('SELECT key, value FROM setting').forEach((row) => {
        try { out[row.key] = JSON.parse(row.value); } catch (err) { out[row.key] = row.value; }
    });
    return out;
}

function putSetting({ params, body }) {
    db.run(`INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        v.text(params.key, 80), JSON.stringify(body.value ?? null), db.stamp());
    return { key: params.key, value: body.value ?? null };
}

const bootstrap = () => ({
    accounts: accountsWithBalances(),
    categories: categories(),
    subcategories: subcategories(),
    payment_methods: paymentMethods(),
    settings: settings(),
    schema_version: db.get("SELECT value FROM app_meta WHERE key = 'schema_version'").value,
});

module.exports = {
    routes: [
        ['GET',    '/api/bootstrap',        bootstrap],
        ['GET',    '/api/accounts',         accountsWithBalances],
        ['POST',   '/api/accounts',         createAccount],
        ['PUT',    '/api/accounts/:id',     updateAccount],
        ['DELETE', '/api/accounts/:id',     deleteAccount],
        ['GET',    '/api/categories',       categories],
        ['POST',   '/api/categories',       createCategory],
        ['GET',    '/api/subcategories',    subcategories],
        ['POST',   '/api/subcategories',    createSubcategory],
        ['GET',    '/api/payment-methods',  paymentMethods],
        ['GET',    '/api/settings',         settings],
        ['PUT',    '/api/settings/:key',    putSetting],
    ],
    accountsWithBalances,
};
