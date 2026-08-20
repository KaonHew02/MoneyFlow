# M5 — Commit · Instalment Tracker

Money already promised. A phone on 24 months, a laptop, a car, furniture,
SPayLater, personal financing — and the other direction, the RM3,000 you lent a
friend who is paying you back RM500 a month.

Where the Planner asks *where should it go* and the Recorder asks *where did it
go*, this one asks **what is already spoken for, and when is it due**.

---

## Two directions

A plan runs one of two ways, and the whole module reads off that one field:

| | `out` — you pay | `in` — you are paid |
|---|---|---|
| Example | iPhone on 24 months | RM3,000 lent to a friend |
| Counterparty | who you owe | who owes you |
| Shows in | *Still to pay* | *Owed to you* |
| A ticked payment writes | an **expense** | an **income** entry |

They are the same arithmetic pointed the other way, which is why they are one
module and not two.

---

## A plan

```
plan = { name, direction, who, basis, total | monthly, months,
         firstDue, autoRecord, account, category, cancelled,
         payments{ n: { paid, date, amount, entryId } } }
```

**Two figures and the third follows.** You know either the **total** (RM4,800
over 24 months) or the **monthly** (RM200 a month for 24 months) — `basis` says
which you typed, and the other is derived. Nobody has both to hand.

**The schedule always sums to the total, exactly.** Months are allocated
through `allocateSen`, so RM1,000 over three months is 333.34 / 333.33 / 333.33
rather than three figures that quietly lose two sen. Any single payment can be
overridden when the bank charged something else.

**Due dates come from `firstDue` and repeat on its day of the month.** This is
the SPayLater case: due before the 20th, every month. A first due date on the
31st clamps to the last day of shorter months rather than skidding into the
next one.

**Payments are keyed by their number, not their date.** Changing the term from
24 months to 30 leaves the eight already paid exactly where they were.

---

## Catching up

Most plans are picked up part-way through — a phone you have been paying since
January, entered in August. **How many months paid** takes the count, and the schedule
ticks that many months for you.

**It is derived, not applied.** `planCompute` treats the first N months as
settled, live, whether or not the plan has been saved. The first cut ticked
them on save instead — which meant a plan you were still filling in sat there
in red insisting every past month was overdue, the opposite of what you had
just told it. Nothing is written down, so nothing has to be undone: change the
number and the schedule follows.

**Ticking by hand wins over the count, in both directions.** A month's record
holds `paid: true`, `paid: false`, or no decision at all, and only the last
falls back to the count. So you can tick month 12 while the count says 8, or
un-tick month 3 that the count settled, and neither is lost when the count
changes.

**Caught-up months are deliberately not written to Expenses.** They were paid
months ago; eight entries all dated today would put RM1,600 of spending into
this month that never happened, and every report reading the ledger would
inherit it. They are dated their own due date instead and the row says
*caught up* rather than *in Expenses*.

That rule holds on the way back too: ticking a month that sits **inside** the
count returns it to caught-up rather than recording a payment made today. A
March payment must never be dated now.

---

## Status

The spec's list mixes two different things, so the module keeps them apart.

**A payment** is one of four, all derived from its due date and its tick:

| | |
|---|---|
| **Paid** | ticked |
| **Due** | today is the due date |
| **Overdue** | the due date has passed and it is not ticked |
| **Upcoming** | still ahead |

**A plan** is one of five, all derived except the last:

| | |
|---|---|
| **Upcoming** | the first payment is still in the future |
| **Active** | running |
| **Overdue** | running, with at least one payment past its date |
| **Completed** | every payment ticked |
| **Cancelled** | called off — the only one you set by hand |

A cancelled plan keeps its history and stops counting towards anything.

### Late fees are flagged, not invented

An overdue payment turns red and says how many days late. **No fee is
calculated.** SPayLater's charge is the bank's to make, and a number this app
made up would sit on screen looking like a fact. If you are charged, record it
as an ordinary expense.

---

## Countdown

For the next unticked payment:

- the **date** it is due
- **days remaining** — or days late, if it has passed
- **how many payments are left**
- **estimated completion**, which is the last payment's due date

---

## Expense integration

Each plan carries a switch: **record payments in Expenses**, with an account
and a category. Ticking a payment writes one ledger entry; un-ticking removes
it again. Set once per plan, not once per payment.

- `out` plans default the switch **on**, to the **Instalment** category.
- `in` plans default it **off**. Money coming back from a loan is not income —
  it is your own capital returning — and quietly inflating a year of income
  would be the worse default. Turn it on and choose the category if you want it
  recorded anyway.

`Instalment` is seeded into the category list if it is not there, because the
module needs somewhere to file. Retire it like any other category and it stays
retired.

---

## Persistence

Store `moneyflow.commit.v1`, in `BACKUP_STORES`. Plans are records: the form is
a draft until **Save plan**, the same bargain the Bill Splitter and the Planner
struck. **A schedule cannot be ticked until the plan is saved** — history is
for records, not sketches.

---

## What it feeds

Two Dashboard KPIs that were drawn dashed waiting for this module:

- **Outstanding instalments** — what is left on live `out` plans
- **Upcoming payments** — what falls due inside the Dashboard's own period

Both are computed at read time from the plans, like everything else.
