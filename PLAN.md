# Personal Budgeting App — Plan

**Constraints (locked):** Philippines / PHP primary. Zero recurring cost. No Apple Developer
account. Solo dev. Must beat the current tracker on: web access, splitting, friends' debt,
group spend, bill reminders, spending insights — while keeping AI snap/receipt logging.

---

## 1. Decisions these constraints force

| Decision | Choice | Why |
|---|---|---|
| Distribution | **Installable PWA** (Next.js) | No $99/yr Apple fee = no App Store, no TestFlight. PWA installs from Safari, gets home-screen icon, offline, and (iOS 16.4+) **web push** — which is what bill reminders need. |
| Bank data | **Gmail alert parsing + CSV/statement import + AI capture** | No free PH aggregator exists (see §6). Your banks already email you every transaction; that email *is* the feed. |
| Ledger | **Double-entry** | Splitting, friend balances, and budgets are the *same* problem. One model solves all three. Retrofitting this later is a rewrite. |
| Money type | **Integer minor units (centavos)** + `currency` on every amount | Never float. Multi-currency needed anyway for IBKR (USD). |
| Investments | **IBKR Flex Web Service** (free) | Token-based XML export of positions/cash/NAV. No paid data vendor. |

---

## 2. Stack — all free tier

```
Next.js 15 (App Router) ──► Vercel Hobby (free)
Drizzle ORM ─────────────► Supabase Postgres (free: 500MB, pg_cron, RLS)
Supabase Auth ───────────► email magic link + Google
Cloudflare R2 ───────────► receipt images (10GB free, zero egress)
Gemini Flash ────────────► receipt/snap vision OCR (generous free tier)
GitHub Actions ──────────► Gmail poller cron (2000 min/mo free)
web-push + VAPID ────────► bill reminders (self-hosted, free)
```

You already know Next.js + Drizzle + Supabase from CleanOps — reuse that muscle memory.

**Why R2 and not Supabase Storage:** Supabase free tier gives 1GB storage. Receipt photos at
~250KB each = ~4,000 receipts before you're stuck. R2 gives 10GB free with no egress billing.
Compress to WebP at 1600px max edge client-side before upload regardless.

**PWA specifics that matter:**
- `<input type="file" accept="image/*" capture="environment">` for snap-log — works in iOS Safari,
  opens camera directly. No getUserMedia permission dance.
- Service worker + IndexedDB write-ahead queue so logging works offline (jeepney, no signal) and
  syncs later. This is table stakes; a budgeting app that fails offline gets abandoned.
- Web push requires the PWA be **added to home screen** on iOS. Onboarding must walk through this
  explicitly or reminders silently never work.

---

## 3. Data model

The core insight: **an expense category is just an account.** One uniform table means a split, a
friend loan, a budget, and a net-worth calculation all read from the same ledger.

```sql
accounts
  id, user_id, name, role, kind, currency, parent_id, archived_at
  -- role: asset | liability | expense | income | equity
  -- kind: cash | bank | ewallet | credit_card | brokerage | receivable | payable
  --     | category (when role = expense/income)
  -- parent_id gives category hierarchy: Food > Groceries, Food > Dining

transactions            -- the header / envelope
  id, user_id, occurred_at, payee, memo, group_id, receipt_id,
  source, source_ref, dedupe_hash, confidence, status
  -- source: manual | snap | receipt | email | csv | ibkr | recurring
  -- status: confirmed | pending_review | duplicate_merged

entries                 -- the actual money movement; MUST sum to zero per transaction
  id, transaction_id, account_id, amount_minor, currency, fx_rate_to_php
```

**Worked example — ₱1,000 dinner on your BPI card, split 50/50 with Ana:**

| account | amount |
|---|---|
| BPI Credit Card (liability) | −1,000 |
| Dining (expense) | +500 |
| Receivable: Ana (asset) | +500 |

Sum = 0. ✅ Your Dining budget correctly sees **₱500**, not ₱1,000 and not a manual `/2` hack.
Ana's balance is `SUM(entries WHERE account = 'Receivable: Ana')`.

