import type { Metadata } from "next";
import Link from "next/link";
import { SourceList } from "@/components/viewer/source-list";
import { db } from "@/lib/db";
import { loadStudySet } from "../load";

export const metadata: Metadata = { title: "Sources" };

export default async function SourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const set = await loadStudySet((await params).id);
  const sources = await db.source.findMany({
    where: { studySetId: set.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, title: true, status: true, durationMs: true, pageCount: true },
  });
  return (
    <SourceList
      studySetId={set.id}
      sources={sources}
      empty={
        <>
          No sources yet.{" "}
          <Link href={`/study-sets/${set.id}`} className="text-primary underline-offset-4 hover:underline">
            Add one on the Overview tab
          </Link>
          .
        </>
      }
    />
  );
}
