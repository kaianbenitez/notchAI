// Statement-cycle math, harvested from cc-tracker app.js @ 0542fd1.
// De-globalized: the originals read a module-level `state`; here every dependency is a
// parameter. Behaviour is otherwise unchanged.
//
// Card shape: { id, statementDay: number|null, dueDay: number|null }
// Txn shape:  { cardId, date: "YYYY-MM-DD", statementEnd: "YYYY-MM-DD"|null }
//
// Dates are handled as "YYYY-MM-DD" strings and compared with plain string comparison,
// which is correct for that format. Date objects are built at T12:00:00 to stay clear of
// DST edges. Keep both habits when porting.

export function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const lastDayOfMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();

/**
 * Which statement a charge falls into, from the card's cutoff day alone.
 *
 * NOTE the fallback: when `statementDay` is null it returns the last day of the charge's
 * calendar month — i.e. it silently degrades to calendar-month budgeting. All four real
 * cards have `statementDay: null` (see cc-tracker-config.md), so in practice this fallback
 * *is* the behaviour. Decide deliberately whether M1 keeps that or forces a real cutoff day.
 */
export function inferStatementEnd(card, transactionDate) {
  if (!transactionDate) return null;
  const date = new Date(`${transactionDate}T12:00:00`);
  const statementDay = Number(card?.statementDay);

  if (!statementDay) {
    const y = date.getFullYear();
    const m = date.getMonth();
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
  }

  let targetYear = date.getFullYear();
  let targetMonth = date.getMonth();
  let end = new Date(targetYear, targetMonth, Math.min(statementDay, lastDayOfMonth(targetYear, targetMonth)), 12);
  if (date > end) {
    targetMonth += 1;
    if (targetMonth > 11) { targetMonth = 0; targetYear += 1; }
    end = new Date(targetYear, targetMonth, Math.min(statementDay, lastDayOfMonth(targetYear, targetMonth)), 12);
  }
  return isoDate(end);
}

/**
 * The [start, end] date range of one statement cycle.
 *
 * Three strategies, in order — this ordering is the useful idea:
 *   1. Previous known statement end for this card, + 1 day. Observed data beats arithmetic.
 *   2. Earliest transaction already assigned to this cycle.
 *   3. Arithmetic from `statementDay`, one month back.
 *
 * Strategy 1 is what makes it survive a card whose cutoff day drifts.
 */
export function statementCycleRange(card, endDate, txns = []) {
  const end = new Date(`${endDate}T12:00:00`);

  if (card?.id) {
    const endMonth = endDate.slice(0, 7);
    const olderEnd = statementEndsForCard(card.id, txns)
      .filter(date => date < endDate && date.slice(0, 7) !== endMonth)
      .sort()
      .pop();
    if (olderEnd) {
      const start = new Date(`${olderEnd}T12:00:00`);
      start.setDate(start.getDate() + 1);
      return { start: isoDate(start), end: endDate };
    }

    const observedDates = txns
      .filter(tx => tx.cardId === card.id && tx.statementEnd === endDate && tx.date)
      .map(tx => tx.date)
      .sort();
    if (observedDates.length) return { start: observedDates[0], end: endDate };
  }

  const statementDay = Number(card?.statementDay) || end.getDate();
  let previousYear = end.getFullYear();
  let previousMonth = end.getMonth() - 1;
  if (previousMonth < 0) { previousMonth = 11; previousYear -= 1; }
  const previousEnd = new Date(previousYear, previousMonth, Math.min(statementDay, lastDayOfMonth(previousYear, previousMonth)));
  const start = new Date(previousEnd);
  start.setDate(start.getDate() + 1);
  return { start: isoDate(start), end: endDate };
}

/** Known statement end dates for a card, newest first. */
export function statementEndsForCard(cardId, txns = []) {
  const ends = txns.filter(tx => tx.cardId === cardId && tx.statementEnd).map(tx => tx.statementEnd);
  return [...new Set(ends)].sort().reverse();
}

/** Charges not yet assigned to a statement — the "unbilled" bucket (PLAN.md §6.1 Layer 2). */
export function unbilledTransactions(cardId, txns = []) {
  return txns.filter(tx => tx.cardId === cardId && !tx.statementEnd);
}

