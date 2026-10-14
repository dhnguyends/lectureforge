import { CircleHelp, Globe, Lightbulb, PenLine, ShieldCheck, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { ClaimLabel } from "@/lib/citations/markers";

/** User-facing provenance labels. Always icon + text, never colour alone. */
export const CLAIM_LABELS: Record<ClaimLabel, { text: string; short: string; icon: LucideIcon; variant: "grounded" | "inference" | "practice" | "destructive" }> = {
  grounded: { text: "Supported by source", short: "Source", icon: ShieldCheck, variant: "grounded" },
  inference: { text: "Inference / synthesis", short: "Inference", icon: Lightbulb, variant: "inference" },
  external: { text: "Not stated in source", short: "External", icon: Globe, variant: "practice" },
  unverified: { text: "No verified source — check before relying on it", short: "Unverified", icon: CircleHelp, variant: "destructive" },
};

export type SectionLabel = "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL" | "PRACTICE";

export function SectionProvenance({ label }: { label: SectionLabel }) {
  const map = {
    SOURCE_GROUNDED: { text: "Supported by source", icon: ShieldCheck, variant: "grounded" as const },
    INFERENCE: { text: "Includes inference", icon: Lightbulb, variant: "inference" as const },
    EXTERNAL: { text: "Not stated in source", icon: Globe, variant: "practice" as const },
    PRACTICE: { text: "Additional practice, not stated in source", icon: PenLine, variant: "practice" as const },
  }[label];
  const Icon = map.icon;
  return (
    <Badge variant={map.variant}>
      <Icon aria-hidden /> {map.text}
    </Badge>
  );
}
