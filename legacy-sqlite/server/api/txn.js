/**
 * Transactions — the record that everything else is calculated from.
 *
 * The rules enforced here, above what the schema already guarantees:
 *
 *   - an expense or income carries a category of the matching kind, and no
 *     far side;
 *   - a transfer carries a far side and no category, because it is neither
 *     income nor spending and must never appear in either total;
 *   - both accounts must exist, so no entry can point into nothing.
 *
 * Nothing is ever silently corrected. A request that breaks a rule is
 * refused with a reason, rather than stored as something the user did not
 * mean.
 */

const db = require('../db');
const { bad, notFound } = require('../http');
const v = require('../valid');

const TYPES = ['income', 'expense', 'transfer'];

const SELECT = `
    SELECT t.id, t.type, t.amount_sen, t.txn_date, t.note, t.currency, t.status,
           t.source_module, t.source_id, t.created_at, t.updated_at,
           t.account_id,        a.name  AS account_name,  a.group_type AS account_group,
           t.to_account_id,     b.name  AS to_account_name,
           t.category_id,       c.label AS category_label, c.code AS category_code,
                                c.bucket AS category_bucket, c.icon AS category_icon,
           t.subcategory_id,    s.label AS subcategory_label,
           t.payment_method_id, p.label AS payment_method_label
      FROM txn t
      JOIN account     a ON a.id = t.account_id
 LEFT JOIN account     b ON b.id = t.to_account_id
 LEFT JOIN category    c ON c.id = t.category_id
 LEFT JOIN subcategory s ON s.id = t.subcategory_id
 LEFT JOIN payment_method p ON p.id = t.payment_method_id`;

/**
 * Reads a transaction off the wire and returns the columns to store. Shared by
 * create and update so an edit cannot reach a state a create would refuse.
 */
function readFields(body) {
    const type = v.oneOf(body.type, TYPES, 'type');
    const accountId = v.id(body.account_id, 'account_id');
    if (!db.get('SELECT id FROM account WHERE id = ?', accountId)) bad('No such account');

    let toAccountId = null;
    if (type === 'transfer') {
        toAccountId = v.id(body.to_account_id, 'to_account_id');
        if (toAccountId === accountId) bad('A transfer needs two different accounts');
        if (!db.get('SELECT id FROM account WHERE id = ?', toAccountId)) bad('No such destination account');
    } else if (body.to_account_id) {
        bad('Only a transfer has a destination account');
    }

    let categoryId = null;
    let subcategoryId = null;
    if (type !== 'transfer') {
        categoryId = v.optionalId(body.category_id, 'category_id');
        if (categoryId !== null) {
            const category = db.get('SELECT id, kind FROM category WHERE id = ?', categoryId);
            if (!category) bad('No such category');
            if (category.kind !== type) bad(`That category is not a ${type} category`);
        }
        subcategoryId = v.optionalId(body.subcategory_id, 'subcategory_id');
        if (subcategoryId !== null) {
            const sub = db.get('SELECT category_id FROM subcategory WHERE id = ?', subcategoryId);
            if (!sub) bad('No such sub-category');
            if (categoryId !== null && sub.category_id !== categoryId) {
                bad('That sub-category belongs to a different category');
            }
        }
    }

    const paymentMethodId = v.optionalId(body.payment_method_id, 'payment_method_id');
    if (paymentMethodId !== null
        && !db.get('SELECT id FROM payment_method WHERE id = ?', paymentMethodId)) {
        bad('No such payment method');
    }

    return {
        type,
        amount_sen: body.amount_sen === undefined
            ? v.positiveSen(body.amount) : v.positiveSen(Number(body.amount_sen) / 100),
        txn_date: v.isoDate(body.txn_date ?? body.date),
        account_id: accountId,
        to_account_id: toAccountId,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        payment_method_id: paymentMethodId,
        note: v.text(body.note, 500),
        currency: v.text(body.currency || 'MYR', 3).toUpperCase(),
        status: v.oneOf(body.status || 'cleared', ['cleared', 'pending', 'void'], 'status'),
    };
}

/**
 * The list. Every filter is optional and they compose, which is what makes one
 * endpoint serve the ledger, an account's history, a category drill-down and
 * every dashboard breakdown.
 */
