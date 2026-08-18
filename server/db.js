/**
 * MoneyFlow — database handle, schema application and first-run seed.
 * ---------------------------------------------------------------------------
 * `node:sqlite` ships with Node 24, so the whole persistence layer needs no
 * npm install and no native build step. The app stays a folder you can copy.
 *
 * The database is one file, `data/moneyflow.db`, next to the app. Backing up
 * years of records is copying that file.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = process.env.MONEYFLOW_DB || path.join(DATA_DIR, 'moneyflow.db');

const SCHEMA_VERSION = '1';

/** ISO timestamp for created_at / updated_at. */
const stamp = () => new Date().toISOString();

/**
 * The seeded categories are the Budget Planner's list, unchanged, so what you
 * recorded still reads straight against what you planned. `other` exists only
 * on the ledger side and deliberately carries no budget line.
 */
const SEED_EXPENSE_CATEGORIES = [
    { code: 'housing',       label: 'Housing',       bucket: 'needs', icon: 'bi-house-door',   hint: 'Rent, mortgage, maintenance fee' },
    { code: 'food',          label: 'Food',          bucket: 'needs', icon: 'bi-basket',       hint: 'Groceries, kopitiam, food delivery' },
    { code: 'transport',     label: 'Transport',     bucket: 'needs', icon: 'bi-car-front',    hint: 'Petrol, tolls, parking, Grab, car loan' },
    { code: 'bills',         label: 'Bills',         bucket: 'needs', icon: 'bi-receipt',      hint: 'TNB, water, Unifi, phone, subscriptions' },
    { code: 'insurance',     label: 'Insurance',     bucket: 'needs', icon: 'bi-shield-check', hint: 'Medical, life, motor, takaful' },
    { code: 'entertainment', label: 'Entertainment', bucket: 'wants', icon: 'bi-controller',   hint: 'Outings, hobbies, shopping, travel fund' },
    { code: 'savings',       label: 'Savings',       bucket: 'save',  icon: 'bi-piggy-bank',   hint: 'ASB, unit trust, emergency fund, gold' },
    { code: 'debt',          label: 'Debt',          bucket: 'save',  icon: 'bi-credit-card',  hint: 'Credit card, PTPTN, personal loan' },
    { code: 'other',         label: 'Other',         bucket: 'wants', icon: 'bi-three-dots',   hint: 'Anything that does not fit' },
];

const SEED_INCOME_CATEGORIES = [
    { code: 'salary',   label: 'Salary',      icon: 'bi-cash-stack' },
    { code: 'bonus',    label: 'Bonus',       icon: 'bi-gift' },
    { code: 'side',     label: 'Side income', icon: 'bi-briefcase' },
    { code: 'refund',   label: 'Refund',      icon: 'bi-arrow-counterclockwise' },
    { code: 'gift',     label: 'Angpao',      icon: 'bi-envelope-heart' },
    { code: 'other-in', label: 'Other',       icon: 'bi-three-dots' },
];

/** Sub-categories worth having on day one. The user adds the rest. */
const SEED_SUBCATEGORIES = {
    food:      ['Breakfast', 'Lunch', 'Dinner', 'Groceries', 'Coffee', 'Delivery'],
    transport: ['Petrol', 'Toll', 'Parking', 'Grab / taxi', 'Car loan', 'Service'],
    bills:     ['Electricity', 'Water', 'Internet', 'Phone', 'Subscriptions'],
    housing:   ['Rent', 'Mortgage', 'Maintenance', 'Repairs'],
};

const SEED_PAYMENT_METHODS = [
    { code: 'cash',     label: 'Cash' },
    { code: 'debit',    label: 'Debit card' },
    { code: 'credit',   label: 'Credit card' },
    { code: 'ewallet',  label: 'E-wallet' },
    { code: 'transfer', label: 'Bank transfer' },
    { code: 'cheque',   label: 'Cheque' },
];

const SEED_ACCOUNTS = [
    { name: 'Cash',        group_type: 'cash' },
    { name: 'Bank',        group_type: 'bank' },
    { name: "Touch 'n Go", group_type: 'ewallet' },
    { name: 'Credit card', group_type: 'credit' },
];

let db = null;

/**
 * Opens the database, applies the schema, and seeds the reference data on a
 * first run. Safe to call repeatedly: the schema is all CREATE IF NOT EXISTS
 * and the seed only fires when the table is empty, so an existing book is
 * never touched.
 */
function open() {
    if (db) return db;

    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    db = new DatabaseSync(DB_FILE);
    db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

    db.prepare('INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)')
      .run('schema_version', SCHEMA_VERSION);

    seed();
    return db;
}

function count(table) {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

function seed() {
    const now = stamp();

    if (count('category') === 0) {
        const insert = db.prepare(`INSERT INTO category
            (code, label, kind, bucket, icon, hint, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        SEED_EXPENSE_CATEGORIES.forEach((c, i) =>
            insert.run(c.code, c.label, 'expense', c.bucket, c.icon, c.hint, i, now, now));
        SEED_INCOME_CATEGORIES.forEach((c, i) =>
            insert.run(c.code, c.label, 'income', null, c.icon, '', i, now, now));

        const sub = db.prepare(`INSERT INTO subcategory
            (category_id, label, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
        const byCode = db.prepare('SELECT id FROM category WHERE code = ?');
        Object.keys(SEED_SUBCATEGORIES).forEach((code) => {
            const parent = byCode.get(code);
            if (!parent) return;
            SEED_SUBCATEGORIES[code].forEach((label, i) => sub.run(parent.id, label, i, now, now));
        });
    }

    if (count('payment_method') === 0) {
        const insert = db.prepare(`INSERT INTO payment_method
            (code, label, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
        SEED_PAYMENT_METHODS.forEach((m, i) => insert.run(m.code, m.label, i, now, now));
    }

    if (count('account') === 0) {
        const insert = db.prepare(`INSERT INTO account
            (name, group_type, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
        SEED_ACCOUNTS.forEach((a, i) => insert.run(a.name, a.group_type, i, now, now));
    }
}

/**
 * Runs `fn` inside a transaction. Every multi-row write goes through here — a
 * bill that half-settles, or a transfer that writes one leg, is worse than one
 * that fails outright.
 */
function tx(fn) {
    open().exec('BEGIN');
    try {
        const out = fn();
        db.exec('COMMIT');
        return out;
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

const all = (sql, ...params) => open().prepare(sql).all(...params);
const get = (sql, ...params) => open().prepare(sql).get(...params);
const run = (sql, ...params) => open().prepare(sql).run(...params);

module.exports = { open, tx, all, get, run, stamp, DB_FILE, SCHEMA_VERSION };
