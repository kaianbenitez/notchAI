import { parseAmountToMinor } from "../../money";

export type ParsedGmailTransaction = {
  occurredAt: string; payee: string; accountDescriptor: string; amountMinor: number;
  direction: "out" | "in"; sourceRef: string; memo: string;
};

export type GmailMessage = { id: string; from: string; subject: string; body: string };

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

export function normalizeDescriptor(value: string): string { return value.trim().replace(/\s+/g, " ").toLowerCase(); }

function text(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:td|th|tr|p|div|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\r/g, "").replace(/[ \t]+/g, " ");
}

function details(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => text(cell[1]).trim());
    if (cells.length >= 2) out[normalizeDescriptor(cells[0])] = cells.slice(1).join(" ").trim();
  }
  return out;
}

function dateFromBpi(value: string): string | null {
  const match = value.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/i);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  return month ? `${match[3]}-${month}-${match[2].padStart(2, "0")}` : null;
}

function dateFromMari(value: string): string | null {
  const match = value.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/i);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  return month ? `${match[3]}-${month}-${match[1].padStart(2, "0")}` : null;
}

function complete(input: Partial<ParsedGmailTransaction>): ParsedGmailTransaction | null {
  return input.occurredAt && input.payee && input.accountDescriptor && input.amountMinor && input.direction && input.sourceRef && input.memo
    ? input as ParsedGmailTransaction : null;
}

export function parseBpiInstaPay(message: GmailMessage): ParsedGmailTransaction | null {
  if (!/interbank funds transfer confirmation/i.test(message.subject)) return null;
  const row = details(message.body);
  const occurredAt = dateFromBpi(row["transaction date and time"] ?? "");
  const amount = row["transfer amount"];
  const reference = row["confirmation number"] ?? row["transaction ref no."];
  if (!occurredAt || !amount || !reference) return null;
  try { return complete({ occurredAt, payee: row["transfer to"] ?? "", accountDescriptor: row["transfer from"] ?? "", amountMinor: parseAmountToMinor(amount), direction: "out", sourceRef: `bpi-instapay:${reference}`, memo: row.notes ?? row["bank name"] ?? "BPI InstaPay" }); } catch { return null; }
}

export function parseBpiBills(message: GmailMessage): ParsedGmailTransaction | null {
  if (!/^bills payment confirmation to\s+.+/i.test(message.subject)) return null;
  const row = details(message.body);
  const occurredAt = dateFromBpi(row["transaction date and time"] ?? "");
  const amount = row.amount;
  const reference = row["confirmation number"] ?? row["merchant reference number"];
  if (!occurredAt || !amount || !reference) return null;
  try { return complete({ occurredAt, payee: row["pay to"] ?? "", accountDescriptor: row["pay from"] ?? "", amountMinor: parseAmountToMinor(amount), direction: "out", sourceRef: `bpi-bill:${reference}`, memo: row.notes ?? "BPI bill payment" }); } catch { return null; }
}

export function parseMariBankTransfer(message: GmailMessage): ParsedGmailTransaction | null {
  if (message.subject.trim() !== "MariBank Transfer Notification") return null;
  const body = text(message.body);
  const line = (label: string) => body.match(new RegExp(`${label}:\\s*([^\\n]+)`, "i"))?.[1]?.trim() ?? "";
  const occurredAt = dateFromMari(line("transaction time"));
  const amount = line("transfer amount");
  const reference = line("reference no");
  if (!occurredAt || !amount || !reference) return null;
  try { return complete({ occurredAt, payee: line("transfer from"), accountDescriptor: line("transfer to"), amountMinor: parseAmountToMinor(amount), direction: "in", sourceRef: `maribank:${reference}`, memo: "MariBank incoming transfer" }); } catch { return null; }
}

export function dispatchGmail(message: GmailMessage): ParsedGmailTransaction | null {
  const from = message.from.toLowerCase();
  if (from.includes("onlinebanking@bpi.com.ph")) return parseBpiInstaPay(message) ?? parseBpiBills(message);
  if (from.includes("alerts@maribank.com.ph")) return parseMariBankTransfer(message);
  return null; // bpiinstapay is intentionally retained raw until a fixture exists.
}
