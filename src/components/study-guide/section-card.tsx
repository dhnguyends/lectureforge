"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Pencil, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge, Label, Textarea } from "@/components/ui/primitives";
import { Checkbox } from "@/components/ui/switch";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { markersBalanced } from "@/lib/citations/markers";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/contracts/generation";
import type { SectionView } from "@/lib/contracts/study-guide";
import { cn } from "@/lib/utils";
import { GuideMarkdown } from "./guide-markdown";
import { SectionProvenance, type SectionLabel } from "./provenance";

const KIND_LABEL: Record<string, string> = {
  LEARNING_OBJECTIVES: "Learning objectives",
  VOCABULARY: "Key vocabulary",
  CONCEPTS: "Concepts",
  DEFINITIONS: "Definitions",
  EQUATIONS: "Equations & symbols",
  ASSUMPTIONS: "Assumptions & limitations",
  DERIVATION: "Derivation",
  WORKED_EXAMPLE: "Worked example",
  MISCONCEPTIONS: "Common misconceptions",
  PREREQUISITES: "Prerequisites",
  RECALL_PROMPTS: "Recall prompts",
  NOTES: "Notes",
};

function sectionLabel(s: SectionView): SectionLabel {
  if (s.kind === "WORKED_EXAMPLE" && s.claimType === "EXTERNAL") return "PRACTICE";
  return s.claimType;
}

export function SectionCard({
  section,
  guideId,
  studySetId,
  canEdit,
  pending,
  regenerating,
}: {
  section: SectionView;
  guideId: string;
  studySetId: string;
  canEdit: boolean;
  /** The guide is still being written and this section has no content yet. */
  pending: boolean;
  regenerating: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const Heading = section.parentId ? "h3" : "h2";
  const lowConfidence = section.confidence !== null && section.confidence < LOW_CONFIDENCE_THRESHOLD;

  return (
    <section id={`section-${section.id}`} aria-labelledby={`title-${section.id}`} className="scroll-mt-24 rounded-xl border bg-card p-5 sm:p-6">
      <header className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium tracking-wide uppercase">{KIND_LABEL[section.kind] ?? section.kind}</span>
          {!pending && <SectionProvenance label={sectionLabel(section)} />}
          {section.editedByUser && <Badge variant="outline">Edited by you</Badge>}
        </div>
        <Heading id={`title-${section.id}`} className={cn("font-semibold tracking-tight", section.parentId ? "text-lg" : "text-xl")}>
          {section.title}
        </Heading>
        {section.learningObjective && section.kind !== "LEARNING_OBJECTIVES" && (
          <p className="text-sm text-muted-foreground">Objective: {section.learningObjective}</p>
        )}
      </header>

      {!pending && section.sourceChanged && (
        <p role="note" className="mb-3 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-accent px-3 py-2 text-sm">
          <AlertTriangle className="size-4 text-primary" aria-hidden />
          A transcript line this section cites was corrected or flagged after it was written. Regenerate the section to use the corrected text.
        </p>
      )}
      {!pending && (lowConfidence || section.warnings.length > 0) && (
        <div role="note" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {lowConfidence && (
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-4 text-warning" aria-hidden />
              Low confidence ({Math.round((section.confidence ?? 0) * 100)}%) — inspect the cited sources before relying on this section.
            </p>
          )}
          {section.warnings.length > 0 && (
            <ul className={cn("list-disc space-y-0.5 pl-5 text-muted-foreground", lowConfidence && "mt-1")}>
              {section.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pending ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Writing this section…
        </p>
      ) : editing ? (
        <SectionEditor section={section} guideId={guideId} onDone={() => setEditing(false)} />
      ) : (
        <div className={cn(regenerating && "opacity-50")} aria-busy={regenerating}>
          <GuideMarkdown content={section.content} anchors={section.anchors} studySetId={studySetId} />
        </div>
      )}

      {!pending && !editing && (
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>
            Version {section.version}
            {section.rationale ? ` · ${section.rationale}` : ""}
          </span>
          {canEdit && (
            <div className="flex gap-1">
              {regenerating ? (
                <span className="flex items-center gap-1.5 px-2">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> Regenerating…
                </span>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                  <RegenerateDialog section={section} guideId={guideId} />
                </>
              )}
            </div>
          )}
        </footer>
      )}
    </section>
  );
}

function SectionEditor({ section, guideId, onDone }: { section: SectionView; guideId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState(section.content);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  const save = async () => {
    if (!markersBalanced(content)) {
      setError("Each [[claim:…]] marker needs a matching [[/claim]].");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/study-guide-sections/${section.id}`, { method: "PATCH", json: { content } });
      await qc.invalidateQueries({ queryKey: ["study-guide", guideId] });
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save your changes.");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Edit section (Markdown, LaTeX between $…$)</Label>
      <Textarea id={id} value={content} onChange={(e) => setContent(e.target.value)} rows={Math.min(30, Math.max(10, content.split("\n").length + 2))} className="font-mono text-[0.85rem] leading-relaxed" aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Keep the <code>[[claim:…]]…[[/claim]]</code> markers around statements to keep their citations. Your edit is saved as a new version.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />} Save version
        </Button>
        <Button size="sm" variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function RegenerateDialog({ section, guideId }: { section: SectionView; guideId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [replaceEdits, setReplaceEdits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/study-guide-sections/${section.id}/regenerate`, {
        method: "POST",
        json: { instructions: instructions || undefined, force: replaceEdits },
      });
      await qc.invalidateQueries({ queryKey: ["study-guides"] });
      await qc.invalidateQueries({ queryKey: ["study-guide", guideId] });
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not start regeneration.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <RefreshCw aria-hidden /> Regenerate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate “{section.title}”</DialogTitle>
          <DialogDescription>Only this section is rewritten, from your sources, with the same citation checks. The current version stays in history.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={id}>What should change? (optional)</Label>
          <Textarea id={id} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Explain the derivation step by step and define every symbol." maxLength={1000} />
        </div>
        {section.editedByUser && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={replaceEdits} onCheckedChange={(v) => setReplaceEdits(v === true)} className="mt-0.5" />
            <span>This section has your edits. Replace them with a regenerated version.</span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || (section.editedByUser && !replaceEdits)}>
            {pending && <Loader2 className="animate-spin" aria-hidden />} Regenerate section
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
