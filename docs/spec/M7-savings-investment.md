# M7 — Grow · Savings & Investment

Building wealth, which is two different questions:

- **Savings** — what proportion of what comes in is still yours at the end of
  the month?
- **Investments** — what did you put in, what is it worth now, and what is the
  difference?

---

## Savings holds no records of its own

This is the important decision in the module, and it is the app's own rule
applied honestly: **record once, analyze many times.**

Three modules already record money being set aside, and none of them overlap:

| Source | Recorded in | Written by |
|---|---|---|
| Ledger entries in the **`save` bucket** | `moneyflow.ledger.v1` | Expense Recorder |
| **Goal contributions** | `moneyflow.goals.v1` | Planner (M4) |
| **Investment contributions** | `moneyflow.grow.v1` | this module |

They are disjoint **by construction**: goal contributions and investment
contributions deliberately do not write ledger entries — the same rule M4 set,
for the same reason. So the three can simply be added, and the breakdown says
which is which rather than presenting one unexplained figure.

Adding a fourth savings store here would have made two versions of the truth.

### Savings rate

```
Savings rate = savings ÷ income × 100
```

Income is the ledger's income entries for the period. The spec's worked
example: income RM4,300, savings RM1,000 → **23.26%**.

Also derived, never stored: **total savings** (the balance of accounts kept for
saving, which the Dashboard already computes), **this month**, **this year**,
and a **twelve-month trend** of saved against income.

### A target in ringgit or in percent

The user asked for the Bill Splitter's RM/% switch here, and it fits: a savings
target is stated either way in real life — "RM1,000 a month" or "20% of what I
earn". So the target carries a **unit**:

| Unit | Means |
|---|---|
| **RM** | that many ringgit for the period |
| **%** | that percent of the period's income |

The target is the only thing the savings half stores, because it is an
intention rather than a record.

---

## Investments

```
investment = { name, type, opened, opening, value, valueDate, note, closed,
               fd { rate, months },
               grow { monthly, rate, years },
               contributions[ { date, unit, figure, base, note } ],
               earnings[ { date, figure, rate, note } ] }
```

Types are the reader's list, not ours: added, renamed, removed and re-iconed on
the form, saved with the holdings. A holding points at a type's id, so renaming
one touches nothing; a type with holdings behind it cannot be removed until
they are moved, and the list can never be emptied. `fd` is the one id the app
knows by name — it is what opens the fixed deposit fold.

### Opening balance

Nobody starts tracking on the day they opened an EPF account. `opening` is what
the holding already held, and it counts as **money put in** — so Return is
measured against everything in there, not only against what was logged here.

It is deliberately **not** a contribution: it never reaches `growSavedIn`,
because it was not saved *this* month. Without it a holding with a balance and
no history read as pure profit — RM 50,000 of "worth now" against RM 0 put in,
a return of infinity.

### Growth projection

Every type but `fd`, which keeps its own. Monthly top-up, rate a year, and how
many years, against what the holding is worth now.

EPF and ASNB declare a rate once a year against the balance held, so this
compounds **annually**, and the year's top-ups are counted at **half** — money
paid in across twelve months has only been there for part of the year. That is
the standard approximation and it is stated on screen.

Like the FD projection, it fills the current value only when the button is
pressed.

Types: ASB · EPF · Fixed deposit · Stocks · ETF · Unit trust · Gold ·
Something else.

| Derived | |
|---|---|
| **Total invested** | Σ contributions |
| **Current value** | what you typed, as at a date you typed — blank means "worth what went in" |
| **Profit / loss** | current value − total invested |
| **Return** | profit ÷ invested × 100 |
| **Paid out** | Σ earnings |
| **Put in** | opening + Σ contributions |

### Dividends and interest are not contributions

An ASNB dividend or an EPF crediting is what the money did while it sat there,
not money you put in. Filing one as a contribution would claim you saved it,
inflate what went in and hide the return behind it — so payouts are their own
list:

- They **never** count towards savings for the month. `growSavedIn` does not
  see them.
- Logging one **raises Worth now by the same amount**, because a payout is
  credited into the holding. Removing one takes it back off. The figure stays
  editable either way — this only saves doing the addition by hand.
- The declared rate is kept beside the ringgit because that is how these are
  announced — "5.75% for 2024" — but **nothing is worked out from it**. The
  amount is the record; the rate is a note.
- The list is read a **calendar year at a time**, each year carrying its own
  total, because a dividend is an annual event.

### Every contribution is typed

There is no repeat, no standing amount and nothing that posts itself. A
contribution is a different figure most months — a bonus month, a rate change,
whatever was left over — so anything copied forward is one more thing to
correct before it can be right.

### Fed from a category

A holding can name a spending category instead: every expense filed under it in
the ledger is money into this holding, read straight from Expenses. The rows
show in the contributions list tagged `Expenses` and carry no ✕, because the
record is over there.

This is the app's own rule — record once, analyze many times — applied to the
one place it was still being broken: a monthly EPF top-up was an entry *and* a
contribution.

**Nothing is counted twice.** `growInvestedIn` adds a linked entry only when the
ledger has *not* already counted it — that is, when its category is outside the
`save` bucket. Inside the bucket, `growLedgerSavedIn` owns it. Entries are also
deduplicated across holdings, in case two of them name the same category.

### A rate becomes a ringgit

Put the announced rate in the payout row and leave the amount empty, and the
amount is worked out from the balance held **through that year** — a twelfth of
the rate against the balance standing in each month, which is how EPF and ASNB
actually pay. Money in during November earns two months, not twelve.

Typing an amount overrides it: when the statement arrives, the statement wins.

The spec's example: invested RM10,000, worth RM10,800 → **+RM800, 8%**.

**The current value is yours to update.** This app cannot see a unit trust
price or an EPF dividend, and a figure it invented would sit on screen looking
like a fact. The date beside it says how stale it is.

### Contributions in ringgit or in percent

EPF is 11% of salary; ASB is often "whatever is left". So a contribution
carries the same unit switch as the target:

- **RM** — the figure is the amount.
- **%** — the figure is a percentage of a **base**. The base defaults to the
  income the ledger recorded for that contribution's month, and is editable,
  because the month you are backfilling may have no income recorded.

Nothing is stored resolved: the unit, the figure and the base are kept, and the
ringgit is worked out at read time.

### Fixed deposit projection

A fold inside the form, for FD placements: **rate** and **tenure in months**
against what is invested.

The linked calculator does not disclose its formula, so this uses the standard
Malaysian convention and says so on screen:

- **Simple interest within a placement**: `interest = P × rate% × months ÷ 12`.
  A Malaysian FD pays at maturity, not monthly.
- **Compounded on renewal**: a tenure over twelve months is treated as
  successive one-year placements rolled over, then a final part-year at simple
  interest. That is what actually happens to a rolled-over FD.

The projection is a projection. It fills the current value only when you press
the button, so the figure on the record stays something you chose.

---

## Persistence

Store `moneyflow.grow.v1`, in `BACKUP_STORES`. Investments are records: the
form is a draft until **Save investment**, and contributions cannot be logged
against a draft.

---

## What it feeds

The Dashboard's **Investment value** KPI, drawn dashed until now.

---

## What it does not do

- **No prices and no unit counts.** Every value is typed. Anything else would
  need a market feed this app does not have. A dividend is *recorded* — see
  above — but never predicted.
- **No tax, no EPF dividend forecast.** Both are annual announcements, not
  arithmetic.
- **No selling.** An investment is closed, which keeps its history out of the
  live totals — the same bargain a closed card and a cancelled instalment get.
