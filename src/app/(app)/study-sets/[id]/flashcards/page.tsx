import type { Metadata } from "next";
import { auth } from "@/auth";
import { FlashcardsView } from "@/components/flashcards/flashcards-view";
import { getFlashcardsOverview } from "@/server/services/flashcards";
import { loadStudySet } from "../load";

export const metadata: Metadata = { title: "Flashcards" };

export default async function FlashcardsPage({ params }: { params: Promise<{ id: string }> }) {
  const set = await loadStudySet((await params).id);
  const session = await auth();
  const overview = await getFlashcardsOverview(session!.user!.id!, set.id);
  return <FlashcardsView studySetId={set.id} canEdit={set.role !== "VIEWER"} initial={overview} />;
}
