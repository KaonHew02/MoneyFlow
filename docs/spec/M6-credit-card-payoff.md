# M6 — Reduce · Credit Card Payoff

The module that argues with the minimum payment. It was a one-card calculator;
it is now a **book of cards** with a payoff plan across all of them, a payment
log, and the two strategies people actually mean when they say "which one do I
pay first".

---

## Cards are records

```
card = { name, limit, opening, balance, rate, minPct, minFloor, dueDay,
         autoRecord, account, category, closed,
         payments[ { date, amount, note, entryId } ] }
```

The form is a draft until **Save card**, the same bargain the rest of the app
struck. Store `moneyflow.card.v1` (shape v2), in `BACKUP_STORES`.

**A card carries four figures and derives the rest:**

| | |
|---|---|
| Credit limit | RM10,000 |
| Outstanding | RM4,500 |
| **Available** | RM5,500 — limit − outstanding |
| **Utilisation** | 45% — outstanding ÷ limit |
| **Minimum due** | max(5% of statement, RM25), the BNM rule |
| **Due date** | the day of the month; the module says which date next |

**Opening** is what was owed when you started tracking, and it is the only
thing progress can honestly be measured against:

```
Opening RM8,000 · paid RM2,500 · outstanding RM5,500 · 31.25% cleared
```

`Progress = paid ÷ opening`. It can pass 100% on a card you keep using, so the
bar caps at full and the figure tells the truth beside it.

**Interest and new spending push the outstanding back up**, and this app cannot
see either. So the outstanding is yours to correct from the statement — the
module never silently drifts, and logging a payment is the one thing that moves
it down on its own.

---

## The engine

Unchanged from the first version, and worth restating because it is the reason
the figures are trustworthy:

- **Simulated month by month, never solved by formula.** A card has no term,
  and the minimum due shrinks with the balance — which is the whole reason
  minimum-only payments run for years.
- **Interest rounds to the sen every month**, exactly as a bank does it. The
  annuity formula is off by one month here, which is why `cardPaymentFor`
  binary-searches against the same simulation instead.
- **A payment that never exceeds the interest is reported as stalling**, not
  looped over.
- Malaysian defaults: 18% a year (BNM's cap; 15/17/18 by payment record), a
  minimum of 5% of the statement with an RM25 floor, taken on the **statement**
  (balance + that month's interest), not the opening balance.

---

## Paying more than one card

You give the module **one monthly budget for all of them**. Every month it:

1. charges each card its interest,
2. pays every card its minimum,
3. throws whatever is left at **one** card, chosen by the strategy,
4. and rolls the freed-up minimum onward as each card clears.

That last step is the snowball effect, and it is why the totals beat paying
each card separately.

| Strategy | Extra goes to | Reads as |
|---|---|---|
| **Snowball** | the smallest balance | fastest first win |
| **Avalanche** | the highest interest rate | cheapest overall |
| **Minimum only** | nobody | the baseline both are measured against |

**A budget below the total minimums does not compute a plan.** It says how much
short you are, because a plan built on a payment you cannot make is worse than
no plan.

Avalanche is never more expensive than snowball, so the comparison reports what
snowball costs you and how much sooner (if at all) it clears a first card. Both
are shown; neither is recommended, because the choice is about whether you need
a win early on.

---

## Payments

Every payment is a record: date, amount, an optional note. Logging one
**reduces that card's outstanding** and, if the card's expense link is on,
writes one ledger entry — removed again if the payment is deleted. Same
mechanics as the Instalment Tracker, including the entry id living on the
payment so nothing is ever written twice.

Payments are dated, so the log is the honest answer to "am I actually paying
RM700 a month?" in a way a single outstanding figure never is.

---

## What it feeds

The Dashboard's **Credit card outstanding** KPI. Ledger accounts of type
`credit` remain the first source of truth — they are real balances. This module
stands in only when there are none, and says so.

---

## What it does not do

- **No statement import.** Every figure is typed or logged.
- **No purchases.** New spending on the card is not modelled; correct the
  outstanding instead. Modelling it would mean inventing a spending forecast.
- **No promotional or tiered rates within one card**, no cash-advance rate, no
  late fees. One rate per card, and the late fee is the bank's to charge —
  the same rule the Instalment Tracker follows.