**Ana pays you ₱500 to GCash:**

| account | amount |
|---|---|
| GCash (asset) | +500 |
| Receivable: Ana | −500 |

Balance → 0. Settle-up is just another transaction. No separate debt subsystem to keep in sync.

Enforce sum-to-zero with a deferred constraint trigger. It will catch real bugs.

### Supporting tables

```sql
people           id, user_id, name, contact, linked_user_id, receivable_account_id
groups           id, name, currency, simplify_debts_enabled
group_members    group_id, person_id, default_share_weight
splits           transaction_id, person_id, share_minor, share_type(equal|exact|pct|shares)

budgets          account_id (category), period(month|payday), amount_minor,
                 rollover_enabled, starts_on
recurring_rules  id, name, rrule, expected_amount_minor, tolerance_pct, account_id,
                 category_id, next_due_on, autopay, last_matched_txn_id
reminders        rule_id, fire_at, channel, sent_at, acknowledged_at

holdings         account_id, symbol, qty, avg_cost, currency, as_of
price_snapshots  symbol, as_of, close, currency
net_worth_daily  user_id, as_of, assets_minor, liabilities_minor   -- materialized nightly

ingest_events    id, source, raw_payload jsonb, parsed jsonb, status, txn_id
attachments      id, r2_key, sha256, mime, txn_id
```

`ingest_events` keeping the **raw payload forever** is non-negotiable — when your BPI email parser
breaks because they changed a template, you reprocess history instead of losing it.

---

## 4. The six gaps — how each is closed

### 4.1 Web support
Solved by construction. Same Next.js app, responsive: phone = bottom-tab capture-first UI, desktop
= dense table + keyboard entry + bulk edit. Desktop is where you'll actually do monthly review,
CSV import, and category cleanup — design it for that, not as a shrunken phone screen.

### 4.2 Splitting
Split UI on the transaction sheet: pick group or people, choose **equal / exact / percentage /
shares**, with an "unequal by shares" mode for the "I ate more" case. App writes the entries in §3
automatically. Your budget always reflects only your share.

Edge case worth handling because it *will* happen: someone else paid and you owe. Then the entries
flip — `Payable: Ana −500`, `Dining +500`, no cash account touched.

### 4.3 Friends' debt
Falls out of the ledger for free. Per-person screen shows running balance, every contributing
transaction, and a **Settle Up** button that pre-fills the netted amount.

`simplify_debts`: for a group, run min-cash-flow so 3 people with tangled balances settle in 2
transfers instead of 6. ~40 lines, high perceived value.

### 4.4 Group spend
Groups are containers with their own feed, per-member totals, and category breakdown for the group
itself ("Palawan trip: ₱18k, 42% accommodation").

**Multiplayer without cost:** don't build accounts for friends. Generate a **share link** to a
read-only group ledger page. If a friend wants in properly, they sign up and `people.linked_user_id`
connects them. Keeps you on free tier while the group is 1 real user + N names.

### 4.5 Bill reminders
`recurring_rules` with an RRULE. A scheduler (pg_cron, hourly) materializes `reminders` and pushes
via VAPID web push on a ladder: **T−5d → T−1d → due date 9am → overdue daily**.

The part most apps miss and you should build: **auto-reconciliation.** When a transaction lands
matching a rule's account + amount within `tolerance_pct` + date window, mark the bill paid and
cancel remaining reminders. If nothing matches by T+2, escalate to a "possibly missed" alert.

Also detect **new** recurring bills automatically from history (§4.6) and offer to promote them to
rules — you shouldn't have to enter 20 bills by hand.

### 4.6 Insights
Concrete, computed on a nightly job, surfaced as a card feed. Not a vague "AI insights" button.

