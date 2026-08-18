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
