"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { SourcePicker } from "@/components/upload/source-picker";
import { useSourceStaging } from "@/components/upload/use-source-staging";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/primitives";
import { Checkbox } from "@/components/ui/switch";

export function AddSourcesPanel({ studySetId, youtubeEnabled }: { studySetId: string; youtubeEnabled: boolean }) {
  const staging = useSourceStaging();
  const qc = useQueryClient();
  const [rights, setRights] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rightsId = useId();
  const pending = staging.items.filter((i) => i.phase === "staged" || i.phase === "failed").length;

  const upload = async () => {
    if (!rights) return;
    setMessage(null);
    const { succeeded, failed } = await staging.uploadAll(studySetId, true);
    await qc.invalidateQueries({ queryKey: ["study-set-status", studySetId] });
    setMessage(failed ? `${failed} upload(s) failed — see the list above.` : `${succeeded} source(s) added. Processing has started.`);
  };

  return (
    <div className="space-y-4">
      <SourcePicker staging={staging} youtubeEnabled={youtubeEnabled} />
      {staging.validCount > 0 && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Checkbox id={rightsId} checked={rights} onCheckedChange={(v) => setRights(v === true)} className="mt-0.5" />
            <Label htmlFor={rightsId} className="leading-snug font-normal">
              I own these materials or have permission to upload and process them for my private study.
            </Label>
          </div>
          <Button onClick={upload} disabled={!rights || staging.busy || pending === 0}>
            {staging.busy && <Loader2 className="animate-spin" aria-hidden />}
            {staging.busy ? "Uploading…" : `Upload ${pending} source${pending === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
      {message && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}
