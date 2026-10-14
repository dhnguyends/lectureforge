import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { ProcessingDashboard } from "@/components/jobs/processing-dashboard";
import { SourceIcon } from "@/components/upload/source-icons";
import { AddSourcesPanel } from "@/components/study-sets/add-sources-panel";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { env } from "@/lib/env";
import { getStudySetStatus } from "@/server/services/study-sets";
import { loadStudySet as load } from "./load";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const set = await load((await params).id);
  return { title: set.title };
}

const STRICTNESS_LABEL = { STRICT: "Strict citations", BALANCED: "Balanced citations", LENIENT: "Lenient citations" } as const;

export default async function StudySetPage({ params }: { params: Promise<Params> }) {
  const set = await load((await params).id);
  const status = await getStudySetStatus(set.id);
  const canEdit = set.role !== "VIEWER";

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        {/* Left: sources and table of contents */}
        <aside aria-label="Sources" className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sources</h2>
            {status.sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="space-y-1">
                {status.sources.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                    <SourceIcon kind={s.kind} className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate" title={s.title}>
                      {s.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Contents</h2>
            <p className="text-sm text-muted-foreground">An outline appears here once the study guide is generated.</p>
          </section>
        </aside>

        {/* Center: current resource */}
        <section aria-labelledby="processing-heading" className="min-w-0 space-y-6">
          <div>
            <h2 id="processing-heading" className="mb-3 text-lg font-semibold">
              Processing
            </h2>
            <ProcessingDashboard studySetId={set.id} initial={status} canEdit={canEdit} />
          </div>
          {canEdit && (
            <Card>
              <CardHeader>
                <CardTitle>Add sources</CardTitle>
                <CardDescription>Slides, papers and notes alongside a lecture make citations richer and quizzes sharper.</CardDescription>
              </CardHeader>
              <CardContent>
                <AddSourcesPanel studySetId={set.id} youtubeEnabled={env().ENABLE_YOUTUBE_INGEST} />
              </CardContent>
            </Card>
          )}
        </section>

        {/* Right: tools, grounding settings, progress */}
        <aside aria-label="Study tools" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Grounding</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 pt-2">
              <Badge variant="grounded">
                <ShieldCheck aria-hidden />
                {set.sourcesOnly ? "Sources only" : "Sources first"}
              </Badge>
              <Badge variant="outline">{STRICTNESS_LABEL[set.citationStrictness]}</Badge>
              <Badge variant={set.allowExternalKnowledge ? "inference" : "muted"}>
                External knowledge {set.allowExternalKnowledge ? "on (labelled)" : "off"}
              </Badge>
              {set.preserveEquationsCode && <Badge variant="outline">Equations &amp; code preserved</Badge>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Requested materials</CardTitle>
              <CardDescription>Generated automatically once all sources are processed.</CardDescription>
            </CardHeader>
            <CardContent>
              {set.outputTypes.length ? (
                <ul className="space-y-1 text-sm">
                  {set.outputTypes.map((t) => (
                    <li key={t} className="capitalize">
                      {t.toLowerCase().replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None selected.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
