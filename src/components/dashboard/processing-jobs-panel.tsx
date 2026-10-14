"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { StatusBadge } from "@/components/jobs/status-badge";
import { Card, CardContent, CardHeader, CardTitle, Progress } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api-client";
import type { ListJobsResponse } from "@/lib/contracts/source";
import { STAGE_LABELS } from "@/lib/pipeline-plan";

const TYPE_LABEL: Record<string, string> = {
  SOURCE_INGEST: "Processing source",
  GENERATE_STUDY_GUIDE: "Study guide",
  GENERATE_FLASHCARDS: "Flashcards",
  GENERATE_QUIZ: "Quiz",
  GENERATE_EXERCISES: "Exercises",
  GENERATE_AUDIO_RECAP: "Audio recap",
  REGENERATE_ITEM: "Regenerating item",
  VALIDATE_ARTIFACT: "Validating citations",
};

export function ProcessingJobsPanel({ initial }: { initial: ListJobsResponse }) {
  const { data } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => apiFetch<ListJobsResponse>("/api/jobs"),
    initialData: initial,
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ? 3000 : 60_000),
  });
  const jobs = data?.jobs ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Processing</CardTitle>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in progress.</p>
        ) : (
          <ul className="space-y-3" aria-live="polite">
            {jobs.slice(0, 6).map((j) => (
              <li key={j.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/study-sets/${j.studySetId}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                    {j.sourceTitle ?? TYPE_LABEL[j.type] ?? j.type}
                  </Link>
                  <StatusBadge status={j.status} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {j.studySetTitle}
                  {j.status === "RUNNING" && j.stage ? ` · ${STAGE_LABELS[j.stage]}` : ""}
                  {j.error ? ` · ${j.error}` : ""}
                </p>
                {(j.status === "RUNNING" || j.status === "QUEUED") && <Progress value={j.progress} label={`Progress for ${j.sourceTitle ?? j.type}`} />}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
