"use client";

import "katex/dist/katex.min.css";
import { Clock, ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { SourceIcon } from "@/components/upload/source-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SourceKind } from "@/lib/contracts/source";
import type { TutorAnchorView } from "@/lib/contracts/tutor";
import { sourceHref } from "@/lib/source-links";
import { formatClock } from "@/lib/time";

/** "[C2]" / "[C1, C3]" → links the renderer turns into passage chips. */
export function refsToLinks(content: string): string {
  return content.replace(/\[(C\d+(?:\s*,\s*C\d+)*)\]/g, (_m, list: string) =>
    list
      .split(/\s*,\s*/)
      .map((r) => `[${r}](#ref-${r})`)
      .join(""),
  );
}

export function where(a: { startMs: number | null; endMs: number | null; page: number | null }): string {
  if (a.startMs !== null) return a.endMs !== null ? `${formatClock(a.startMs)}–${formatClock(a.endMs)}` : formatClock(a.startMs);
  return a.page !== null ? `page ${a.page}` : "notes";
}

/**
 * Tutor replies: Markdown + KaTeX, with [C#] references rendered as chips that
 * show the passage the tutor drew on and open it in the source viewer.
 * References are to whole passages, not excerpt-verified claims.
 */
export function TutorMarkdown({ content, anchors, studySetId }: { content: string; anchors: TutorAnchorView[]; studySetId: string }) {
  const byRef = useMemo(() => new Map(anchors.map((a) => [a.ref, a])), [anchors]);
  const components: Components = {
    a({ href, children }) {
      if (href?.startsWith("#ref-")) {
        const ref = href.slice(5);
        const a = byRef.get(ref);
        if (!a) return null;
        return (
          <Popover>
            <PopoverTrigger
              className="mx-0.5 inline-flex h-5 translate-y-[-1px] items-center rounded bg-secondary px-1.5 align-middle font-mono text-[0.7rem] font-semibold text-secondary-foreground hover:ring-1 hover:ring-current"
              aria-label={`Source passage ${ref}: ${a.sourceTitle}, ${where(a)}`}
            >
              {where(a)}
            </PopoverTrigger>
            <PopoverContent>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <SourceIcon kind={a.sourceKind as SourceKind} className="size-4 text-muted-foreground" />
                <span className="truncate">{a.sourceTitle}</span>
                <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-timestamp">
                  {a.startMs !== null ? <Clock className="size-3" aria-hidden /> : <FileText className="size-3" aria-hidden />}
                  {where(a)}
                </span>
              </p>
              <blockquote className="border-l-2 pl-3 font-serif text-sm leading-relaxed">“{a.excerpt}{a.excerpt.length >= 280 ? "…" : ""}”</blockquote>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Passage the tutor drew on</span>
                <Link href={sourceHref(studySetId, a.sourceId, { startMs: a.startMs, page: a.page })} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  <ExternalLink className="size-3" aria-hidden /> Open in source
                </Link>
              </div>
            </PopoverContent>
          </Popover>
        );
      }
      const external = href && /^https?:/.test(href);
      return (
        <a href={href} className="text-primary underline underline-offset-2" {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
          {children}
        </a>
      );
    },
    pre({ children }) {
      return <pre className="my-2 overflow-x-auto rounded-lg border bg-muted/60 p-3 font-mono text-[0.85rem]">{children}</pre>;
    },
    code({ className, children }) {
      return className ? <code className={className}>{children}</code> : <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
    },
  };
  return (
    <div className="space-y-2 leading-relaxed [&_.katex-display]:overflow-x-auto [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {refsToLinks(content)}
      </ReactMarkdown>
    </div>
  );
}
