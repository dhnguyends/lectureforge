"use client";

import "katex/dist/katex.min.css";
import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { markersToLinks, parseClaims } from "@/lib/citations/markers";
import type { AnchorView } from "@/lib/contracts/study-guide";
import { CitationChip } from "./citation-chip";

/**
 * Renders a section's Markdown with KaTeX math, GFM tables and fenced code,
 * turning claim markers into citation chips. Raw HTML in content is not
 * rendered (react-markdown escapes it), so model output cannot inject markup.
 */
export function GuideMarkdown({ content, anchors, studySetId }: { content: string; anchors: AnchorView[]; studySetId: string }) {
  const { markdown, claims, byKey } = useMemo(() => {
    const claims = new Map(parseClaims(content).map((c) => [c.key, c]));
    const byKey = new Map<string, AnchorView[]>();
    for (const a of anchors) if (a.claimKey) byKey.set(a.claimKey, [...(byKey.get(a.claimKey) ?? []), a]);
    return { markdown: markersToLinks(content), claims, byKey };
  }, [content, anchors]);

  const components: Components = {
    a({ href, children }) {
      if (href?.startsWith("#cite-")) {
        const key = href.slice("#cite-".length);
        const claim = claims.get(key);
        if (!claim) return null;
        // A "grounded" claim whose anchors were lost (e.g. after an edit) is shown as unverified.
        const anchorsFor = byKey.get(key) ?? [];
        const label = claim.label === "grounded" && anchorsFor.length === 0 ? "unverified" : claim.label;
        return <CitationChip number={claim.number} label={label} anchors={anchorsFor} studySetId={studySetId} />;
      }
      const external = href && /^https?:/.test(href);
      return (
        <a href={href} className="text-primary underline underline-offset-2" {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
          {children}
        </a>
      );
    },
    pre({ children }) {
      return <pre className="my-3 overflow-x-auto rounded-lg border bg-muted/60 p-3 font-mono text-[0.85rem] leading-relaxed">{children}</pre>;
    },
    code({ className, children }) {
      return className ? <code className={className}>{children}</code> : <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
    },
    table({ children }) {
      return (
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-left font-sans text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted/60 [&_th]:px-2 [&_th]:py-1">
            {children}
          </table>
        </div>
      );
    },
  };

  return (
    <div className="prose-study space-y-3 [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-6">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
