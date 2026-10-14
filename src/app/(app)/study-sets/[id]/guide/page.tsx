import type { Metadata } from "next";
import { StudyGuideView } from "@/components/study-guide/study-guide-view";
import { getStudyGuide, listStudyGuides } from "@/server/services/study-guides";
import { loadStudySet } from "../load";

export const metadata: Metadata = { title: "Study guide" };

export default async function StudyGuidePage({ params }: { params: Promise<{ id: string }> }) {
  const set = await loadStudySet((await params).id);
  const list = await listStudyGuides(set.id);
  const latest = list.guides[0];
  const guide = latest ? await getStudyGuide(latest.id) : null;
  return <StudyGuideView studySetId={set.id} canEdit={set.role !== "VIEWER"} initialList={list} initialGuide={guide} />;
}
