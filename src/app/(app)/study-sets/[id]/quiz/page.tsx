import type { Metadata } from "next";
import { auth } from "@/auth";
import { QuizView } from "@/components/quiz/quiz-view";
import { listQuizzes } from "@/server/services/quizzes";
import { loadStudySet } from "../load";

export const metadata: Metadata = { title: "Quiz" };

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const set = await loadStudySet((await params).id);
  const session = await auth();
  const overview = await listQuizzes(session!.user!.id!, set.id);
  return <QuizView studySetId={set.id} canEdit={set.role !== "VIEWER"} initial={overview} />;
}
