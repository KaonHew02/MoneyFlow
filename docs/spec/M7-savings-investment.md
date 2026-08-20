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
investment = { name, type, opened, value, valueDate, note, closed,
               fd { rate, months },
               contributions[ { date, unit, figure, base, note } ] }
```

Types: ASB · EPF · Fixed deposit · Stocks · ETF · Unit trust · Gold ·
Something else.

| Derived | |
|---|---|
| **Total invested** | Σ contributions |
| **Current value** | what you typed, as at a date you typed — blank means "worth what went in" |
| **Profit / loss** | current value − total invested |
| **Return** | profit ÷ invested × 100 |

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

- **No prices, no dividends, no unit counts.** Every value is typed. Anything
  else would need a market feed this app does not have.
- **No tax, no EPF dividend forecast.** Both are annual announcements, not
  arithmetic.
- **No selling.** An investment is closed, which keeps its history out of the
  live totals — the same bargain a closed card and a cancelled instalment get.
