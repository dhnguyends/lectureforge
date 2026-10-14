import { Search } from "lucide-react";
import { WorkspaceTabs } from "@/components/study-sets/workspace-tabs";
import { loadStudySet } from "./load";

export default async function StudySetLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const set = await loadStudySet((await params).id);
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{[set.course, set.subject].filter(Boolean).join(" · ") || "Study set"}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{set.title}</h1>
        </div>
        <form role="search" action={`/study-sets/${set.id}/search`} className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            name="q"
            placeholder="Search all sources"
            aria-label="Search all sources in this study set"
            className="h-9 w-full rounded-md border border-input bg-card pr-3 pl-8 text-sm shadow-xs"
          />
        </form>
      </div>
      <WorkspaceTabs studySetId={set.id} />
      {children}
    </div>
  );
}
