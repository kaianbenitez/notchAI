-- Ledger core. Authoritative DDL.
-- src/db/schema.ts mirrors this for typed reads; keep them in sync.
-- Base currency is PHP. All amounts are integer minor units (centavos). Never float.

create type account_role as enum ('asset', 'liability', 'expense', 'income', 'equity');

create type account_kind as enum (
  'cash', 'bank', 'ewallet', 'credit_card', 'brokerage',
  'receivable', 'payable', 'category'
);

create type txn_source as enum (
  'manual', 'snap', 'receipt', 'voice',
  'email', 'csv', 'statement', 'unbilled', 'sms',
  'ibkr', 'recurring'
);

create type txn_status as enum ('confirmed', 'pending_review', 'stub', 'duplicate_merged');

-- Categories are accounts with role expense/income and kind 'category'.
-- Friend receivables/payables are accounts too. One table, so splits, debts,
-- budgets and net worth all read from the same ledger.
create table accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  name        text not null,
  role        account_role not null,
  kind        account_kind not null,
  currency    char(3) not null default 'PHP',
  parent_id   uuid references accounts (id) on delete set null,
  person_id   uuid,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint category_role_matches
    check (kind <> 'category' or role in ('expense', 'income')),
  constraint counterparty_role_matches
    check (kind not in ('receivable', 'payable')
           or role in ('asset', 'liability'))
);

create table people (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null,
  name                  text not null,
  contact               text,
  linked_user_id        uuid,
  receivable_account_id uuid references accounts (id) on delete restrict,
  created_at            timestamptz not null default now()
);

-- Immutable source material for imports. Raw payloads are retained so parser
-- changes can be replayed against history without losing the original input.
create table ingest_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  kind        txn_source not null,
  account_id  uuid references accounts (id) on delete restrict,
  raw_payload text not null,
  created_at  timestamptz not null default now()
);

create table transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  occurred_at date not null,
  payee       text,
  memo        text,
  source      txn_source not null default 'manual',
  status      txn_status not null default 'confirmed',
  confidence  real,

  -- Dedupe. dedupe_hash = sha256(merchant|amount|currency|date) when a merchant
  -- is known. reduced_key = amount|date|account, for sources with no merchant
  -- (BPI's unbilled view) — see PLAN.md §6.
  source_ref  text,
  dedupe_hash text,
  reduced_key text,

  -- One charge is seen twice by BPI: unbilled (no merchant), then posted (full
  -- detail). The row is enriched in place; these tell the sightings apart so it
  -- is never double-counted.
  seen_unbilled_at timestamptz,
  posted_at        timestamptz,
  ingest_event_id  uuid references ingest_events (id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table entries (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  account_id     uuid not null references accounts (id) on delete restrict,

  -- Native amount, in this entry's own currency.
  amount_minor   bigint not null,
  currency       char(3) not null default 'PHP',

  -- Same amount converted to PHP centavos. Stored, not computed, so historical
  -- rows never shift when rates change. This is the column that must balance.
  base_amount_minor bigint not null,
  fx_rate_to_base   numeric(18, 8) not null default 1,

  created_at     timestamptz not null default now(),

  constraint entry_nonzero check (amount_minor <> 0),
  constraint php_needs_no_conversion
    check (currency <> 'PHP'
           or (base_amount_minor = amount_minor and fx_rate_to_base = 1))
);

create index entries_transaction_idx on entries (transaction_id);
create index entries_account_idx     on entries (account_id);
create index txn_user_date_idx       on transactions (user_id, occurred_at desc);
create index txn_dedupe_idx          on transactions (user_id, dedupe_hash)
  where dedupe_hash is not null;
create index txn_reduced_idx         on transactions (user_id, reduced_key)
  where reduced_key is not null;
create index txn_ingest_event_idx    on transactions (ingest_event_id);
-- Client-minted capture ids make offline queue replays idempotent.
create unique index txn_user_source_ref_unique_idx on transactions (user_id, source_ref)
  where source_ref is not null;

-- ---------------------------------------------------------------------------
-- The invariant everything else depends on: entries sum to zero, in PHP.
--
-- DEFERRED so entries can be inserted one at a time inside a transaction; the
-- check runs at COMMIT. If this fires, a bug tried to create money.
--
-- Note: a transactions row with no entries at all is not caught here (no entry
-- rows exist to fire the trigger). Such a row is inert — it has no effect on
-- any balance — so it is left as a housekeeping concern, not a correctness one.
-- ---------------------------------------------------------------------------
create or replace function assert_txn_balanced() returns trigger
language plpgsql as $$
declare
  v_txn   uuid := coalesce(new.transaction_id, old.transaction_id);
  v_sum   bigint;
  v_count int;
begin
  select coalesce(sum(base_amount_minor), 0), count(*)
    into v_sum, v_count
    from entries
   where transaction_id = v_txn;

  -- All entries removed (or the parent transaction was deleted): nothing to check.
  if v_count = 0 then
    return null;
  end if;

  if v_count < 2 then
    raise exception
      'transaction % has only % entry; a transaction needs at least two', v_txn, v_count
      using errcode = 'check_violation';
  end if;

  if v_sum <> 0 then
    raise exception
      'transaction % does not balance: entries sum to % centavos, must be 0', v_txn, v_sum
      using errcode = 'check_violation';
  end if;

  return null;
end $$;

create constraint trigger entries_must_balance
  after insert or update or delete on entries
  deferrable initially deferred
  for each row execute function assert_txn_balanced();

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Signed ledger balance, plus a display balance that flips sign for accounts
-- normally carrying a credit balance. A credit card you owe ₱1,000 on has a
-- ledger balance of -100000 and a display balance of +100000 ("you owe this").
create view account_balances as
select a.id                                        as account_id,
       a.user_id,
       a.name,
       a.role,
       a.kind,
       coalesce(sum(e.base_amount_minor), 0)::bigint as balance_minor,
       case when a.role in ('liability', 'income', 'equity')
            then -coalesce(sum(e.base_amount_minor), 0)
            else  coalesce(sum(e.base_amount_minor), 0)
       end::bigint                                  as display_balance_minor
  from accounts a
  left join entries e on e.account_id = a.id
 group by a.id;

-- Spend per category. Reads only the expense entries, so a split transaction
-- contributes your share and nothing more.
create view category_spend as
select a.id   as category_id,
       a.user_id,
       a.name as category,
       t.occurred_at,
       sum(e.base_amount_minor)::bigint as spent_minor
  from entries e
  join accounts a     on a.id = e.account_id
  join transactions t on t.id = e.transaction_id
 where a.role = 'expense'
   and t.status <> 'duplicate_merged'
 group by a.id, a.user_id, a.name, t.occurred_at;

create table budgets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  account_id        uuid not null references accounts (id) on delete restrict,
  amount_minor      bigint not null,
  currency          char(3) not null default 'PHP',
  rollover_enabled  boolean not null default false,
  starts_on         date not null,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),

  constraint budget_amount_positive check (amount_minor > 0),
  constraint budget_starts_on_first_of_month check (extract(day from starts_on) = 1)
);

-- Only one live budget per category at a time. Archive and create a new one to change history.
create unique index budgets_user_account_active_idx on budgets (user_id, account_id)
  where archived_at is null;
