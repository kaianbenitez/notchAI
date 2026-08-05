export type RecurrencePreset =
  | `monthly:${number}`
  | `weekly:${Weekday}`
  | `biweekly:${Weekday}`;

type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

const WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export class RecurrenceError extends Error {
  constructor(message: string) { super(message); this.name = "RecurrenceError"; }
}

function parseDate(value: string): Date {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) throw new RecurrenceError("date must be YYYY-MM-DD");
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new RecurrenceError("date is not a real calendar day");
  return date;
}

function formatDate(date: Date): string { return date.toISOString().slice(0, 10); }

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime()); copy.setUTCDate(copy.getUTCDate() + days); return copy;
}

export function recurrencePresetToRrule(preset: string): string {
  const monthly = /^monthly:(\d+)$/.exec(preset);
  if (monthly) {
    const day = Number(monthly[1]);
    if (day >= 1 && day <= 28) return `FREQ=MONTHLY;BYMONTHDAY=${day}`;
  }
  const weekly = /^weekly:(MO|TU|WE|TH|FR|SA|SU)$/.exec(preset);
  if (weekly) return `FREQ=WEEKLY;BYDAY=${weekly[1]}`;
  const biweekly = /^biweekly:(MO|TU|WE|TH|FR|SA|SU)$/.exec(preset);
  if (biweekly) return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${biweekly[1]}`;
  throw new RecurrenceError("choose a supported monthly, weekly, or biweekly recurrence");
}

export function rruleToRecurrencePreset(rrule: string): RecurrencePreset {
  const monthly = /^FREQ=MONTHLY;BYMONTHDAY=(\d+)$/.exec(rrule);
  if (monthly) {
    const day = Number(monthly[1]);
    if (day >= 1 && day <= 28) return `monthly:${day}` as RecurrencePreset;
  }
  const weekly = /^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)$/.exec(rrule);
  if (weekly) return `weekly:${weekly[1]}` as RecurrencePreset;
  const biweekly = /^FREQ=WEEKLY;INTERVAL=2;BYDAY=(MO|TU|WE|TH|FR|SA|SU)$/.exec(rrule);
  if (biweekly) return `biweekly:${biweekly[1]}` as RecurrencePreset;
  throw new RecurrenceError("rule has an unsupported recurrence");
}

/** Return the first supported recurrence occurrence strictly after nextDueOn. */
export function nextOccurrence(rrule: string, nextDueOn: string): string {
  const current = parseDate(nextDueOn);
  const preset = rruleToRecurrencePreset(rrule);
  if (preset.startsWith("monthly:")) {
    const day = Number(preset.slice("monthly:".length));
    if (day < 1 || day > 28) throw new RecurrenceError("monthly day must be between 1 and 28");
    return formatDate(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, day)));
  }
  const weekday = preset.slice(preset.indexOf(":") + 1) as Weekday;
  const target = WEEKDAYS.indexOf(weekday);
  const delta = (target - current.getUTCDay() + 7) % 7 || 7;
  return formatDate(addDays(current, preset.startsWith("biweekly:") ? 14 : delta));
}
