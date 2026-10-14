import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SourceViewer } from "@/components/viewer/source-viewer";
import { db } from "@/lib/db";
import { parseTimeParam } from "@/lib/source-links";
import { loadStudySet } from "../../load";

type Params = { id: string; sourceId: string };
type Search = { t?: string; page?: string; anchor?: string };

async function loadSource(studySetId: string, sourceId: string) {
  const source = await db.source
    .findFirst({ where: { id: sourceId, studySetId }, select: { id: true, kind: true, title: true, status: true } })
    .catch(() => null);
  if (!source) notFound();
  return source;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id, sourceId } = await params;
  const set = await loadStudySet(id);
  const source = await loadSource(set.id, sourceId);
  return { title: source.title };
}

export default async function SourcePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { id, sourceId } = await params;
  const sp = await searchParams;
  const set = await loadStudySet(id);
  const source = await loadSource(set.id, sourceId);
  if (source.status !== "READY") {
    return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">“{source.title}” is still being processed. Check the Overview tab for progress.</p>;
  }
  const page = Number(sp.page);
  return (
    <SourceViewer
      studySetId={set.id}
      sourceId={source.id}
      kind={source.kind}
      title={source.title}
      canEdit={set.role !== "VIEWER"}
      initialMs={parseTimeParam(sp.t)}
      initialPage={Number.isInteger(page) && page > 0 ? page : null}
      anchorId={sp.anchor && /^[0-9a-f-]{36}$/i.test(sp.anchor) ? sp.anchor : null}
    />
  );
}
