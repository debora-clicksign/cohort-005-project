import { useState } from "react";
import { useFetcher } from "react-router";
import { Lock, NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { cn, formatRelativeTime } from "~/lib/utils";
import { noteFooter, type NoteFooter } from "~/modules/lesson-note";

type SavedNote = { body: string; updatedAt: string };

/** Styled to match the Questions & Discussion card further down the page. */
export function LessonNote({ note }: { note: SavedNote | null }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [draft, setDraft] = useState(note?.body ?? "");
  const footer = noteFooter({
    savedBody: note?.body ?? null,
    draft,
    isSaving: fetcher.state !== "idle",
    error: fetcher.data?.error,
  });

  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <NotebookPen className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">Your notes</h2>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" />
            Only you can see these
          </span>
        </div>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save-note" />
          <Textarea
            name="body"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={footer.overLimit || footer.status.kind === "error"}
            placeholder="Jot down what you want to remember from this lesson..."
            className="min-h-32 resize-y"
          />
          <NoteFooterRow footer={footer} note={note} />
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function NoteFooterRow({
  footer: { status, count, overLimit, canSave },
  note,
}: {
  footer: NoteFooter;
  note: SavedNote | null;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <span
        suppressHydrationWarning
        className={cn(
          "text-sm",
          status.kind === "error" ? "text-red-600" : "text-muted-foreground"
        )}
      >
        {status.kind === "saving" && "Saving..."}
        {status.kind === "error" && status.message}
        {status.kind === "unsaved" && "Unsaved changes"}
        {status.kind === "saved" &&
          note &&
          `Saved · edited ${formatRelativeTime(note.updatedAt)}`}
      </span>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "text-xs tabular-nums",
            overLimit ? "text-red-600" : "text-muted-foreground"
          )}
        >
          {count}
        </span>
        <Button type="submit" size="sm" disabled={!canSave}>
          {status.kind === "saving" ? "Saving..." : "Save note"}
        </Button>
      </div>
    </div>
  );
}
