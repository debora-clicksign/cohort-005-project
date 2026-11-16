import { z } from "zod";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

export const createCommentSchema = z.object({
  intent: z.literal("create-comment"),
  body: z.string(),
  parentId: z.coerce.number().int().optional(),
});

export const editCommentSchema = z.object({
  intent: z.literal("edit-comment"),
  commentId: z.coerce.number().int(),
  body: z.string(),
});

export const saveNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write something before saving your note.")
    .max(
      MAX_NOTE_LENGTH,
      `Your note is over ${MAX_NOTE_LENGTH.toLocaleString("en")} characters, so it was not saved.`
    ),
});

export const deleteCommentSchema = z.object({
  intent: z.literal("delete-comment"),
  commentId: z.coerce.number().int(),
});
