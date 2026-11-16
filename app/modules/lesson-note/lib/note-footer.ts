import { MAX_NOTE_LENGTH } from "~/lib/notes";

export type NoteFooterInput = {
  /** The body last saved, or null when the Student has no Note yet. */
  savedBody: string | null;
  draft: string;
  isSaving: boolean;
  /** The error from the last save, if it failed. */
  error: string | undefined;
};

export type NoteStatus =
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "unsaved" }
  | { kind: "saved" }
  | { kind: "empty" };

export type NoteFooter = {
  status: NoteStatus;
  /** e.g. "120 / 2,000" */
  count: string;
  overLimit: boolean;
  canSave: boolean;
};

function statusOf(
  { savedBody, isSaving, error }: NoteFooterInput,
  changed: boolean
): NoteStatus {
  if (isSaving) return { kind: "saving" };
  if (error) return { kind: "error", message: error };
  if (changed) return { kind: "unsaved" };
  return savedBody === null ? { kind: "empty" } : { kind: "saved" };
}

/** What the footer under the Note editor says, and whether Save is live. */
export function noteFooter(input: NoteFooterInput): NoteFooter {
  const draft = input.draft.trim();
  // The server saves the body trimmed, so whitespace at the ends of the
  // draft is not a change.
  const changed = draft !== (input.savedBody ?? "");
  const overLimit = draft.length > MAX_NOTE_LENGTH;
  return {
    status: statusOf(input, changed),
    count: `${draft.length.toLocaleString("en")} / ${MAX_NOTE_LENGTH.toLocaleString("en")}`,
    overLimit,
    canSave: changed && draft.length > 0 && !overLimit && !input.isSaving,
  };
}
