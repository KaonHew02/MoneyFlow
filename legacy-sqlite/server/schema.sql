/*
 * MoneyFlow — relational schema.
 * ---------------------------------------------------------------------------
 * Two rules hold this file together, and everything else follows from them.
 *
 *   1. Money is an INTEGER number of sen. Never a float. A ringgit figure that
 *      has been through binary floating point stops adding up, and a ledger
 *      that does not add up is worthless.
 *
 *   2. Nothing that can be derived is stored. Balances, totals, budget
 *      remaining, category breakdowns and every comparison are computed from
 *      `txn` at read time. That is "record once, analyze many times" — a
 *      stored total is a second version of the truth waiting to drift.
 *
 * Dates are TEXT 'YYYY-MM-DD' (sorts and compares correctly as a string, and
 * sidesteps the UTC-parsing trap that moves a date-only value across the
 * dateline). Timestamps are TEXT ISO-8601.
 */

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

/* --------------------------------------------------------------------------
 * Meta and settings
 * -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS app_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setting (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

/* --------------------------------------------------------------------------
 * Accounts — where money sits.
 *
 * `opening_sen` is the balance before the first recorded transaction, so a
 * balance is always opening plus every txn that touched the account. A credit
 * card account runs negative; that is the amount owing, not an error.
 * Accounts are retired with is_active = 0, never deleted, because deleting one
 * would orphan history.
 * -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS account (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    group_type  TEXT    NOT NULL CHECK (group_type IN
                    ('cash','bank','ewallet','savings','credit','investment')),
    currency    TEXT    NOT NULL DEFAULT 'MYR',
    opening_sen INTEGER NOT NULL DEFAULT 0,
    note        TEXT    NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

/* --------------------------------------------------------------------------
 * Categories and sub-categories.
 *
 * `code` is set for the seeded categories so application code can find them by
 * name (the Budget Planner and the ledger must agree on what "food" is);
 * user-created categories leave it NULL. `bucket` is the 50/30/20 grouping and
 * applies to expense categories only — debt sits in `save`, not `needs`,
 * because clearing a card builds net worth the way a deposit does.
 * -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS category (
    id          INTEGER PRIMARY KEY,
    code        TEXT    UNIQUE,
    label       TEXT    NOT NULL,
    kind        TEXT    NOT NULL CHECK (kind IN ('expense','income')),
    bucket      TEXT             CHECK (bucket IN ('needs','wants','save')),
    icon        TEXT    NOT NULL DEFAULT '',
    hint        TEXT    NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    CHECK (kind = 'income' OR bucket IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS subcategory (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE CASCADE,
    label       TEXT    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_subcategory_parent ON subcategory (category_id);

/* Payment method is a separate axis from the account: the same Maybank account
 * pays by debit card, by DuitNow and by cash withdrawal, and the dashboard
 * breaks spending down by both. */
