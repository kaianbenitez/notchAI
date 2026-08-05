import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";

import { parseAmountToMinor } from "../money";

export interface RawStatementRow {
  occurredAt: string | null;
  payee: string | null;
  amountText: string | null;
  kind: string | null;
  categoryGuess: string | null;
  confidence: number;
}

export interface StatementRow {
  occurredAt: string;
  payee: string;
  amountText: string;
  amountMinor: number;
  kind: "charge" | "payment_or_credit";
  categoryGuess: string | null;
  confidence: number;
}

/** Coerce Gemini's parsed JSON into the permissive raw shape used for validation. */
export function coerceStatementRows(parsed: unknown): RawStatementRow[] {
  if (!Array.isArray(parsed)) throw new Error("not an array");
  return parsed.map((item): RawStatementRow => {
    const value = item && typeof item === "object" ? item as Partial<RawStatementRow> : {};
    return {
      occurredAt: typeof value.occurredAt === "string" ? value.occurredAt : null,
      payee: typeof value.payee === "string" ? value.payee : null,
      amountText: typeof value.amountText === "string" ? value.amountText : null,
      kind: typeof value.kind === "string" ? value.kind : null,
      categoryGuess: typeof value.categoryGuess === "string" ? value.categoryGuess : null,
      confidence: typeof value.confidence === "number" ? value.confidence : 0,
    };
  });
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** Validate model-shaped JSON without ever constructing a floating-point amount. */
export function normalizeStatementRow(raw: unknown): StatementRow | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<RawStatementRow>;
  const occurredAt = typeof value.occurredAt === "string" ? value.occurredAt.trim() : "";
  const payee = typeof value.payee === "string" ? value.payee.trim() : "";
  const amountText = typeof value.amountText === "string" ? value.amountText.trim() : "";
  const kind = value.kind === "charge" || value.kind === "payment_or_credit" ? value.kind : null;
  if (!validDate(occurredAt) || !payee || !kind) return null;

  let amountMinor: number;
  try {
    amountMinor = parseAmountToMinor(amountText);
  } catch {
    return null;
  }
  if (amountMinor <= 0) return null;

  return {
    occurredAt,
    payee,
    amountText,
    amountMinor,
    kind,
    categoryGuess: typeof value.categoryGuess === "string" && value.categoryGuess.trim() ? value.categoryGuess.trim() : null,
    confidence: typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? Math.min(1, Math.max(0, value.confidence))
      : 0,
  };
}

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      occurredAt: { type: SchemaType.STRING, nullable: true },
      payee: { type: SchemaType.STRING, nullable: true },
      amountText: { type: SchemaType.STRING, nullable: true },
      kind: { type: SchemaType.STRING, nullable: true, format: "enum", enum: ["charge", "payment_or_credit"] },
      categoryGuess: { type: SchemaType.STRING, nullable: true },
      confidence: { type: SchemaType.NUMBER },
    },
    required: ["occurredAt", "payee", "amountText", "kind", "categoryGuess", "confidence"],
  },
};

export async function callGeminiForStatement(text: string): Promise<RawStatementRow[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Statement extraction is not configured. Add GEMINI_API_KEY to the server environment.");
  if (!text.trim()) throw new Error("The statement did not contain readable text.");

  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  });
  const prompt = "Extract every transaction row from this Philippine credit-card statement. Return only the requested JSON array. occurredAt must be YYYY-MM-DD, payee is the merchant or description exactly as printed, amountText is the plain positive PHP peso amount. If foreign currency and a peso-converted figure both appear, use the PHP figure. kind is charge for a purchase, or payment_or_credit for a payment, refund, reversal, or credit. Give a short expense categoryGuess and confidence from 0 to 1 when possible. Skip headers, footers, summaries, balances, minimum due, interest disclosures, and every non-transaction line.\n\nStatement text:\n" + text;
  try {
    const response = await model.generateContent(prompt);
    const parsed: unknown = JSON.parse(response.response.text());
    return coerceStatementRows(parsed);
  } catch (error) {
    if (error instanceof Error && error.message === "not an array") {
      throw new Error("The AI did not return a statement row list. Try the statement again.");
    }
    throw new Error("Could not extract transaction rows from that statement. Try again.");
  }
}
