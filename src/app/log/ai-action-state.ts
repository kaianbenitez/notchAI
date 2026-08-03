import type { CaptureDraft } from "../../capture/ai-parse";

export interface ParseState {
  error: string | null;
  draft: CaptureDraft | null;
}

export const EMPTY_PARSE_STATE: ParseState = { error: null, draft: null };