CREATE TABLE IF NOT EXISTS payment_method (
    id          INTEGER PRIMARY KEY,
    code        TEXT    UNIQUE,
    label       TEXT    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

/* --------------------------------------------------------------------------
 * Transactions — the one table every module reads and writes.
 *
 * A transfer carries `to_account_id` and no category: it is neither income nor
 * expense and must be excluded from both totals by every query that reports
 * spending. The CHECK constraints make a transfer without a far side, or one
 * pointing at itself, impossible to store.
 *
 * `source_module` / `source_id` are how the other modules keep their footprint
 * in the ledger identifiable: a settled bill share, an instalment payment or a
 * card payment is a real transaction here, tagged with where it came from, so
 * it can be found, updated and reversed with its parent.
 * -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS txn (
    id                INTEGER PRIMARY KEY,
    type              TEXT    NOT NULL CHECK (type IN ('income','expense','transfer')),
    amount_sen        INTEGER NOT NULL CHECK (amount_sen > 0),
    txn_date          TEXT    NOT NULL CHECK (txn_date LIKE '____-__-__'),
    account_id        INTEGER NOT NULL REFERENCES account(id),
    to_account_id     INTEGER          REFERENCES account(id),
    category_id       INTEGER          REFERENCES category(id),
    subcategory_id    INTEGER          REFERENCES subcategory(id),
    payment_method_id INTEGER          REFERENCES payment_method(id),
    note              TEXT    NOT NULL DEFAULT '',
    currency          TEXT    NOT NULL DEFAULT 'MYR',
    source_module     TEXT    NOT NULL DEFAULT 'ledger',
    source_id         INTEGER,
    status            TEXT    NOT NULL DEFAULT 'cleared'
                          CHECK (status IN ('cleared','pending','void')),
    created_at        TEXT    NOT NULL,
    updated_at        TEXT    NOT NULL,

    CHECK (type <> 'transfer' OR to_account_id IS NOT NULL),
    CHECK (type <> 'transfer' OR to_account_id <> account_id),
    CHECK (type =  'transfer' OR to_account_id IS NULL)
);

CREATE INDEX IF NOT EXISTS ix_txn_date     ON txn (txn_date);
CREATE INDEX IF NOT EXISTS ix_txn_account  ON txn (account_id, txn_date);
CREATE INDEX IF NOT EXISTS ix_txn_to       ON txn (to_account_id, txn_date);
CREATE INDEX IF NOT EXISTS ix_txn_category ON txn (category_id, txn_date);
CREATE INDEX IF NOT EXISTS ix_txn_type     ON txn (type, txn_date);
CREATE INDEX IF NOT EXISTS ix_txn_source   ON txn (source_module, source_id);

/* Balance per account: opening, plus everything paid in, less everything paid
 * out. Both legs of a transfer are picked up here and nowhere else. */
CREATE VIEW IF NOT EXISTS v_account_balance AS
SELECT  a.id                AS account_id,
        a.name              AS name,
        a.group_type        AS group_type,
        a.currency          AS currency,
        a.is_active         AS is_active,
        a.sort_order        AS sort_order,
        a.opening_sen
        + COALESCE((SELECT SUM(t.amount_sen) FROM txn t
                     WHERE t.status <> 'void' AND (
                           (t.type = 'income'   AND t.account_id    = a.id)
                        OR (t.type = 'transfer' AND t.to_account_id = a.id))), 0)
        - COALESCE((SELECT SUM(t.amount_sen) FROM txn t
                     WHERE t.status <> 'void' AND t.account_id = a.id
                       AND t.type IN ('expense','transfer')), 0)
                            AS balance_sen
FROM account a;

/* --------------------------------------------------------------------------
 * M3 — Bill Splitter.
 *
 * A bill is kept whole: who was there, what each of them ordered, the shared
 * lines, and what each still owes. A share is settled by writing a real `txn`
 * and pointing at it, so money coming back from a friend lands in the ledger
 * once and is never counted as income twice.
 * -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS bill (
    id            INTEGER PRIMARY KEY,
    title         TEXT    NOT NULL DEFAULT '',
    bill_date     TEXT    NOT NULL CHECK (bill_date LIKE '____-__-__'),
    service_bp    INTEGER NOT NULL DEFAULT 0,   /* basis points: 1000 = 10.00% */
    tax_bp        INTEGER NOT NULL DEFAULT 0,
    paid_by_id    INTEGER,                      /* -> bill_participant.id */
    account_id    INTEGER          REFERENCES account(id),
    txn_id        INTEGER          REFERENCES txn(id),  /* the payer's own outlay */
    status        TEXT    NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','settled','void')),
    note          TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS bill_participant (
    id          INTEGER PRIMARY KEY,
    bill_id     INTEGER NOT NULL REFERENCES bill(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    is_self     INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0,1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_bill_participant ON bill_participant (bill_id);

/* participant_id NULL = a shared line, split across everyone. */
CREATE TABLE IF NOT EXISTS bill_item (
    id             INTEGER PRIMARY KEY,
    bill_id        INTEGER NOT NULL REFERENCES bill(id) ON DELETE CASCADE,
    participant_id INTEGER          REFERENCES bill_participant(id) ON DELETE CASCADE,
    label          TEXT    NOT NULL DEFAULT '',
    amount_sen     INTEGER NOT NULL CHECK (amount_sen >= 0),
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_bill_item ON bill_item (bill_id);

CREATE TABLE IF NOT EXISTS bill_settlement (
    id             INTEGER PRIMARY KEY,
    bill_id        INTEGER NOT NULL REFERENCES bill(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES bill_participant(id) ON DELETE CASCADE,
    owed_sen       INTEGER NOT NULL,
    paid_sen       INTEGER NOT NULL DEFAULT 0,
    paid_on        TEXT,
    txn_id         INTEGER          REFERENCES txn(id),
    status         TEXT    NOT NULL DEFAULT 'unpaid'
                       CHECK (status IN ('unpaid','partial','paid','waived')),
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_bill_settlement ON bill_settlement (bill_id);

/* --------------------------------------------------------------------------
 * M4 — Financial Planner: budgets.
 *
 * One budget per period, one line per category. Planned amounts are stored;
 * what was actually spent against them is never stored — it is summed from
 * `txn` for the same period, which is what makes "Budget Remaining" true at
 * every moment rather than as at the last time someone pressed save.
 * -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS budget (
    id          INTEGER PRIMARY KEY,
    period_type TEXT    NOT NULL DEFAULT 'month' CHECK (period_type IN ('month','year')),
    period_key  TEXT    NOT NULL,              /* '2026-08' or '2026' */
    income_sen  INTEGER NOT NULL DEFAULT 0,
    rule        TEXT    NOT NULL DEFAULT '502030',
    status      TEXT    NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','archived')),
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    UNIQUE (period_type, period_key)
);

CREATE TABLE IF NOT EXISTS budget_line (
    id          INTEGER PRIMARY KEY,
    budget_id   INTEGER NOT NULL REFERENCES budget(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES category(id),
    planned_sen INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    UNIQUE (budget_id, category_id)
);

/* --------------------------------------------------------------------------
 * M6 — Credit cards.
 *
 * Rates are basis points (1800 = 18.00% a year) so nothing about a card is a
 * float either. `balance_sen` is the opening figure the plan was built from;
 * the live outstanding is that less the payments recorded against it.
 * -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS credit_card (
    id               INTEGER PRIMARY KEY,
    name             TEXT    NOT NULL,
    account_id       INTEGER          REFERENCES account(id),
    balance_sen      INTEGER NOT NULL DEFAULT 0,
    apr_bp           INTEGER NOT NULL DEFAULT 1800,
    min_pct_bp       INTEGER NOT NULL DEFAULT 500,
    min_floor_sen    INTEGER NOT NULL DEFAULT 2500,
    limit_sen        INTEGER,
    statement_day    INTEGER CHECK (statement_day BETWEEN 1 AND 31),
    due_day          INTEGER CHECK (due_day BETWEEN 1 AND 31),
    plan_payment_sen INTEGER,
    status           TEXT    NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','cleared','closed')),
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS card_payment (
    id                INTEGER PRIMARY KEY,
    card_id           INTEGER NOT NULL REFERENCES credit_card(id) ON DELETE CASCADE,
    paid_on           TEXT    NOT NULL CHECK (paid_on LIKE '____-__-__'),
    amount_sen        INTEGER NOT NULL CHECK (amount_sen > 0),
    interest_sen      INTEGER NOT NULL DEFAULT 0,
    balance_after_sen INTEGER,
    txn_id            INTEGER          REFERENCES txn(id),
    note              TEXT    NOT NULL DEFAULT '',
    created_at        TEXT    NOT NULL,
    updated_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_card_payment ON card_payment (card_id, paid_on);