function list({ query }) {
    const where = [];
    const params = [];
    const push = (clause, value) => { where.push(clause); params.push(value); };

    if (query.get('from'))     push('t.txn_date >= ?', v.isoDate(query.get('from'), 'from'));
    if (query.get('to'))       push('t.txn_date <= ?', v.isoDate(query.get('to'), 'to'));
    if (query.get('month'))    { const m = v.monthKey(query.get('month')); push('t.txn_date LIKE ?', m + '-%'); }
    if (query.get('type'))     push('t.type = ?', v.oneOf(query.get('type'), TYPES, 'type'));
    if (query.get('category')) push('t.category_id = ?', v.id(query.get('category'), 'category'));
    if (query.get('subcategory')) push('t.subcategory_id = ?', v.id(query.get('subcategory'), 'subcategory'));
    if (query.get('payment_method')) push('t.payment_method_id = ?', v.id(query.get('payment_method'), 'payment_method'));
    if (query.get('source'))   push('t.source_module = ?', v.text(query.get('source'), 40));
    if (query.get('status'))   push('t.status = ?', v.oneOf(query.get('status'), ['cleared', 'pending', 'void'], 'status'));

    // An account's history is both legs of every transfer it took part in.
    if (query.get('account')) {
        const id = v.id(query.get('account'), 'account');
        where.push('(t.account_id = ? OR t.to_account_id = ?)');
        params.push(id, id);
    }
    if (query.get('q')) {
        where.push('t.note LIKE ?');
        params.push('%' + v.text(query.get('q'), 100) + '%');
    }

    const limit  = Math.min(Number(query.get('limit')) || 500, 5000);
    const offset = Math.max(Number(query.get('offset')) || 0, 0);
    const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';

    return {
        total: db.get(`SELECT COUNT(*) AS n FROM txn t${clause}`, ...params).n,
        limit,
        offset,
        entries: db.all(
            `${SELECT}${clause} ORDER BY t.txn_date DESC, t.id DESC LIMIT ? OFFSET ?`,
            ...params, limit, offset),
    };
}

const one = (id) => db.get(`${SELECT} WHERE t.id = ?`, id);

function create({ body }) {
    const f = readFields(body);
    const now = db.stamp();
    const info = db.run(
        `INSERT INTO txn (type, amount_sen, txn_date, account_id, to_account_id, category_id,
                          subcategory_id, payment_method_id, note, currency, source_module,
                          source_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        f.type, f.amount_sen, f.txn_date, f.account_id, f.to_account_id, f.category_id,
        f.subcategory_id, f.payment_method_id, f.note, f.currency,
        v.text(body.source_module || 'ledger', 40), v.optionalId(body.source_id, 'source_id'),
        f.status, now, now);
    return one(info.lastInsertRowid);
}

function update({ params, body }) {
    const id = v.id(params.id);
    const existing = db.get('SELECT id FROM txn WHERE id = ?', id);
    if (!existing) notFound('No such transaction');

    const f = readFields(body);
    db.run(
        `UPDATE txn SET type = ?, amount_sen = ?, txn_date = ?, account_id = ?, to_account_id = ?,
                        category_id = ?, subcategory_id = ?, payment_method_id = ?, note = ?,
                        currency = ?, status = ?, updated_at = ?
          WHERE id = ?`,
        f.type, f.amount_sen, f.txn_date, f.account_id, f.to_account_id, f.category_id,
        f.subcategory_id, f.payment_method_id, f.note, f.currency, f.status, db.stamp(), id);
    return one(id);
}

/**
 * A plain ledger entry is removed. One written by another module is not — a
 * settled bill share or a card payment belongs to its parent record, and
 * deleting it here would leave that record claiming a payment that no longer
 * exists. Those are voided instead, so the history still reads.
 */
function remove({ params }) {
    const id = v.id(params.id);
    const existing = db.get('SELECT id, source_module FROM txn WHERE id = ?', id);
    if (!existing) notFound('No such transaction');

    if (existing.source_module && existing.source_module !== 'ledger') {
        db.run("UPDATE txn SET status = 'void', updated_at = ? WHERE id = ?", db.stamp(), id);
        return { id, voided: true, source: existing.source_module };
    }

    db.run('DELETE FROM txn WHERE id = ?', id);
    return { id, deleted: true };
}

module.exports = {
    routes: [
        ['GET',    '/api/transactions',     list],
        ['POST',   '/api/transactions',     create],
        ['GET',    '/api/transactions/:id', ({ params }) => one(v.id(params.id)) || notFound('No such transaction')],
        ['PUT',    '/api/transactions/:id', update],
        ['DELETE', '/api/transactions/:id', remove],
    ],
};
