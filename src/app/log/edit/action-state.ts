export interface EditActionState {
  error: string | null;
  ok: boolean;
}

export const EMPTY_EDIT_STATE: EditActionState = { error: null, ok: false };