/** Find an existing cycle whose range contains this date. Range containment, not arithmetic. */
export function detectStatementEnd(card, transactionDate, txns = []) {
  if (!card?.id || !transactionDate) return null;
  return statementEndsForCard(card.id, txns).find(endDate => {
    const range = statementCycleRange(card, endDate, txns);
    return transactionDate >= range.start && transactionDate <= range.end;
  }) || null;
}

/** Assign every unbilled charge to a cycle where one can be detected. Mutates. Returns count. */
export function autoAssignUnbilledTransactions(txns, cardsById, cardId = null) {
  let assigned = 0;
  txns.forEach(tx => {
    if (tx.statementEnd || (cardId && tx.cardId !== cardId)) return;
    const detectedEnd = detectStatementEnd(cardsById.get(tx.cardId), tx.date, txns);
    if (!detectedEnd) return;
    tx.statementEnd = detectedEnd;
    assigned++;
  });
  return assigned;
}

/**
 * Re-derive assignments after a card's `statementDay` changes. Mutates. Returns count.
 *
 * CAUTION when porting: this overwrites `statementEnd` from arithmetic alone, so it will
 * happily overwrite an assignment that came from an actual statement import. The old app
 * guarded that with a separate `statementLocked` flag set at import time (see
 * statement-parse.js) — but this function never checks it. That is a real bug. In the new
 * app, a confirmed statement row must outrank inferred placement (PLAN.md §6.1,
 * "Statement always wins on conflict").
 */
export function repairStatementAssignments(txns, cardsById, cardId = null) {
  let repaired = 0;
  txns.forEach(tx => {
    if (cardId && tx.cardId !== cardId) return;
    const card = cardsById.get(tx.cardId);
    if (!card?.statementDay || !tx.date || !tx.statementEnd) return;
    const expectedEnd = inferStatementEnd(card, tx.date);
    if (tx.statementEnd === expectedEnd) return;
    tx.statementEnd = expectedEnd;
    repaired++;
  });
  return repaired;
}

/**
 * When the bill for a closed statement is actually due.
 * `due <= end` rolls to the next month — a due day of 12 against a cycle ending the 20th
 * means the 12th of the *following* month. Returns a Date.
 */
export function statementDueDate(card, statementEnd) {
  if (!card?.dueDay || !statementEnd) return null;
  const end = new Date(`${statementEnd}T12:00:00`);
  let due = new Date(end.getFullYear(), end.getMonth(), Math.min(card.dueDay, lastDayOfMonth(end.getFullYear(), end.getMonth())));
  if (due <= end) {
    let dueYear = end.getFullYear();
    let dueMonth = end.getMonth() + 1;
    if (dueMonth > 11) { dueMonth = 0; dueYear += 1; }
    due = new Date(dueYear, dueMonth, Math.min(card.dueDay, lastDayOfMonth(dueYear, dueMonth)));
  }
  return due;
}

// --- Recurring bills (PLAN.md M3) ---------------------------------------------------
// The old app's whole recurrence model. It is monthly/quarterly/yearly from a start month
// and nothing else — no RRULE, no weekly, no "last business day". PLAN.md §3 specifies
// RRULE in `recurring_rules`; this is here to show the cases that actually occurred in
// practice, which is a smaller set than RRULE implies.

/** Clamps the due day to the month's length, so dueDay 31 lands on Feb 28/29. */
export function billDueDate(bill, monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const day = Math.min(Number(bill.dueDay) || 1, new Date(year, month, 0).getDate());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function billIsScheduledForMonth(bill, monthKey) {
  const start = bill.startMonth || monthKey;
  if (monthKey < start) return false;
  const [startYear, startMonth] = start.split("-").map(Number);
  const [year, month] = monthKey.split("-").map(Number);
  const diff = (year - startYear) * 12 + (month - startMonth);
  const cadence = { monthly: 1, quarterly: 3, yearly: 12 }[bill.frequency] || 1;
  return diff >= 0 && diff % cadence === 0;
}

export function nextBillDueDate(bill, monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  for (let offset = 0; offset < 120; offset++) {
    const date = new Date(year, month - 1 + offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (billIsScheduledForMonth(bill, key)) return billDueDate(bill, key);
  }
  return billDueDate(bill, monthKey);
}
