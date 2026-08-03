/**
 * Split arithmetic. Pure functions, no database.
 *
 * The whole point is that money never appears or disappears: every split of N
 * centavos returns parts summing to exactly N. Percentage and equal splits both
 * produce remainders, and "round each part and hope" loses or invents centavos.
 */

export type Share = { personAccountId: string; shareMinor: number };

function assertInt(n: number, label: string): void {
  if (!Number.isInteger(n)) {
    throw new Error(`${label} must be an integer number of centavos, got ${n}`);
  }
}

/**
 * Divide `totalMinor` into `ways` parts summing to exactly `totalMinor`.
 * The remainder is distributed one centavo at a time from the front, so
 * ₱1,000 three ways is [333.34, 333.33, 333.33].
 */
export function splitEqual(totalMinor: number, ways: number): number[] {
  assertInt(totalMinor, "total");
  if (!Number.isInteger(ways) || ways <= 0) {
    throw new Error(`ways must be a positive integer, got ${ways}`);
  }

  const base = Math.trunc(totalMinor / ways);
  const remainder = totalMinor - base * ways; // same sign as totalMinor
  const step = Math.sign(remainder);

  return Array.from(
    { length: ways },
    (_, i) => base + (i < Math.abs(remainder) ? step : 0),
  );
}

/**
 * Divide by weights (percentages, shares, "he ate twice as much").
 * Largest-remainder method: floor every part, then hand out the leftover
 * centavos to whoever was rounded down hardest. Sums to exactly `totalMinor`.
 */
export function splitByWeights(totalMinor: number, weights: number[]): number[] {
  assertInt(totalMinor, "total");
  if (weights.length === 0) throw new Error("need at least one weight");
  if (weights.some((w) => w < 0)) throw new Error("weights cannot be negative");

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) throw new Error("weights must sum to more than zero");

  const exact = weights.map((w) => (totalMinor * w) / totalWeight);
  const parts = exact.map((x) => Math.floor(x));
  let leftover = totalMinor - parts.reduce((s, p) => s + p, 0);

  const byRemainder = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; leftover > 0; k++, leftover--) {
    parts[byRemainder[k % byRemainder.length].i] += 1;
  }
  return parts;
}

export type EntryDraft = { accountId: string; amountMinor: number };

/**
 * An expense you paid for, partly on behalf of other people.
 *
 * ₱1,000 dinner on your card, split 50/50 with Ana:
 *   card      -100000
 *   dining     +50000   <- only your share reaches the budget
 *   Ana        +50000   <- she owes you this
 *
 * Your share is whatever is left after the others' shares, so it absorbs any
 * rounding and the entries always balance.
 */
export function buildSplitExpense(input: {
  paidFromAccountId: string;
  categoryAccountId: string;
  totalMinor: number;
  shares?: Share[];
}): EntryDraft[] {
  const { paidFromAccountId, categoryAccountId, totalMinor, shares = [] } = input;
  assertInt(totalMinor, "total");
  if (totalMinor <= 0) throw new Error("expense total must be positive");

  const othersTotal = shares.reduce((s, o) => s + o.shareMinor, 0);
  const yourShare = totalMinor - othersTotal;
  if (yourShare < 0) {
    throw new Error(
      `shares (${othersTotal}) exceed the total (${totalMinor})`,
    );
  }

  return [
    { accountId: paidFromAccountId, amountMinor: -totalMinor },
    ...(yourShare !== 0
      ? [{ accountId: categoryAccountId, amountMinor: yourShare }]
      : []),
    ...shares
      .filter((o) => o.shareMinor !== 0)
      .map((o) => ({ accountId: o.personAccountId, amountMinor: o.shareMinor })),
  ];
}

/**
 * Someone else paid and you owe them. No account of yours is touched — you
 * take on a payable instead.
 *
 *   dining    +40000
 *   Ana       -40000   <- you owe her
 */
export function buildOwedExpense(input: {
  categoryAccountId: string;
  personAccountId: string;
  yourShareMinor: number;
}): EntryDraft[] {
  assertInt(input.yourShareMinor, "share");
  if (input.yourShareMinor <= 0) throw new Error("your share must be positive");
  return [
    { accountId: input.categoryAccountId, amountMinor: input.yourShareMinor },
    { accountId: input.personAccountId, amountMinor: -input.yourShareMinor },
  ];
}

/**
 * Settling up: money moves, no expense is recorded. Positive `amountMinor`
 * means they paid you.
 */
export function buildSettlement(input: {
  cashAccountId: string;
  personAccountId: string;
  amountMinor: number;
}): EntryDraft[] {
  assertInt(input.amountMinor, "amount");
  if (input.amountMinor === 0) throw new Error("settlement cannot be zero");
  return [
    { accountId: input.cashAccountId, amountMinor: input.amountMinor },
    { accountId: input.personAccountId, amountMinor: -input.amountMinor },
  ];
}

/**
 * Minimum cash flow: settle a group's tangled balances in as few transfers as
 * possible. Input is net position per person (positive = owed money).
 */
export function simplifyDebts(
  balances: { personId: string; balanceMinor: number }[],
): { fromPersonId: string; toPersonId: string; amountMinor: number }[] {
  const sum = balances.reduce((s, b) => s + b.balanceMinor, 0);
  if (sum !== 0) throw new Error(`balances must net to zero, got ${sum}`);

  const debtors = balances
    .filter((b) => b.balanceMinor < 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => a.balanceMinor - b.balanceMinor);
  const creditors = balances
    .filter((b) => b.balanceMinor > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.balanceMinor - a.balanceMinor);

  const transfers: { fromPersonId: string; toPersonId: string; amountMinor: number }[] = [];
  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(-debtors[d].balanceMinor, creditors[c].balanceMinor);
    transfers.push({
      fromPersonId: debtors[d].personId,
      toPersonId: creditors[c].personId,
      amountMinor: amount,
    });
    debtors[d].balanceMinor += amount;
    creditors[c].balanceMinor -= amount;
    if (debtors[d].balanceMinor === 0) d++;
    if (creditors[c].balanceMinor === 0) c++;
  }
  return transfers;
}
