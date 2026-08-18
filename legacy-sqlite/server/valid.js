/**
 * Input validation. Everything arriving from the browser is treated as
 * untrusted — not because someone is attacking a single-user app, but because
 * a malformed date or an amount that went through a float is how a ledger
 * quietly stops agreeing with the bank.
 */

const { bad } = require('./http');

/** 'RM 1,234.50', '1234.5', 1234.5 → 123450 sen. Rejects anything else. */
function toSen(value, field = 'amount') {
    if (value === null || value === undefined || value === '') bad(`${field} is required`);
    const text = String(value).replace(/[\s,]/g, '').replace(/^RM/i, '');
    if (!/^-?\d*(\.\d+)?$/.test(text) || text === '' || text === '-') bad(`${field} is not a number`);
    const sen = Math.round(Number(text) * 100);
    if (!Number.isSafeInteger(sen)) bad(`${field} is out of range`);
    return sen;
}

function positiveSen(value, field = 'amount') {
    const sen = toSen(value, field);
    if (sen <= 0) bad(`${field} must be more than zero`);
    return sen;
}

/** Dates stay 'YYYY-MM-DD' strings end to end; this checks the day is real. */
function isoDate(value, field = 'date') {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) bad(`${field} must be YYYY-MM-DD`);
    const [y, m, d] = text.split('-').map(Number);
    if (m < 1 || m > 12) bad(`${field} has no such month`);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d < 1 || d > daysInMonth) bad(`${field} has no such day`);
    return text;
}

const monthKey = (value, field = 'month') => {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}$/.test(text)) bad(`${field} must be YYYY-MM`);
    return text;
};

function oneOf(value, allowed, field) {
    if (!allowed.includes(value)) bad(`${field} must be one of ${allowed.join(', ')}`);
    return value;
}

function id(value, field = 'id') {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) bad(`${field} is not a valid id`);
    return n;
}

/** Optional foreign key: '' / null / undefined all mean "not set". */
function optionalId(value, field) {
    if (value === null || value === undefined || value === '') return null;
    return id(value, field);
}

const text = (value, max = 500) => String(value ?? '').slice(0, max);

function name(value, field = 'name') {
    const out = text(value, 120).trim();
    if (!out) bad(`${field} is required`);
    return out;
}

module.exports = { toSen, positiveSen, isoDate, monthKey, oneOf, id, optionalId, text, name };
