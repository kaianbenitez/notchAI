import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";

export interface RawCaptureGuess {
  payee: string | null;
  amountText: string | null;
  occurredAt: string | null;
  categoryGuess: string | null;
  confidence: number;
}

export interface CaptureDraft {
  payee: string;
  amount: string;
  occurredAt: string;
  categoryId: string;
  confidence: number;
}

const CATEGORY_CONFIDENCE_THRESHOLD = 0.7;

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

export function matchCategory(
  guess: string | null,
  categories: { id: string; name: string }[],
): { id: string; name: string } | null {
  if (!guess?.trim()) return null;
  const target = normalise(guess);
  const exact = categories.find((category) => normalise(category.name) === target);
  if (exact) return exact;
  return categories.find((category) => {
    const name = normalise(category.name);
    return name.includes(target) || target.includes(name);
  }) ?? null;
}

function validAmount(value: string | null): value is string {
  return value !== null && /^\d+(?:\.\d{1,2})?$/.test(value.trim());
}

function validDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function buildCaptureDraft(
  raw: RawCaptureGuess,
  categories: { id: string; name: string }[],
  today: string,
): CaptureDraft {
  const category = matchCategory(raw.categoryGuess, categories);
  const confidence = Math.min(1, Math.max(0, Number.isFinite(raw.confidence) ? raw.confidence : 0));
  return {
    payee: raw.payee?.trim() ?? "",
    amount: validAmount(raw.amountText) ? raw.amountText.trim() : "",
    occurredAt: validDate(raw.occurredAt) ? raw.occurredAt : today,
    categoryId: confidence >= CATEGORY_CONFIDENCE_THRESHOLD ? category?.id ?? "" : "",
    confidence,
  };
}

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    payee: { type: SchemaType.STRING, nullable: true },
    amountText: { type: SchemaType.STRING, nullable: true },
    occurredAt: { type: SchemaType.STRING, nullable: true },
    categoryGuess: { type: SchemaType.STRING, nullable: true },
    confidence: { type: SchemaType.NUMBER },
  },
  required: ["payee", "amountText", "occurredAt", "categoryGuess", "confidence"],
};

export async function callGeminiForCapture(input: {
  imageBase64?: string;
  imageMimeType?: string;
  text?: string;
}): Promise<RawCaptureGuess> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI capture is not configured. Add GEMINI_API_KEY to the server environment.");
  if (!input.imageBase64 && !input.text?.trim()) throw new Error("Add a receipt photo or a short description first.");

  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-flash-latest",
    generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  });
  const prompt = "Read this personal expense capture. Return only the requested JSON: payee or merchant; amountText as a plain decimal PHP peso string (for example 340.00); occurredAt as YYYY-MM-DD only if present; categoryGuess as one or two words; and confidence from 0 to 1. Use null for information that is absent or unclear.";
  const parts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [{ text: prompt }];
  if (input.text?.trim()) parts.push({ text: `Description: ${input.text.trim()}` });
  if (input.imageBase64) parts.push({ inlineData: { data: input.imageBase64, mimeType: input.imageMimeType || "image/jpeg" } });

  const response = await model.generateContent(parts);
  const parsed: unknown = JSON.parse(response.response.text());
  if (!parsed || typeof parsed !== "object") throw new Error("The AI response was not a capture draft.");
  const value = parsed as Partial<RawCaptureGuess>;
  return {
    payee: typeof value.payee === "string" ? value.payee : null,
    amountText: typeof value.amountText === "string" ? value.amountText : null,
    occurredAt: typeof value.occurredAt === "string" ? value.occurredAt : null,
    categoryGuess: typeof value.categoryGuess === "string" ? value.categoryGuess : null,
    confidence: typeof value.confidence === "number" ? value.confidence : 0,
  };
}
