# Personal Finance Management System — Project Overview

MoneyFlow is a modular web application for long-term personal money management,
intended to be used continuously over months and years. It is **not** a
collection of temporary calculators.

## The 8 modules

| # | Verb | Module |
|---|------|--------|
| 1 | Understand | Financial Dashboard |
| 2 | Track | Expense Recorder |
| 3 | Share | Bill Splitter |
| 4 | Plan | Financial Planner |
| 5 | Commit | Instalment Tracker |
| 6 | Reduce | Credit Card Payoff |
| 7 | Grow | Savings & Investment |
| 8 | Convert | Currency Converter |

## Core design principle

**Record once, analyze many times.**

A single recorded transaction — `Food — RM25 — 17 Aug 2026` — is saved once and
then serves the daily summary, the August 2026 summary, the 2026 yearly
summary, the Food category analysis, the Maybank balance, the August vs July
comparison, the August 2026 vs August 2025 comparison, the dashboard and the
budget calculation.

Reports and dashboards **calculate from the original saved records**. No
duplicate record is ever written for a report.

## Central transaction concept

Three types, and only three:

- **INCOME** — increases one account balance.
- **EXPENSE** — decreases one account balance.
- **TRANSFER** — moves money between two accounts.

A transfer is neither income nor expense. It must never affect total income,
total expenses or net spending. It only changes the two account balances.

## Persistence

Everything below is persisted relationally and retained indefinitely unless the
user explicitly deletes it:

transactions · accounts · categories · sub-categories · bills · bill
participants · bill settlements · budgets · savings goals · instalment plans ·
instalment payment history · credit cards · credit card payment history ·
savings contributions · investments · investment contributions/transactions ·
saved currency conversions · user settings

Every record carries an id, created date, updated date, and a status where
applicable.
