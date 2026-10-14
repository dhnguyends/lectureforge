import type { Metadata } from "next";
import { auth } from "@/auth";
import { TutorView } from "@/components/tutor/tutor-view";
import { listConversations, tutorModelName } from "@/server/tutor/service";
import { loadStudySet } from "../load";

export const metadata: Metadata = { title: "Tutor" };

export default async function TutorPage({ params }: { params: Promise<{ id: string }> }) {
  const set = await loadStudySet((await params).id);
  const session = await auth();
  const conversations = await listConversations(set.id, session!.user.id);
  return <TutorView studySetId={set.id} initialConversations={conversations} model={tutorModelName()} />;
}