| Insight | Rule |
|---|---|
| Category drift | Month-to-date vs trailing 3-month median for same day-of-month, flag >25% |
| Month-end forecast | Burn rate × days remaining, per category and total |
| Safe-to-spend | Cash on hand − committed bills before next payday − remaining essential budget |
| Subscription radar | Same merchant, amount within 5%, cadence 28–31d → list, flag **price increases** and ones with no recent engagement |
| Small leaks | Aggregate sub-₱200 transactions — the ₱120 coffee × 22 = ₱2,640 reveal |
| Merchant leaderboard | Top 10 by spend and by frequency (different lists, both useful) |
| Anomaly | Transaction >2σ above its category's historical distribution |
| Day/time pattern | Spend by weekday and hour — surfaces Friday-night and payday-week blowouts |

### 4.6.1 AI insights without cost

**Architecture rule: the LLM never computes a number.** Everything in the table above is SQL +
statistics, computed nightly by `pg_cron` on Supabase free tier. Cost: ₱0, permanently. The model
receives *precomputed aggregates* and writes prose around them. It never sees raw transactions and
never does arithmetic — a hallucinated figure in your finances is worse than no insight at all.

This also means the app **degrades gracefully**: pull the LLM out entirely and you still have every
number, just without the writing. Never build an insight that only exists as model output.

**Three tiers, cheapest first:**

| Tier | What it does | Cost |
|---|---|---|
| **Deterministic** (§4.6 table) | All the actual analysis. Insight cards, forecasts, anomalies, subscription radar | **₱0** — SQL + pg_cron |
| **Narrative** | Monthly/weekly written review over the aggregates | ~2–3k tokens in, ~500 out, **12–52 calls/year** |
| **Ask-your-money** (optional) | Natural-language question → text-to-SQL against a read-only view → run → narrate the result | Per query, user-initiated |

**Token math for the narrative tier:** a month of aggregates is ~20 category rows, 10 merchants,
12 months of totals, bill status, anomalies — call it 3k tokens. Twelve times a year is ~40k
tokens annually. Any free tier absorbs this without noticing.

**Free options:** Gemini Flash free tier, Groq, Cerebras, Mistral, OpenRouter's `:free` models —
or **Ollama locally** on your PC (Gemma 3 / Qwen 3 8B write a perfectly good monthly summary from
aggregates, at zero cost and zero data exposure; a monthly job doesn't care that your PC has to be
on).

> **But do the honest math before optimizing for ₱0.** At paid Gemini Flash rates the *entire* AI
> layer — narrative plus ~100 receipt scans a month — lands around **₱10–30/month**. That's a
> different order of magnitude from the ₱5,700/yr Apple fee that shaped this plan, and it buys the
> paid-tier data-handling exclusion that free tiers don't give you (§9, risk 6). For an app holding
> your complete financial position, paying ~₱20/month is probably the right call. Free is
> achievable; it just isn't obviously correct.

For text-to-SQL, if you build it: generate against a **read-only view**, with a statement timeout
and a row cap. Never give a generated query write access to the ledger.

---

## 5. AI capture pipeline

Keep what works in your current app, then go further:

1. **Snap log** — photo → Gemini Flash vision → `{merchant, total, date, currency, line_items[],
   category_guess}`. Structured output / JSON schema, not free-text parsing.
2. **Receipt scan** — same path, plus line items retained so a grocery receipt can split across
   Groceries / Household / Alcohol instead of one blob.
3. **Voice/text log** — "700 lunch with Ana split" → parsed intent including the split. Fastest
   input method by far; your current app doesn't have it.
4. **Confidence gate** — below threshold, the transaction lands as `pending_review` in an inbox
   rather than silently entering wrong data. Wrong data destroys trust in the insights.

Cost: Gemini Flash free tier covers personal volume. If you exceed it, receipt vision runs roughly
₱0.05–0.15 per scan. Budget ₱50/mo worst case.

**Category learning:** store `(merchant_normalized → category)` per user. After the first
correction, "Jollibee" is always Dining without asking. This beats any model call — do the lookup
first, only call the LLM on unknown merchants.

---

## 6. PH ingestion — the honest picture

**What does not exist for you:** Plaid/Teller don't cover PH. Brankas is the real PH open-finance
player but sells to businesses with contracts and KYC — not a free personal API. BSP's Open Finance
Framework is still rolling out. GCash and Maya have no public consumer API.

