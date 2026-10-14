"use client";

import { AlertTriangle } from "lucide-react";
import { CitationChip } from "@/components/study-guide/citation-chip";
import { GuideMarkdown } from "@/components/study-guide/guide-markdown";
import { CLAIM_LABELS } from "@/components/study-guide/provenance";
import { Badge } from "@/components/ui/primitives";
import type { ClaimLabel } from "@/lib/citations/markers";
import type { CardView } from "@/lib/contracts/flashcards";

const CLOZE = /\{\{c\d+::([\s\S]+?)(?:::([^}]*))?\}\}/g;

/** Question side of a cloze card: hidden spans become a blank (with the hint, if any). */
export function clozeQuestion(text: string): string {
  return text.replace(CLOZE, (_m, _answer, hint?: string) => (hint ? `**[… ${hint} …]**` : "**[ … ]**"));
}

/** Answer side of a cloze card: hidden spans shown in bold. */
export function clozeAnswer(text: string): string {
  return text.replace(CLOZE, (_m, answer: string) => `**${answer}**`);
}

export function cardLabel(card: Pick<CardView, "claimType" | "anchors">): ClaimLabel {
  if (card.claimType === "EXTERNAL") return "external";
  if (!card.anchors.length) return "unverified";
  return card.claimType === "INFERENCE" ? "inference" : "grounded";
}

export function CardFront({ card, studySetId }: { card: CardView; studySetId: string }) {
  const text = card.type === "CLOZE" ? clozeQuestion(card.front) : card.front;
  return (
    <div className="text-lg leading-relaxed">
      <GuideMarkdown content={text} anchors={[]} studySetId={studySetId} />
    </div>
  );
}

export function CardBack({ card, studySetId }: { card: CardView; studySetId: string }) {
  const label = cardLabel(card);
  const meta = CLAIM_LABELS[label];
  const Icon = meta.icon;
  return (
    <div className="space-y-4">
      {card.type === "CLOZE" && (
        <div className="text-lg leading-relaxed">
          <GuideMarkdown content={clozeAnswer(card.front)} anchors={[]} studySetId={studySetId} />
        </div>
      )}
      {card.back && (
        <div className="leading-relaxed">
          <GuideMarkdown content={card.back} anchors={[]} studySetId={studySetId} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Badge variant={meta.variant}>
          <Icon aria-hidden /> {meta.text}
        </Badge>
        {card.anchors.map((a, i) => (
          <CitationChip key={a.id} number={i + 1} label={label} anchors={[a]} studySetId={studySetId} />
        ))}
      </div>
      {card.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {card.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-inference" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
