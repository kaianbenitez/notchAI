# Real setup from the old tracker

Seed data for M1, so accounts aren't re-entered by hand. From `defaultCards` /
`defaultState` in cc-tracker `app.js` @ `0542fd1`. Amounts are pesos; the ledger wants
integer centavos.

## Cards

| id | Bank | Name | Holder | Limit | Limit group | Due day | Statement day | Default split to GF |
|---|---|---|---|---|---|---|---|---|
| `bpi-gold` | BPI | BPI Gold Mastercard | Primary | ₱237,000 | BPI shared | 12 | — | 0% |
| `bpi-amore` | BPI | BPI Amore Visa Cashback | Primary | ₱237,000 | BPI shared | 12 | — | 50% |
| `bpi-gold-supp` | BPI | BPI Gold Mastercard Supplementary | Supplementary | ₱237,000 | BPI shared | 12 | — | 100% |
| `unionbank-rewards` | UnionBank | UnionBank Rewards Visa Platinum | Primary | — | — | — | — | 0% |

PLAN.md §6 lists only "BPI CC" as one account. It is **three cards**, and the split default
differs per card — the supplementary card is 100% hers, Amore is 50/50, Gold is yours. That
default-split-per-card behaviour is doing real work and should survive into M1.

MariBank and BPI debit appear in PLAN.md §6 but not in this app at all — it only ever
tracked cards and bills.

### Gap: shared credit limits

`limitGroup: "BPI shared"` means the three BPI cards draw on **one ₱237,000 limit**, and the
old app computed utilisation across the group (`relatedCardIds`, `limitUsageForCardOrGroup`).

`db/schema.sql` has no equivalent — there is no limit column and no grouping, so
"how much of the BPI limit is left" is currently unanswerable. Options: a `credit_limit_minor`
on the account plus a nullable `limit_group_id` self-reference, or a small `limit_groups`
table. Worth deciding before the accounts CRUD is written, since it changes the accounts form.

Also absent from the schema: `holder` (primary vs supplementary). It matters for statement
reconciliation — supplementary charges appear on the primary's statement.

## Installment plan

| Name | Card | Monthly | Total | Term | First payment | Split |
|---|---|---|---|---|---|---|
| MacBook | `unionbank-rewards` | ₱1,260 | ₱45,360 | 36 months | 2026-01-02 | 0% (all yours) |

Runs to **2028-12**. The old app materialized these as virtual monthly transactions
(`allInstallmentOccurrences`) rather than storing 36 rows — worth copying. In PLAN.md terms
this is a `recurring_rules` row with a fixed occurrence count, and its remaining balance is a
liability that net worth (M6) should see.

Note it is on the UnionBank card, which has no due day and no limit recorded — the one
account with the least data is the one carrying a three-year commitment.

## Settings

```
yourName: "Kai"   partnerName: "Mia"   currency: "PHP"
```

The whole app is built around exactly two people, with `partnerSharePct` on every
transaction and a separate group-split path bolted on later for third parties. PLAN.md's
`people` + `splits` model generalizes this correctly — but the two-person case is ~95% of
real usage, so keep it one tap in the capture UI. Anything that makes the common split
slower than the old app is a regression.

## Categories in use

`Dining · Groceries · Transport · Subscriptions · Home · Shopping · Travel · Other`

Flat, no hierarchy. PLAN.md §3 supports `parent_id` nesting — seed these eight as the
top level and let subcategories grow from real data.

## What has no equivalent yet

`bills` (with logos, `monthly|quarterly|yearly` cadence, per-month paid toggle) and
`statementStatus` (per-statement paid/reviewed flags) were both live in the old app and have
no table in `db/schema.sql`. `bills` maps onto `recurring_rules` + `reminders` in M3.
`statementStatus` does not map onto anything — a "this statement is reconciled" marker is
what PLAN.md §6.2's provisional-vs-confirmed display needs, so it likely wants a real table.
