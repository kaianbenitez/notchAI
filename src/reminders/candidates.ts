import type { Sql } from "../ledger/post";
import type { RecurrencePreset } from "./recurrence";

export interface RecurringBillCandidate {
  fingerprint: string;
  name: string;
  amountMinor: number;
  accountId: string;
  categoryId: string | null;
  recurrencePreset: RecurrencePreset;
  nextDueOn: string;
}

interface CandidateRow {
  transaction_id: string; payee: string; account_id: string; amount_minor: number | string;
  occurred_at: string | Date; category_id: string | null;
}

function isoDate(value: string | Date): string { return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10); }
function dateAt(value: string): Date { return new Date(`${value}T00:00:00Z`); }
function addDays(value: string, days: number): string { const date = dateAt(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
function minorFromDb(value: number | string): number {
  if (typeof value === "number") return value;
  let result = 0;
  for (const digit of value) { result = result * 10 + (digit.charCodeAt(0) - 48); }
  return result;
}
function fingerprint(payee: string, accountId: string): string { return `${accountId}:${payee.trim().replace(/\s+/g, " ").toLocaleLowerCase()}`; }

function cadence(dates: string[]): RecurrencePreset | null {
  const intervals = dates.slice(1).map((date, index) => Math.round((dateAt(date).getTime() - dateAt(dates[index]).getTime()) / 86_400_000));
  if (intervals.every((days) => days >= 28 && days <= 31)) {
    const day = Number(dates.at(-1)!.slice(8));
    return day <= 28 ? `monthly:${day}` : null;
  }
  const last = dateAt(dates.at(-1)!);
  const weekday = (["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const)[last.getUTCDay()];
  if (intervals.every((days) => days >= 6 && days <= 8)) return `weekly:${weekday}`;
  if (intervals.every((days) => days >= 13 && days <= 15)) return `biweekly:${weekday}`;
  return null;
}

function nextDueOn(latest: string, preset: RecurrencePreset): string {
  if (preset.startsWith("weekly:")) return addDays(latest, 7);
  if (preset.startsWith("biweekly:")) return addDays(latest, 14);
  const date = dateAt(latest); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, Number(preset.slice(8)))).toISOString().slice(0, 10);
}

/** Find repeated funding-account expenses that are suitable for bill promotion. */
export async function detectRecurringBillCandidates(sql: Sql, userId: string): Promise<RecurringBillCandidate[]> {
  const { rows } = await sql.query<CandidateRow>(
    `select t.id as transaction_id, t.payee, funding.account_id, abs(funding.amount_minor)::bigint as amount_minor,
            t.occurred_at, category.category_id
       from transactions t
       join entries funding on funding.transaction_id = t.id and funding.amount_minor < 0
       join accounts funding_account on funding_account.id = funding.account_id
       left join lateral (
         select e.account_id as category_id from entries e join accounts a on a.id = e.account_id
          where e.transaction_id = t.id and e.amount_minor > 0 and a.role = 'expense' and a.kind = 'category'
          order by e.amount_minor desc, e.account_id limit 1
       ) category on true
      where t.user_id = $1 and t.status <> 'duplicate_merged' and nullif(btrim(t.payee), '') is not null
        and funding_account.role in ('asset', 'liability')
      order by t.payee, funding.account_id, t.occurred_at, t.id`, [userId],
  );
  const { rows: rules } = await sql.query<{ name: string; account_id: string }>("select name, account_id from recurring_rules where user_id = $1 and archived_at is null", [userId]);
  const { rows: dismissed } = await sql.query<{ fingerprint: string }>("select fingerprint from dismissed_bill_suggestions where user_id = $1", [userId]);
  const dismissedSet = new Set(dismissed.map((row) => row.fingerprint));
  const groups = new Map<string, CandidateRow[]>();
  for (const row of rows) { const key = fingerprint(row.payee, row.account_id); groups.set(key, [...(groups.get(key) ?? []), row]); }
  const candidates: RecurringBillCandidate[] = [];
  for (const [key, group] of groups) {
    if (group.length < 3 || dismissedSet.has(key)) continue;
    if (rules.some((rule) => rule.account_id === group[0].account_id && rule.name.trim().replace(/\s+/g, " ").toLocaleLowerCase() === key.slice(key.indexOf(":") + 1))) continue;
    const amounts = group.map((row) => minorFromDb(row.amount_minor)); const suggestedAmount = median(amounts);
    const matches = group.filter((row) => Math.abs(minorFromDb(row.amount_minor) - suggestedAmount) * 100 <= suggestedAmount * 5);
    if (matches.length < 3) continue;
    const dates = matches.map((row) => isoDate(row.occurred_at)); const preset = cadence(dates);
    if (!preset) continue;
    const categoryIds = matches.map((row) => row.category_id).filter((id): id is string => id !== null);
    const categoryId = categoryIds.length === matches.length && categoryIds.every((id) => id === categoryIds[0]) ? categoryIds[0] : null;
    candidates.push({ fingerprint: key, name: matches[0].payee.trim().replace(/\s+/g, " "), amountMinor: suggestedAmount, accountId: matches[0].account_id, categoryId, recurrencePreset: preset, nextDueOn: nextDueOn(dates.at(-1)!, preset) });
  }
  return candidates;
}

export async function dismissRecurringBillCandidate(sql: Sql, userId: string, candidateFingerprint: string): Promise<void> {
  await sql.query("insert into dismissed_bill_suggestions (user_id, fingerprint) values ($1, $2) on conflict do nothing", [userId, candidateFingerprint]);
}
