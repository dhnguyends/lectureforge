import { AlertTriangle, BookOpen, CheckCircle2, Clock, Layers, ListChecks, Plus, Puzzle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { ProcessingJobsPanel } from "@/components/dashboard/processing-jobs-panel";
import { QuickCreateDialog } from "@/components/dashboard/quick-create-dialog";
import { StudySetCollection } from "@/components/dashboard/study-set-collection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { listRecentJobs, progressOverview, recentActivity, type ActivityItem } from "@/server/services/dashboard";
import { listStudySets } from "@/server/services/study-sets";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const ACTIVITY_ICON: Record<ActivityItem["kind"], typeof Clock> = {
  source_ready: CheckCircle2,
  source_failed: AlertTriangle,
  study_set_created: BookOpen,
  review: Layers,
  quiz: ListChecks,
  exercise: Puzzle,
};

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;
  const [sets, jobs, activity, progress] = await Promise.all([
    listStudySets(userId),
    listRecentJobs(userId),
    recentActivity(userId),
    progressOverview(userId),
  ]);
  const due = sets.filter((s) => s.dueCards > 0).sort((a, b) => b.dueCards - a.dueCards);
  const totalDue = due.reduce((n, s) => n + s.dueCards, 0);
  const firstName = session!.user.name?.split(" ")[0];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{firstName ? `Welcome back, ${firstName}` : "Dashboard"}</h1>
          <p className="text-muted-foreground">
            {totalDue > 0 ? `${pluralize(totalDue, "card")} ready for review today.` : "Nothing due for review right now."}
          </p>
        </div>
        <div className="flex gap-2">
          <QuickCreateDialog />
          <Button asChild>
            <Link href="/study-sets/new">
              <Plus aria-hidden /> New study set
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          {sets.length === 0 ? (
            <Card className="px-6 py-12 text-center">
              <BookOpen className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <h2 className="mt-3 text-lg font-semibold">Create your first study set</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Upload a lecture recording with its slides. You will get a transcript you can search and a set of study materials that cite
                the exact timestamps and pages they came from.
              </p>
              <Button asChild className="mt-5">
                <Link href="/study-sets/new">Create a study set</Link>
              </Button>
            </Card>
          ) : (
            <StudySetCollection sets={sets} />
          )}

          <section aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="mb-3 text-lg font-semibold">
              Recent activity
            </h2>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Your activity will appear here.</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {activity.map((a) => {
                  const Icon = ACTIVITY_ICON[a.kind];
                  const label = a.studySetId ? (
                    <Link href={`/study-sets/${a.studySetId}`} className="hover:underline">
                      {a.label}
                    </Link>
                  ) : (
                    a.label
                  );
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <Icon className={a.kind === "source_failed" ? "size-4 text-destructive" : "size-4 text-muted-foreground"} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      <time dateTime={a.at} className="shrink-0 text-xs text-muted-foreground">
                        {ago(a.at)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4" aria-label="Status and progress">
          <ProcessingJobsPanel initial={{ jobs }} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review queue</CardTitle>
              <CardDescription>Spaced-repetition cards due now, plus up to 20 new cards per set.</CardDescription>
            </CardHeader>
            <CardContent>
              {due.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cards due. Flashcards you generate will be scheduled here.</p>
              ) : (
                <ul className="space-y-2">
                  {due.slice(0, 6).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={`/study-sets/${s.id}/flashcards`} className="truncate hover:underline">
                        {s.title}
                      </Link>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{s.dueCards}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">This week</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Minutes studied" value={String(progress.minutesThisWeek)} />
                <Stat label="Cards reviewed" value={String(progress.reviewsThisWeek)} />
                <Stat
                  label={`Quiz accuracy${progress.quizSample ? ` (${progress.quizSample})` : ""}`}
                  value={progress.quizAccuracy === null ? "—" : `${Math.round(progress.quizAccuracy * 100)}%`}
                />
              </dl>
              {progress.setsWithMastery.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Lowest mastery</p>
                  {progress.setsWithMastery.map((m) => (
                    <div key={m.studySetId} className="flex items-center justify-between text-sm">
                      <Link href={`/study-sets/${m.studySetId}`} className="truncate hover:underline">
                        {m.title}
                      </Link>
                      <span className="tabular-nums">{Math.round(m.mastery * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse rounded-lg bg-muted/60 px-2 py-3">
      <dt className="mt-0.5 text-[0.7rem] leading-tight text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
