# M2 — TRACK → Expense Recorder

The main data-entry module. Everything the rest of the app reads is written
here.

## Transaction types

Income · Expense · Transfer.

## Transaction fields

Amount · Currency · Date · Time · Category · Sub-category · Account · Payment
method · Description · Notes · Tags · Receipt/image · Recurring flag.

## 8. Expense history

A complete transaction history.

Columns: Date · Transaction type · Description · Category · Account · Amount ·
Currency · Status.

Actions: Search · Sort · Filter · Edit · Delete · View details.

Filters: Date range · Category · Sub-category · Account · Transaction type ·
Currency · Amount range · Tags.

## 9. Daily / monthly / yearly summary

Persistent historical reports, calculated from the saved records.

**Daily** — total income, total expenses, total transfers, net cash flow,
number of transactions.

**Monthly** — total income, total expenses, net cash flow, category breakdown,
account breakdown, daily trend.

**Yearly** — monthly income, monthly expenses, savings, category trends,
highest spending month, lowest spending month.

## 10. Category management

Add · edit · delete · enable/disable a category. Add · edit · delete a
sub-category. Assign icon. Assign colour.

Default categories and sub-categories:

| Category | Sub-categories |
|---|---|
| Food & Drinks | Breakfast, Lunch, Dinner, Drinks, Snacks |
| Transportation | Petrol, Toll, Parking, Grab, Public Transport, Car Maintenance |
| Shopping | Clothes, Electronics, Groceries, Personal Items |
| Housing | Rent, Maintenance, Utilities, Household |
| Entertainment | Movies, Games, Events, Hobbies |
| Healthcare | Clinic, Medicine, Dental |
| Travel | Flight, Hotel, Activities, Food, Transportation |
| Bills | Electricity, Water, Internet, Phone, Subscriptions |
| Education | Courses, Books, Training |
| Family | Parents, Children, Gifts |
| Finance | Bank Fees, Interest |
| Others | — |

## 11. Account / wallet management

Multiple accounts, e.g. CIMB Bank, Public Bank, Maybank, Cash, Touch 'n Go,
other e-wallets, credit cards.

Fields: Account Name · Account Type · Currency · Opening Balance · Purpose ·
Status.

Types: Bank · Cash · E-Wallet · Credit Card · Other.

Both lists are the reader's: types and purposes can be added, renamed and
removed on the Accounts card. Those five types and the starting purposes are
only what a fresh browser begins with. A type that accounts are filed under
cannot be removed until they are moved — accounts are grouped by type, and
there has to be at least one. A purpose is only a note, so removing one
leaves the accounts that held it with no stated purpose and nothing else.

## 12. Account balance logic

    CIMB Bank     purpose: Salary
    Public Bank   purpose: Savings
    Maybank       purpose: Daily Expenses

    Salary                 CIMB        +4,300
    Transfer to savings    CIMB        −1,000    Public Bank  +1,000
    Transfer to spending   CIMB        −1,500    Maybank      +1,500
    Expense                Maybank       −200

    CIMB 1,800 · Public Bank 1,000 · Maybank 1,300

A transfer must never be treated as an expense: it changes two balances and
touches neither total.