**Your actual account map (confirmed):**

| Account | Alert channel | Ingestion path |
|---|---|---|
| **BPI CC** — *dominant spend* | ⚠️ SMS only, **and only ≥₱1,000** | Hardest case — see §6.1 |
| **BPI debit** | ✅ Email per transaction | Gmail parser — realtime |
| **MariBank** | ✅ Email per transaction | Gmail parser — realtime |
| Cash / palengke / tricycle | none | AI capture (§5) |
| IBKR | — | Flex Web Service, daily |
| ~~RCBC CC~~ | — | **Dropped — no longer used** |

**Channels:**

| Channel | Method |
|---|---|
| **Gmail alerts** | OAuth refresh token → poll `newer_than:1d from:(...)` every 15 min via GitHub Actions → regex per sender template, LLM fallback on parse failure → `ingest_events` |
| **Merchant email receipts** | Same pipeline, wider sender list: Lazada, Shopee, Grab, Foodpanda, Netflix, Spotify, Steam, Apple. **This is how you recover much of your RCBC card spend** — online purchases email you even when the bank doesn't. |
| **CSV / statement import** | Column-mapping UI saved per bank. PDF statements → text extract → LLM to table |
| **AI capture** | Cash and anything with no digital trail (§5) |
| **IBKR** | Flex Query + Flex Web Service token, daily positions/cash/trades |

Build parsers as **per-sender template modules** with a test fixture per bank — templates change
without notice and you want a failing test, not silent data loss.

### 6.1 The BPI credit card problem — the hardest part of this app

This is where most of your money goes and it has the worst data. Be clear-eyed about the shape of
the gap:

- **SMS-only** → a PWA cannot read it on iOS. No workaround at the web layer.
- **≥₱1,000 threshold** → the sub-₱1,000 transactions produce *no signal at all*. That's the
  coffee, the lunch, the Grab ride — **most transactions by count, and precisely the spend your
  "small leaks" insight (§4.6) exists to find.**

So by *value* you're mostly covered by alerts; by *count* you're mostly blind. Both matter, for
different features.

**Step 0 — CONFIRMED CLOSED.** BPI cannot send credit card alerts by email. There is no automated
push channel for this account below ₱1,000, and none at all outside SMS. Plan accordingly; don't
revisit.

Five layers, in priority order:

