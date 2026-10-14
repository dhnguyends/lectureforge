import type { Metadata } from "next";
import { auth } from "@/auth";
import { ExercisesView } from "@/components/exercises/exercises-view";
import { listExerciseSets } from "@/server/services/exercises";
import { loadStudySet } from "../load";

export const metadata: Metadata = { title: "Exercises" };

export default async function ExercisesPage({ params }: { params: Promise<{ id: string }> }) {
  const set = await loadStudySet((await params).id);
  const session = await auth();
  const overview = await listExerciseSets(session!.user!.id!, set.id);
  return <ExercisesView studySetId={set.id} canEdit={set.role !== "VIEWER"} initial={overview} />;
}
