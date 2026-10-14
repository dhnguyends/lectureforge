import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SourceList } from "@/components/viewer/source-list";
import { db } from "@/lib/db";
import { loadStudySet } from "../load";

export const metadata: Metadata = { title: "Transcripts" };

/** Recordings in the set; with exactly one ready recording, go straight to it. */
export default async function TranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  const set = await loadStudySet((await params).id);
  const sources = await db.source.findMany({
    where: { studySetId: set.id, kind: { in: ["VIDEO", "AUDIO", "YOUTUBE"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, title: true, status: true, durationMs: true, pageCount: true, transcript: { select: { _count: { select: { segments: true } } } } },
  });
  const ready = sources.filter((s) => s.status === "READY");
  if (ready.length === 1 && sources.length === 1) redirect(`/study-sets/${set.id}/sources/${ready[0]!.id}`);
  return (
    <SourceList
      studySetId={set.id}
      sources={sources.map((s) => ({ ...s, segments: s.transcript?._count.segments }))}
      empty="No recordings in this study set yet. Upload a lecture video or audio file on the Overview tab."
    />
  );
}