**Layer 1 — monthly e-statement import. This is the backbone, not a fallback.**
The BPI CC e-statement is the *only* complete record of your dominant account — and, per Layer 2
below, the only place merchant names ever appear. Build it early (§7 — it's in M1) and build it
well.

> **Confirmed: PDF, password-protected.** No CSV export. So the pipeline is: decrypt with `qpdf`
> using a per-account password stored encrypted → extract text → LLM to structured rows →
> dual-pass verify (§8) → dedupe → review. Budget a full day for extraction alone; bank statement
> PDFs have irregular column layouts, multi-page continuation, and rows that wrap.

**Layer 2 — weekly "unbilled transactions" screenshot. A gap detector, not an importer.**

**Confirmed behaviour:** BPI's unbilled/recent view shows **category + amount only**. The merchant
name does not appear until the transaction *posts*. That kills the idea of using this as a data
source — you cannot build a usable ledger entry from "Dining, ₱340."

But it's still valuable, just for a different job. Reframed:

> Once a week, screenshot the unbilled list. The app parses `(date, amount, BPI category)` and
> compares against what you've logged. Anything unmatched becomes a **stub** — "₱340 · Food ·
> Aug 2 · unidentified" — sitting in your review queue asking you to name it.

Why that's worth building anyway:

- **The amount is a memory jog.** "₱340, Food, Saturday" is usually enough to recall the meal.
  Recalling three days later works; recalling three weeks later at statement time does not.
- **It detects omissions fast.** You logged 5 transactions this week; BPI shows 7. You now know
  exactly how many you missed and for how much, immediately.
- **Totals are correct even when detail isn't.** A stub with amount + category still lands in the
  right budget bucket, so your spending figures stay right even if the merchant is blank forever.
- **BPI's category is a free hint.** It's MCC-derived. Map BPI categories → your categories once
  and stubs auto-file themselves.

So the cadence layering is: **weekly = "did I miss anything, and how much"**, **monthly statement
= "what was it, exactly"** (merchant names arrive at posting and backfill the stubs).

Build: multi-image upload → parse `(date, amount, category)` → match against logged → stub the
rest. Same pipeline as statement import (§6.2), so it's nearly free once Layer 1 exists. Add a
**Sunday push reminder** via the bills system.

**Layer 3 — AI capture, promoted to primary.**
For sub-₱1,000 card spend there is no automated signal whatsoever, so **manual capture is the
system of record until the statement arrives.** This changes the product: snap/voice logging isn't
a nice-to-have you inherited from your old app, it's load-bearing. Consequences —

- Logging must take **under 5 seconds**. Home-screen shortcut → camera or voice → done. Any
  friction and you stop, and the app's numbers rot.
- Voice ("340 lunch") is likely your highest-volume input. Make it one tap from the icon.
- Add a **daily 9pm nudge**: "anything today?" with the day's known transactions listed. Catching
  it same-day is far more accurate than reconstructing at statement time.

**Layer 4 — merchant email receipts.**
Lazada, Shopee, Grab, Foodpanda, Netflix, Spotify, Steam, Apple. These email you regardless of
amount, so they cover exactly the sub-₱1,000 band the bank ignores — and with BPI email now ruled
out entirely, they are your *only* realtime signal in that band. Same Gmail parser you're already
building. Best effort-to-value ratio in the plan; do it in M4 as scheduled.

**Layer 5 — iOS Shortcuts SMS→webhook.**
iOS Personal Automations have a **"When I get a message"** trigger that can POST the body to your
app via *Get Contents of URL*. With email confirmed unavailable, this is the **only** automated
realtime signal your main card will ever produce — so it's worth a proper attempt, not the
throwaway 15 minutes I'd earlier suggested. It still only sees ≥₱1,000, but that's likely most of
your spend *by value*, and those are the transactions that blow a budget.

It remains the most fragile piece: must be set to Run Immediately, and personal automations have a
history of breaking silently across iOS updates. **Silent failure is the real danger** — you'd
trust numbers that quietly stopped updating. Build a staleness monitor: if no SMS webhook has
fired in 7 days, raise an in-app warning. Never let this layer be authoritative.

**Statement always wins on conflict.** Layers 2–5 are provisional.

### 6.2 Design consequence: provisional vs confirmed

Because your main account is only truly correct once a month, the app must be **honest about
freshness instead of pretending precision**. Show, per account:

> BPI CC · ₱14,320 tracked · **provisional** · last reconciled 12 days ago

and after statement import, `confirmed`. Insights and safe-to-spend should widen their error bars
on provisional data rather than quoting a confident wrong number. Trust in this app dies the first
time it states ₱14,320 with certainty and the statement says ₱19,800.

At import, surface a **reconciliation diff**: matched, amount-corrected, and *unlogged* rows. The
unlogged list is your feedback loop — it teaches you what you keep forgetting to capture, and it's
the single most useful screen in the app.

### Dedupe — the piece that decides whether this app is usable

Same coffee can arrive three times: you snapped it, BPI emailed you, and it appears in the CSV.

```
dedupe_hash = sha256(normalized_merchant | amount_minor | currency | date)
```

Exact hash match → auto-merge. Otherwise score candidates on: amount exact (0.5), date within ±3d
(0.2), merchant fuzzy ≥0.8 (0.2), same account (0.1). **≥0.8 auto-merge** (keeping the richest
source — receipt beats email beats CSV), **0.5–0.8 → review queue**, below → separate transactions.

Get this wrong and every number in the app is inflated. Write tests for it first.

**Credit cards need different rules than debit.** Because BPI CC data arrives as provisional
realtime signals reconciled by a monthly statement — and for your dominant account, this is the
common path, not an edge case:

- **Widen the date window to ±7 days.** Card *transaction date* and *posting date* differ, often
  across a weekend. A ±3d window will fail to merge and double-count.
- **Amounts can legitimately differ.** Foreign-currency purchases post at the bank's converted
  rate plus a forex fee — the SMS/receipt amount will *not* equal the statement amount. Match on
  merchant + date proximity and accept an amount delta up to ~5%, then take the statement figure.
  Tips added after the fact (restaurants) cause the same mismatch domestically.
- **Statement rows outrank everything.** On merge, statement amount and posting date win; keep the
  receipt image, line items, and category from the realtime record.
- **Anything on the statement with no match becomes a new transaction** flagged
  `pending_review` — that's your "I forgot to log this" catch, and it's genuinely useful.
- **The unbilled view has no merchant, so the standard hash won't work on it.** Fall back to a
  reduced key: `(amount_minor, date ±3d, account)`. Amount alone is surprisingly discriminating —
  ₱347.50 rarely collides. When it does (two ₱100 charges same day), don't guess: send both to
  review. A wrong auto-merge here silently deletes a real transaction.
- **The same charge is seen twice by BPI itself** — once unbilled (amount + category, no merchant),
  once posted (full detail). Treat the ledger row as **evolving**: match on the reduced key and
  *enrich* the existing stub with the merchant when the statement arrives, rather than inserting a
  second transaction. Store `bpi_seen_unbilled_at` / `bpi_posted_at` so you can tell the two
  sightings apart and never double-count.

---

## 7. Build order

| # | Milestone | Contents | Rough effort |
|---|---|---|---|
| **M0** | Foundation | Supabase project, Drizzle schema + sum-to-zero trigger, auth, PWA shell, offline queue | 1 wk |
| **M1** | **Parity + the card** | Manual entry, categories, accounts, budgets, month view. **Sub-5-second snap/voice capture** (load-bearing — §6.1 Layer 3). **Batch image→transactions import + dedupe + reconciliation diff** — this one pipeline serves both the monthly statement (Layer 1) and the weekly unbilled screenshot (Layer 2), so build it once. Import your existing app's CSV export so you keep history. | 3 wk |
| **M2** | Splits & groups | Split UI, people, receivables, group feed, settle-up, simplify-debts, share links | 1.5 wk |
| **M3** | Bills | Recurring rules, web push, reminder ladder, auto-reconciliation, recurring detection. **Daily 9pm capture nudge** | 1 wk |
| **M4** | Ingestion | Gmail OAuth, BPI debit + MariBank parsers, merchant receipt parsers, CSV mapper, review inbox | 1.5 wk |
| **M5** | Insights | Nightly aggregates, insight cards, monthly LLM narrative | 1 wk |
| **M6** | Net worth | IBKR Flex sync, holdings, savings goals, net-worth chart | 1 wk |

**Switch off your current app at end of M1**, not M6. Living in it daily is the only way you'll
find out which of these features you actually care about — and you may discover you'd reorder M4
and M5. The plan should bend to that.

---

## 8. Cost

**Budget: ₱500/month.** The plan needs roughly a quarter of that. Spend it where it protects data
quality, bank the rest.

| Item | Cost | Verdict |
|---|---|---|
| Vercel Hobby, Supabase Free, R2, GitHub Actions, web push | ₱0 | Free tiers genuinely suffice |
| **Paid LLM tier** (not free tier) | ~₱30/mo | **Buy it** — data-handling exclusion (§9 risk 6) |
| **Strong vision model for statement + screenshot parsing** | ~₱50–100/mo | **Buy it** — see below |
| Receipt/snap capture (cheap model, high volume) | ~₱20/mo | Flash-class is fine here |
| Domain (optional) | ~₱50/mo | Quality of life |
| **Total** | **~₱150/mo** | ₱350/mo headroom |

**Where the money actually matters: table extraction.** The weekly screenshot (§6.1 Layer 2) and
the monthly statement (Layer 1) are the backbone of your dominant account. An OCR error there
writes a wrong number straight into the ledger and every downstream figure inherits it. This is the
one place to use the best available model rather than the cheapest.

With headroom to spare, add **dual-pass verification** on those two pipelines: parse each
statement/screenshot twice (different prompt framings, or two different models), diff the results,
and auto-accept only rows that match. Mismatches go to the review queue. Doubling the cost of a
₱50/mo line item is trivial; silently corrupting your ledger is not.

**Free tiers stay free elsewhere.** Nightly `pg_dump` to R2 via GitHub Actions covers backups
without paying for Supabase Pro ($25/mo — over budget and unnecessary at your data size).

Ceilings to watch: Supabase free tier **pauses after 7 days of inactivity** (you'll use it daily —
fine) and caps at 500MB. Your transactions are tiny; the DB will not be the constraint. Images are,
which is why they live in R2.

**On the ₱5,700/yr Apple Developer fee:** it technically fits a ₱6,000/yr budget — but it would
consume the entire thing, leave nothing for the AI layer, and buy you *less*. Going native loses
the web app, which was your #1 complaint. And iOS forbids **any** app from reading SMS, so it
doesn't help the hardest problem in this plan either. Stay on the PWA.

---

## 9. Risks

1. **Manual capture is a single point of failure — the biggest risk in this plan.** Your dominant
   account has no automated signal below ₱1,000, so if you stop logging for a week the app's
   mid-cycle numbers are simply wrong. Mitigations: sub-5s capture, daily nudge, provisional/
   confirmed labelling (§6.2), and a monthly statement that always trues things up. Accept that
   between statements this app *estimates* your card, and design the UI to say so.
2. **Gmail parsers break.** Banks change templates without notice. Mitigation: raw payloads kept
   forever, LLM fallback parser, alert when a known sender fails to parse.
3. **iOS PWA push is fragile.** Only works when installed to home screen; iOS has historically
   dropped permissions on some updates. Add an in-app "reminders are healthy" check and an email
   fallback channel for bills.
4. **Dedupe tuning.** Thresholds in §6 are a starting point, not gospel. Instrument merge decisions
   so you can tune from real data.
5. **Scope.** Six gaps is a lot for a solo build. M1 is the only milestone that must ship.
6. **Free-tier LLM data handling.** Free Gemini API tiers have historically permitted use of your
   data for product improvement, including human review; paid tiers exclude this. Receipts are
   financial documents (merchant, amount, card tail, sometimes location). **Verify current terms
   before routing receipts through a free tier** — this is the one line item where paying a small
   amount is probably correct. Same question applies to any provider you swap in.
7. **Gmail OAuth scope.** `gmail.readonly` is broad. Since this is single-user and self-hosted you
   never need Google verification — but never let this app serve other users on that token.

---

## 10. Open questions

- Can the current app export CSV? If not, M1's importer needs a different path and history migration
  gets painful.
- Budget period: calendar month, or payday-to-payday? Payday cycles change the budget engine
  meaningfully and are usually the more useful model. Note your RCBC **statement cycle is a third
  period** — card budgets and the statement bill reminder key off that, not the calendar.
- IBKR: net-worth tracking only, or do you want performance/allocation analytics too?
**Answered:**
- ~~Can BPI send CC alerts by email?~~ **No.** §6.1 Step 0 closed.
- ~~Does the BPI app show unbilled transactions?~~ **Yes, but category + amount only — merchant
  appears only on posting.** Layer 2 reframed as a gap detector.
- ~~Statement format?~~ **PDF, password-protected, no CSV export.** `qpdf` path confirmed.
- ~~Can you export history from the current app?~~ **Yes.** Migration is safe.

**Still open:**
- **Deferred:** iOS Shortcuts SMS test (§6.1 Layer 5) — no ≥₱1,000 charge expected soon. Test
  opportunistically; nothing depends on it.
- How far back does the BPI unbilled view go? Determines whether a missed week is recoverable or
  whether you wait for the statement.
- Budget period: calendar month, payday-to-payday, or statement cycle? (See below.)
