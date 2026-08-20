# M4 — Plan · Financial Planner

The module that runs **before** the money is spent. Where the Expense Recorder
answers *where did it go*, the Planner answers *where should it go* — and then
holds the two side by side.

Three areas, one page:

1. **Budget** — a plan for a period, by category, measured against what the
   ledger says actually happened.
2. **Savings goals** — a target, what is in it so far, and the arithmetic that
   says whether you will get there.
3. **The guide** — 50/30/20 or 70/20/10, as a yardstick against the plan.

---

## A budget is a record, not a setting

The old planner held **one** budget, saved silently as you typed. That is a
setting, not a record: there was no August to compare September against, and no
moment where you decided the plan was finished.

A budget is now a **record per period**:

```
budget = { period, anchor, from, to, income, extra, rule, lines{ categoryId: amount } }
```

- **The form is a draft.** Typing changes the draft and nothing else. The draft
  is still persisted, so closing the tab does not lose an afternoon's work — it
  simply is not a *record* yet.
- **Save plan** commits the draft as the budget for that period. Saving again
  on the same period updates it, and stamps `updated`.
- The state pill next to the heading says which of the three you are looking
  at: **Draft** (nothing saved for this period), **Saved**, or **Unsaved
  changes**.

This is the same bargain the Bill Splitter struck: a sketch is not history.

### Periods

| Period | Range | Stepper moves by |
|---|---|---|
| Weekly | Monday–Sunday containing the anchor | 7 days |
| Monthly | 1st to last day of the month | 1 month |
| Yearly | 1 Jan – 31 Dec | 1 year |
| Custom | two typed dates | — |

Weeks start on **Monday**, the same as the Dashboard — a spending week that
splits the weekend across two rows tells you nothing useful about weekends.

Each period has its own budget. Stepping to a period with nothing saved gives a
blank plan and an offer to **copy the last saved one**, because next month's
budget is almost always last month's with two numbers changed.

Yearly and weekly plans are *plans for that span*, not a monthly figure
multiplied. The guide targets scale to the income typed for the span, so a
yearly plan wants a yearly income.

---

## Budget vs actual

Every category row carries four figures:

| | |
|---|---|
| **Budget** | what you typed |
| **Used** | every `EXPENSE` in the ledger filed under that category, inside the period |
| **Remaining** | Budget − Used; negative when overspent |
| **Used %** | Used ÷ Budget |

**Used is never stored.** It is summed from `ledgerState.entries` at paint time
— *record once, analyze many times*. Foreign-currency entries come through
`entrySen`, so a goal or a budget is always read in base currency.

Status follows the percentage:

| Used % | Tone | Reads as |
|---|---|---|
| under 80 | jade | on track |
| 80 – 100 | amber | close to the line |
| over 100 | red | budget exceeded |

A category with a budget of nothing and spending against it is **unbudgeted**,
not 0% — it is called out rather than shown as a silent overspend.

---

## Categories

**There is one category list in this app**, owned by the Expense Recorder and
shared with the Planner. Add / rename / delete in the Planner acts on that list:

- **Add** creates a real category. It appears in the Expenses picker the moment
  it exists — which is the point, because otherwise nothing could ever be
  *spent* on it and Used would read RM 0.00 forever.
- **Rename** renames it everywhere; entries point at the id, not the name.
- **Delete** removes it only if no entry points at it. Anything with history is
  **retired** instead (`enabled = false`): it leaves the pickers and the plan,
  and every record behind it stays intact.
- **Bucket** is editable here too, since it is what the 50/30/20 reading
  divides by.

The planner's old "custom" rows were planner-only and invisible to the ledger.
They are migrated into real categories on first load — one category per row
that had a label, its amount carried into the current month's budget. A row
with neither a label nor an amount is dropped.

---

## Savings goals

```
goal = { name, icon, target, targetDate, monthly, contributions[ {date, amount, note} ] }
```

**Current is the sum of the contributions, never a typed number.** A goal that
only holds a total cannot answer "am I actually saving RM500 a month?" — the
log can, and it is the same principle the ledger runs on.

Computed, never stored:

| | |
|---|---|
| Current | Σ contributions |
| Remaining | max(0, Target − Current) |
| Progress | Current ÷ Target |
| Needed monthly | Remaining ÷ months to **By** date — only when a date is set |
| Finishes | today + ⌈Remaining ÷ **Save monthly**⌉ months — only when a figure is set |

Both of the last two are shown when both inputs are filled, and they are the
pair that matters: *this is what you planned, this is what it takes*. When the
planned monthly falls short of what is needed, the goal says so in red.

A goal at or past its target is **reached** and drops to the bottom of the list.

---

## Persistence

| Store | Holds |
|---|---|
| `moneyflow.budget.v1` | every saved budget, plus the working draft |
| `moneyflow.goals.v1` | goals and their contributions |

Both are in `BACKUP_STORES`, so both ride along in Export / Import and the
Google Drive copy. The old `moneyflow.budget.v1` shape (`{income, extra, rule,
amounts, custom}`) is migrated on read into one saved budget for the current
month — see **Categories** for what happens to `custom`.

---

## What this module does not do

- **No alerts or notifications.** A budget that emails you is a different
  product; this one is looked at.
- **No rollover.** Underspending in August does not raise September's budget.
  It is a plan, not an envelope system — and a silent rollover is exactly the
  kind of stored derived figure this app refuses to keep.
- **Goals are not accounts.** A contribution to a goal is a record of intent;
  it does not move a balance in the Expense Recorder. Linking the two is a
  later decision, not an accident.
