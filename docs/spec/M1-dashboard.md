# M1 — UNDERSTAND → Financial Dashboard

The central overview of the entire application. Summarises data from all other
modules. Reads only; it writes nothing of its own.

## KPIs

Total Balance · Total Income · Total Expenses · Net Cash Flow · Total Savings ·
Total Investment Value · Outstanding Instalments · Credit Card Outstanding ·
Upcoming Payments · Budget Remaining

## Period selection

Today · This Week · This Month · Last Month · This Year · Last Year · Custom
Date Range.

The selected period updates every period-scoped figure on the dashboard.
(Account balances are all-time by nature and stay outside the period.)

## Account overview

Every active account with its balance, and a total:

    CIMB Bank       RM1,800
    Public Bank     RM6,000
    Maybank         RM1,800
    Cash              RM300
    -----------------------
    Total           RM9,900

Clicking an account opens its transaction history.

## Income vs expense

    Net Cash Flow = Income − Expenses

Transfers are excluded from both sides.

## Expense breakdown

By category, sub-category, account, and payment method.

    Food & Drinks       RM620
    Shopping            RM450
    Transportation      RM300
    Bills               RM500
    Entertainment       RM180
    Others              RM100

Charts: donut, bar, line.

## Spending trend

Over daily / weekly / monthly / yearly buckets.

    January    RM1,850
    February   RM1,920
    ...
    August     RM2,150

## Historical comparison

Any two periods, compared. This month vs last month, Q3 vs Q2, 2026 vs 2025,
January vs December.

Headline difference in ringgit and percent, with a direction — increased,
decreased, or approximately unchanged:

    August 2026  RM2,150
    July 2026    RM1,850
    Difference   +RM300  (+16.22%)

And the same comparison per category:

| Category  | July  | August | Difference |
|-----------|-------|--------|------------|
| Food      | RM510 | RM620  | +RM110 |
| Transport | RM300 | RM280  | −RM20  |
| Shopping  | RM400 | RM650  | +RM250 |
| Bills     | RM500 | RM500  | RM0    |

## What this module requires of the schema

- transactions carry `subcategory_id` and `payment_method_id`, not just category
- per-account transaction history → indexed `account_id` + date
- savings, investments, instalments and cards expose an outstanding/current
  value the dashboard can total
- a due-date bearing record for "Upcoming Payments" across instalments, cards
  and bills

---

# As built — 2026-08-18

Live as the **Dashboard** tab, and now the tab the app opens on. It reads the
ledger, the Budget Planner and Card Payoff, and **writes nothing** — there is
no `moneyflow.dash.*` store and there must not be one, or a saved total would
become a second version of the truth.

## What is real, and what is waiting

| KPI | Source |
|---|---|
| Total balance | every account's opening balance plus every entry, all time |
| Total income / expenses / net cash flow | ledger, period-scoped, transfers excluded |
| Total savings | balance of accounts in the `savings` group |
| Credit card outstanding | what is owed on `credit` accounts; with none on the books, Card Payoff's balance stands in and the tile says so |
| Budget remaining | Budget Planner's total plan − expenses in the period |
| **Investment value** | — **pending M7 Grow** |
| **Outstanding instalments** | — **pending M5 Commit** |
| **Upcoming payments** | — **pending M5 Commit**, which is where due dates arrive |

The three pending tiles are drawn dashed, showing `—` rather than `RM 0.00`.
Zero is a claim about your money; a dash is not.

**The breakdown splits by category, bucket and account.** Sub-category and
payment method are in the spec above and not here, because the ledger does not
record them yet — they arrive when M2 adds the fields, and the dimension
switcher takes two more buttons at that point.

## Decisions worth keeping

- **Balances sit outside the period.** An account holds what it holds; asking
  what Maybank held "during a fortnight" is not a question. Everything else on
  the page follows the period.
- **Weeks start Monday.** A spending week that splits the weekend across two
  rows says nothing useful about weekends.
- **The trend runs backwards from the end of the period, not inside it** —
  14 days / 12 weeks / 12 months / 5 years — because "Today" holds one point
  and one point is not a trend. The end is clamped to today, so the current
  month does not draw a fortnight of days that have not happened as a collapse.
- **A move under 1%, or under a ringgit, reads as "about the same".** Calling
  RM2,150 against RM2,148 an increase is technically true and useless.
- **Spending more is red, spending less is green** — the opposite of a share
  price, and the right way round for a household.
- **Donut slices are shades of their bucket's colour**, so eight categories fit
  without inventing a ninth meaning for a colour. Red stays reserved for being
  over budget.
- **A custom range entered backwards is swapped, not refused.** The intent is
  never in doubt, and an empty dashboard would be the only other answer.
- Charts are hand-written SVG. No library, no CDN — the app is still a folder
  you can copy.

## Verifying it

`scratchpad/page.js` + `test-dash.js` drive `index.html` + `app.js` through
jsdom with a fixed "today", a seeded book and a stubbed `localStorage`: 38
checks over every period button, every breakdown dimension, both chart modes,
all four trend grains, the comparison at all three grains, the account
drill-in, the empty book and the custom range entered backwards.
