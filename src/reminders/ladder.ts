export type ReminderRung = "t_minus_5" | "t_minus_1" | "due" | "overdue";

function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("date must be YYYY-MM-DD");
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return Date.UTC(year, month - 1, day);
}

/** Determines today's one daily reminder rung without consulting the wall clock. */
export function rungForDate(nextDueOn: string, today: string): ReminderRung | null {
  const daysUntilDue = (dateValue(nextDueOn) - dateValue(today)) / 86_400_000;
  if (daysUntilDue === 5) return "t_minus_5";
  if (daysUntilDue === 1) return "t_minus_1";
  if (daysUntilDue === 0) return "due";
  return daysUntilDue < 0 ? "overdue" : null;
}
