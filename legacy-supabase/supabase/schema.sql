-- =============================================================================
-- MoneyFlow — Supabase (Postgres) schema.
--
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Running it again is safe: everything is IF NOT EXISTS or CREATE OR REPLACE.
--
-- The two rules from the SQLite version carry over unchanged:
--
--   1. Money is a BIGINT number of sen, rates are basis points. Never a float.
--   2. Nothing derivable is stored — balances and every total are computed
--      from `txn` at read time.
--
-- What is new, and what makes this safe to put on a public web address:
--
--   Every table carries `user_id` and has Row Level Security switched on. The
--   key shipped in the browser is public by design; it grants nothing on its
--   own. A logged-in request can only ever see rows where `user_id` matches
--   the person making it. Without these policies a public site would be a
--   public database — they are the security, not a formality.
-- =============================================================================

-- =============================================================================
-- ACCOUNTS
-- =============================================================================

create table if not exists public.account (
    id          bigint generated always as identity primary key,
    user_id     uuid    not null default auth.uid() references auth.users (id) on delete cascade,
    name        text    not null,
    group_type  text    not null check (group_type in
                    ('cash','bank','ewallet','savings','credit','investment')),
    currency    text    not null default 'MYR',
    opening_sen bigint  not null default 0,
    note        text    not null default '',
    is_active   boolean not null default true,
    sort_order  integer not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists ix_account_user on public.account (user_id);

-- =============================================================================
-- CATEGORIES, SUB-CATEGORIES, PAYMENT METHODS
--
-- `code` identifies the seeded categories so the app can find them by name;
-- user-created ones leave it null. `bucket` is the 50/30/20 grouping and
-- applies to expense categories only — debt sits in 'save', not 'needs',
-- because clearing a card builds net worth the way a deposit does.
-- =============================================================================

create table if not exists public.category (
    id          bigint generated always as identity primary key,
    user_id     uuid    not null default auth.uid() references auth.users (id) on delete cascade,
    code        text,
    label       text    not null,
    kind        text    not null check (kind in ('expense','income')),
    bucket      text            check (bucket in ('needs','wants','save')),
    icon        text    not null default '',
    hint        text    not null default '',
    is_active   boolean not null default true,
    sort_order  integer not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    check (kind = 'income' or bucket is not null),
    unique (user_id, code)
);

create index if not exists ix_category_user on public.category (user_id);

create table if not exists public.subcategory (
    id          bigint generated always as identity primary key,
    user_id     uuid    not null default auth.uid() references auth.users (id) on delete cascade,
    category_id bigint  not null references public.category (id) on delete cascade,
    label       text    not null,
    is_active   boolean not null default true,
    sort_order  integer not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists ix_subcategory_parent on public.subcategory (category_id);
create index if not exists ix_subcategory_user   on public.subcategory (user_id);

-- Payment method is a separate axis from the account: the same bank account
-- pays by debit card, by DuitNow and by cash withdrawal, and the dashboard
-- breaks spending down by both.
create table if not exists public.payment_method (
    id          bigint generated always as identity primary key,
    user_id     uuid    not null default auth.uid() references auth.users (id) on delete cascade,
    code        text,
    label       text    not null,
    is_active   boolean not null default true,
    sort_order  integer not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (user_id, code)
);

create index if not exists ix_payment_method_user on public.payment_method (user_id);

-- =============================================================================
-- TRANSACTIONS — the one table every module reads and writes.
--
-- A transfer carries `to_account_id` and no category: it is neither income nor
-- expense and must be excluded from both totals by every query that reports
-- spending. The check constraints make a transfer without a far side, or one
-- pointing at itself, impossible to store.
--
-- `source_module` / `source_id` are how the other modules keep their footprint
-- in the ledger identifiable: a settled bill share, an instalment payment or a
-- card payment is a real transaction here, tagged with where it came from.
-- =============================================================================

create table if not exists public.txn (
    id                bigint generated always as identity primary key,
    user_id           uuid   not null default auth.uid() references auth.users (id) on delete cascade,
    type              text   not null check (type in ('income','expense','transfer')),
    amount_sen        bigint not null check (amount_sen > 0),
    txn_date          date   not null,
    account_id        bigint not null references public.account (id),
    to_account_id     bigint          references public.account (id),
    category_id       bigint          references public.category (id),
    subcategory_id    bigint          references public.subcategory (id),
    payment_method_id bigint          references public.payment_method (id),
    note              text   not null default '',
    currency          text   not null default 'MYR',
    source_module     text   not null default 'ledger',
    source_id         bigint,
    status            text   not null default 'cleared'
                          check (status in ('cleared','pending','void')),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    check (type <> 'transfer' or to_account_id is not null),
    check (type <> 'transfer' or to_account_id <> account_id),
    check (type =  'transfer' or to_account_id is null)
);

create index if not exists ix_txn_user     on public.txn (user_id, txn_date desc);
create index if not exists ix_txn_account  on public.txn (account_id, txn_date);
create index if not exists ix_txn_to       on public.txn (to_account_id, txn_date);
create index if not exists ix_txn_category on public.txn (category_id, txn_date);
create index if not exists ix_txn_type     on public.txn (type, txn_date);
create index if not exists ix_txn_source   on public.txn (source_module, source_id);

-- Balance per account: opening, plus everything paid in, less everything paid
-- out. Both legs of a transfer are picked up here and nowhere else.
--
-- `security_invoker = true` is essential: without it a view runs with its
-- owner's rights and would hand every user everyone's balances. With it, the
-- row policies below apply to the view exactly as they do to the tables.
create or replace view public.v_account_balance
with (security_invoker = true) as
select  a.id         as account_id,
        a.user_id    as user_id,
        a.name       as name,
        a.group_type as group_type,
        a.currency   as currency,
        a.is_active  as is_active,
        a.sort_order as sort_order,
        a.opening_sen
          + coalesce((select sum(t.amount_sen) from public.txn t
                       where t.status <> 'void' and (
                             (t.type = 'income'   and t.account_id    = a.id)
                          or (t.type = 'transfer' and t.to_account_id = a.id))), 0)
          - coalesce((select sum(t.amount_sen) from public.txn t
                       where t.status <> 'void' and t.account_id = a.id
                         and t.type in ('expense','transfer')), 0)
                     as balance_sen
from public.account a;

-- =============================================================================
-- M3 — BILL SPLITTER
-- =============================================================================

create table if not exists public.bill (
    id         bigint generated always as identity primary key,
    user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
    title      text   not null default '',
    bill_date  date   not null,
    service_bp integer not null default 0,   -- basis points: 1000 = 10.00%
    tax_bp     integer not null default 0,
    paid_by_id bigint,                       -- -> bill_participant.id
    account_id bigint         references public.account (id),
    txn_id     bigint         references public.txn (id),
    status     text   not null default 'open' check (status in ('open','settled','void')),
    note       text   not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists ix_bill_user on public.bill (user_id, bill_date desc);

create table if not exists public.bill_participant (
    id         bigint generated always as identity primary key,
    user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
    bill_id    bigint  not null references public.bill (id) on delete cascade,
    name       text    not null,
    is_self    boolean not null default false,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists ix_bill_participant on public.bill_participant (bill_id);

-- participant_id null = a shared line, split across everyone.
create table if not exists public.bill_item (
    id             bigint generated always as identity primary key,
    user_id        uuid   not null default auth.uid() references auth.users (id) on delete cascade,
    bill_id        bigint not null references public.bill (id) on delete cascade,
    participant_id bigint         references public.bill_participant (id) on delete cascade,
    label          text   not null default '',
    amount_sen     bigint not null check (amount_sen >= 0),
    sort_order     integer not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create index if not exists ix_bill_item on public.bill_item (bill_id);

create table if not exists public.bill_settlement (
    id             bigint generated always as identity primary key,
    user_id        uuid   not null default auth.uid() references auth.users (id) on delete cascade,
    bill_id        bigint not null references public.bill (id) on delete cascade,
    participant_id bigint not null references public.bill_participant (id) on delete cascade,
    owed_sen       bigint not null,
    paid_sen       bigint not null default 0,
    paid_on        date,
    txn_id         bigint         references public.txn (id),
    status         text   not null default 'unpaid'
                       check (status in ('unpaid','partial','paid','waived')),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create index if not exists ix_bill_settlement on public.bill_settlement (bill_id);

-- =============================================================================
-- M4 — BUDGETS
--
-- Planned amounts are stored; what was actually spent against them never is —
-- it is summed from `txn` for the same period, which is what makes "Budget
-- Remaining" true at every moment rather than as at the last save.
-- =============================================================================

create table if not exists public.budget (
    id          bigint generated always as identity primary key,
    user_id     uuid   not null default auth.uid() references auth.users (id) on delete cascade,
    period_type text   not null default 'month' check (period_type in ('month','year')),
    period_key  text   not null,                 -- '2026-08' or '2026'
    income_sen  bigint not null default 0,
    rule        text   not null default '502030',
    status      text   not null default 'active' check (status in ('active','archived')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (user_id, period_type, period_key)
);

create table if not exists public.budget_line (
    id          bigint generated always as identity primary key,
    user_id     uuid   not null default auth.uid() references auth.users (id) on delete cascade,
    budget_id   bigint not null references public.budget (id) on delete cascade,
    category_id bigint not null references public.category (id),
    planned_sen bigint not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (budget_id, category_id)
);

-- =============================================================================
-- M6 — CREDIT CARDS
-- =============================================================================

create table if not exists public.credit_card (
    id               bigint generated always as identity primary key,
    user_id          uuid   not null default auth.uid() references auth.users (id) on delete cascade,
    name             text   not null,
    account_id       bigint         references public.account (id),
    balance_sen      bigint not null default 0,
    apr_bp           integer not null default 1800,
    min_pct_bp       integer not null default 500,
    min_floor_sen    bigint not null default 2500,
    limit_sen        bigint,
    statement_day    integer check (statement_day between 1 and 31),
    due_day          integer check (due_day between 1 and 31),
    plan_payment_sen bigint,
    status           text   not null default 'active'
                         check (status in ('active','cleared','closed')),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create table if not exists public.card_payment (
    id                bigint generated always as identity primary key,
    user_id           uuid   not null default auth.uid() references auth.users (id) on delete cascade,
    card_id           bigint not null references public.credit_card (id) on delete cascade,
    paid_on           date   not null,
    amount_sen        bigint not null check (amount_sen > 0),
    interest_sen      bigint not null default 0,
    balance_after_sen bigint,
    txn_id            bigint         references public.txn (id),
    note              text   not null default '',
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists ix_card_payment on public.card_payment (card_id, paid_on);

-- =============================================================================
-- SETTINGS
-- =============================================================================

create table if not exists public.setting (
    user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
    key        text not null,
    value      jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, key)
);

-- =============================================================================
-- ROW LEVEL SECURITY
--
-- One policy per table, applied to every operation: you may touch a row only
-- if it is yours. `with check` covers inserts and updates, so a row cannot be
-- created under someone else's id either.
-- =============================================================================

do $$
declare
    t text;
    tables text[] := array[
        'account','category','subcategory','payment_method','txn',
        'bill','bill_participant','bill_item','bill_settlement',
        'budget','budget_line','credit_card','card_payment','setting'
    ];
begin
    foreach t in array tables loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists own_rows on public.%I', t);
        execute format(
            'create policy own_rows on public.%I for all to authenticated
                 using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end loop;
end $$;

-- =============================================================================
-- UPDATED_AT
--
-- Kept honest by the database rather than by whoever remembers to set it.
-- =============================================================================

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;

do $$
declare
    t text;
    tables text[] := array[
        'account','category','subcategory','payment_method','txn',
        'bill','bill_participant','bill_item','bill_settlement',
        'budget','budget_line','credit_card','card_payment','setting'
    ];
begin
    foreach t in array tables loop
        execute format('drop trigger if exists set_updated_at on public.%I', t);
        execute format('create trigger set_updated_at before update on public.%I
                        for each row execute function public.touch_updated_at()', t);
    end loop;
end $$;

-- =============================================================================
-- NEW USER SEED
--
-- A brand new account gets the starter categories, payment methods and
-- accounts, so the app is usable the moment you first log in rather than
-- presenting an empty form with nowhere to file anything.
--
-- security definer, because it runs as the signup happens, before there is a
-- logged-in session whose policies would let it write.
-- =============================================================================

create or replace function public.seed_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    food_id      bigint;
    transport_id bigint;
    bills_id     bigint;
    housing_id   bigint;
begin
    insert into public.category (user_id, code, label, kind, bucket, icon, hint, sort_order) values
        (new.id, 'housing',       'Housing',       'expense', 'needs', 'bi-house-door',   'Rent, mortgage, maintenance fee', 0),
        (new.id, 'food',          'Food',          'expense', 'needs', 'bi-basket',       'Groceries, kopitiam, food delivery', 1),
        (new.id, 'transport',     'Transport',     'expense', 'needs', 'bi-car-front',    'Petrol, tolls, parking, Grab, car loan', 2),
        (new.id, 'bills',         'Bills',         'expense', 'needs', 'bi-receipt',      'TNB, water, Unifi, phone, subscriptions', 3),
        (new.id, 'insurance',     'Insurance',     'expense', 'needs', 'bi-shield-check', 'Medical, life, motor, takaful', 4),
        (new.id, 'entertainment', 'Entertainment', 'expense', 'wants', 'bi-controller',   'Outings, hobbies, shopping, travel fund', 5),
        (new.id, 'savings',       'Savings',       'expense', 'save',  'bi-piggy-bank',   'ASB, unit trust, emergency fund, gold', 6),
        (new.id, 'debt',          'Debt',          'expense', 'save',  'bi-credit-card',  'Credit card, PTPTN, personal loan', 7),
        (new.id, 'other',         'Other',         'expense', 'wants', 'bi-three-dots',   'Anything that does not fit', 8),
        (new.id, 'salary',        'Salary',        'income',  null,    'bi-cash-stack',   '', 0),
        (new.id, 'bonus',         'Bonus',         'income',  null,    'bi-gift',         '', 1),
        (new.id, 'side',          'Side income',   'income',  null,    'bi-briefcase',    '', 2),
        (new.id, 'refund',        'Refund',        'income',  null,    'bi-arrow-counterclockwise', '', 3),
        (new.id, 'gift',          'Angpao',        'income',  null,    'bi-envelope-heart', '', 4),
        (new.id, 'other-in',      'Other',         'income',  null,    'bi-three-dots',   '', 5);

    select id into food_id      from public.category where user_id = new.id and code = 'food';
    select id into transport_id from public.category where user_id = new.id and code = 'transport';
    select id into bills_id     from public.category where user_id = new.id and code = 'bills';
    select id into housing_id   from public.category where user_id = new.id and code = 'housing';

    insert into public.subcategory (user_id, category_id, label, sort_order) values
        (new.id, food_id, 'Breakfast', 0), (new.id, food_id, 'Lunch', 1),
        (new.id, food_id, 'Dinner', 2),    (new.id, food_id, 'Groceries', 3),
        (new.id, food_id, 'Coffee', 4),    (new.id, food_id, 'Delivery', 5),
        (new.id, transport_id, 'Petrol', 0), (new.id, transport_id, 'Toll', 1),
        (new.id, transport_id, 'Parking', 2), (new.id, transport_id, 'Grab / taxi', 3),
        (new.id, transport_id, 'Car loan', 4), (new.id, transport_id, 'Service', 5),
        (new.id, bills_id, 'Electricity', 0), (new.id, bills_id, 'Water', 1),
        (new.id, bills_id, 'Internet', 2),    (new.id, bills_id, 'Phone', 3),
        (new.id, bills_id, 'Subscriptions', 4),
        (new.id, housing_id, 'Rent', 0), (new.id, housing_id, 'Mortgage', 1),
        (new.id, housing_id, 'Maintenance', 2), (new.id, housing_id, 'Repairs', 3);

    insert into public.payment_method (user_id, code, label, sort_order) values
        (new.id, 'cash',     'Cash',          0),
        (new.id, 'debit',    'Debit card',    1),
        (new.id, 'credit',   'Credit card',   2),
        (new.id, 'ewallet',  'E-wallet',      3),
        (new.id, 'transfer', 'Bank transfer', 4),
        (new.id, 'cheque',   'Cheque',        5);

    insert into public.account (user_id, name, group_type, sort_order) values
        (new.id, 'Cash',        'cash',    0),
        (new.id, 'Bank',        'bank',    1),
        (new.id, 'Touch ''n Go','ewallet', 2),
        (new.id, 'Credit card', 'credit',  3);

    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.seed_new_user();
