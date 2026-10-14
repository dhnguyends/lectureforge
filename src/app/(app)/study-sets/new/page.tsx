import type { Metadata } from "next";
import { auth } from "@/auth";
import { CreateStudySetForm } from "@/components/study-sets/create-study-set-form";
import { env } from "@/lib/env";
import { userDisciplines } from "@/server/services/profiles";

export const metadata: Metadata = { title: "New study set" };

export default async function NewStudySetPage() {
  const session = await auth();
  const subjects = await userDisciplines(session!.user!.id!);
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Create a study set</h1>
        <p className="text-muted-foreground">
          Group a lecture with its slides, papers and your notes. Every study resource we generate links back to the exact moment or page it
          came from.
        </p>
      </div>
      <CreateStudySetForm youtubeEnabled={env().ENABLE_YOUTUBE_INGEST} subjects={subjects} />
    </div>
  );
}
