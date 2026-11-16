import { describe, it, expect } from "vitest";
import { noteFooter, type NoteFooterInput } from "../index";

const idle: NoteFooterInput = {
  savedBody: null,
  draft: "",
  isSaving: false,
  error: undefined,
};

describe("noteFooter", () => {
  it("is empty, with Save off, before the Student writes anything", () => {
    expect(noteFooter(idle)).toEqual({
      status: { kind: "empty" },
      count: "0 / 2,000",
      overLimit: false,
      canSave: false,
    });
  });

  it("flags a first draft as unsaved and lets the Student save it", () => {
    const footer = noteFooter({ ...idle, draft: "Rewatch at 4:20" });
    expect(footer.status).toEqual({ kind: "unsaved" });
    expect(footer.canSave).toBe(true);
  });

  it("is saved, with Save off, when the draft matches the saved Note", () => {
    const footer = noteFooter({
      ...idle,
      savedBody: "Rewatch at 4:20",
      draft: "Rewatch at 4:20",
    });
    expect(footer.status).toEqual({ kind: "saved" });
    expect(footer.canSave).toBe(false);
  });

  it("does not count whitespace at the ends as a change, because the server trims it", () => {
    const footer = noteFooter({
      ...idle,
      savedBody: "Rewatch at 4:20",
      draft: "  Rewatch at 4:20\n",
    });
    expect(footer.status).toEqual({ kind: "saved" });
    expect(footer.count).toBe("15 / 2,000");
  });

  it("flags an edit to a saved Note as unsaved", () => {
    const footer = noteFooter({
      ...idle,
      savedBody: "Rewatch at 4:20",
      draft: "Rewatch at 4:30",
    });
    expect(footer.status).toEqual({ kind: "unsaved" });
    expect(footer.canSave).toBe(true);
  });

  it("will not save a draft cleared down to whitespace", () => {
    const footer = noteFooter({ ...idle, savedBody: "Old", draft: "   " });
    expect(footer.status).toEqual({ kind: "unsaved" });
    expect(footer.canSave).toBe(false);
  });

  it("shows saving, with Save off, while the save is in flight", () => {
    const footer = noteFooter({ ...idle, draft: "Rewatch", isSaving: true });
    expect(footer.status).toEqual({ kind: "saving" });
    expect(footer.canSave).toBe(false);
  });

  it("shows the save error and still lets the Student retry", () => {
    const footer = noteFooter({
      ...idle,
      draft: "Rewatch",
      error: "Something went wrong",
    });
    expect(footer.status).toEqual({
      kind: "error",
      message: "Something went wrong",
    });
    expect(footer.canSave).toBe(true);
  });

  it("accepts exactly 2,000 characters", () => {
    const footer = noteFooter({ ...idle, draft: "a".repeat(2000) });
    expect(footer).toMatchObject({
      count: "2,000 / 2,000",
      overLimit: false,
      canSave: true,
    });
  });

  it("is over the limit, with Save off, past 2,000 characters", () => {
    const footer = noteFooter({ ...idle, draft: "a".repeat(2001) });
    expect(footer).toMatchObject({
      count: "2,001 / 2,000",
      overLimit: true,
      canSave: false,
    });
  });
});
