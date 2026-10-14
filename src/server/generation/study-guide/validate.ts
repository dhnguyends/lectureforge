import type { CitationStrictness } from "@prisma/client";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/contracts/generation";
import { normalizeForMatch, verifyExcerpt } from "@/lib/citations/verify";
import type { SectionOutput } from "./schemas";

export type Passage = { ref: string; chunkId: string; text: string };

export type ValidationPolicy = {
  strictness: CitationStrictness;
  allowExternalKnowledge: boolean;
};

export type VerifiedCitation = { ref: string; chunkId: string; excerpt: string };

export type KeptClaim = {
  key: string;
  claimType: "source_grounded" | "inference" | "external";
  /** True when at least one citation's excerpt was found in its passage. */
  verified: boolean;
  citations: VerifiedCitation[];
};

export type ValidatedSection = {
  content: string;
  claims: KeptClaim[];
  claimType: "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL";
  confidence: number;
  warnings: string[];
  stats: { proposed: number; kept: number; dropped: number; verified: number; failedCitations: number };
};

const CLAIM_RE = /\[\[claim:(k\d+)\]\]([\s\S]*?)\[\[\/claim\]\]/g;
const VALID_MARKER = /^\[\[claim:k\d+(_\d+)?(@(inference|external|unverified))?\]\]$|^\[\[\/claim\]\]$/;

/**
 * Stored markers carry the claim's provenance so the reader can label each
 * statement: no suffix = supported by a verified source excerpt.
 * See src/lib/citations/markers.ts.
 */
function markerLabel(claimType: KeptClaim["claimType"], verified: boolean): string {
  if (claimType === "external") return "@external";
  if (!verified) return "@unverified";
  return claimType === "inference" ? "@inference" : "";
}

/**
 * Applies the grounding policy to one generated section:
 * - a citation survives only if its ref was offered and its excerpt is verbatim in that passage
 * - source-grounded claims without a surviving citation are dropped (STRICT) or relabelled as unverified inference
 * - inference must rest on a verified passage under STRICT
 * - external claims survive only if the study set allows external knowledge
 * - equations using Greek symbols that appear in none of the passages are flagged
 */
export function validateSection(output: SectionOutput, passages: Passage[], policy: ValidationPolicy): ValidatedSection {
  const byRef = new Map(passages.map((p) => [p.ref, p]));
  const claimDefs = new Map(output.claims.map((c) => [c.key, c]));
  const warnings = [...output.warnings];
  const kept: KeptClaim[] = [];
  const stats = { proposed: 0, kept: 0, dropped: 0, verified: 0, failedCitations: 0 };

  if (output.aiCreatedPractice) {
    // Practice examples are not claims about the sources; strip any markers and label the section.
    const content = output.content.replace(CLAIM_RE, (_m, _k, text: string) => text);
    return {
      content: tidy(content),
      claims: [],
      claimType: "EXTERNAL",
      confidence: output.confidence,
      warnings: ["AI-created practice example — not stated in your sources.", ...warnings],
      stats,
    };
  }

  const seen = new Set<string>();
  let content = output.content.replace(CLAIM_RE, (_match, key: string, text: string) => {
    stats.proposed++;
    if (seen.has(key)) key = `${key}_${stats.proposed}`; // duplicate keys from the model
    seen.add(key);
    const def = claimDefs.get(key.split("_")[0]!);
    const citations: VerifiedCitation[] = [];
    for (const c of def?.citations ?? []) {
      const passage = byRef.get(c.ref);
      if (passage && verifyExcerpt(c.excerpt, passage.text)) citations.push({ ref: c.ref, chunkId: passage.chunkId, excerpt: c.excerpt.trim() });
      else stats.failedCitations++;
    }
    const verified = citations.length > 0;
    const declared = def?.claimType ?? "source_grounded";

    let claimType: KeptClaim["claimType"] | null = declared;
    if (declared === "external") {
      claimType = policy.allowExternalKnowledge ? "external" : null;
    } else if (declared === "source_grounded" && !verified) {
      claimType = policy.strictness === "STRICT" ? null : "inference";
    } else if (declared === "inference" && !verified && policy.strictness === "STRICT") {
      claimType = null;
    }

    if (claimType === null) {
      stats.dropped++;
      return "";
    }
    stats.kept++;
    if (verified) stats.verified++;
    kept.push({ key, claimType, verified, citations });
    return `[[claim:${key}${markerLabel(claimType, verified)}]]${text.trim()}[[/claim]]`;
  });

  // Stray or unbalanced markers would render as literal text.
  content = tidy(content.replace(/\[\[\/?claim(?::[^\]]*)?\]\]/g, (m) => (VALID_MARKER.test(m) ? m : "")));
  content = balanceMarkers(content);

  if (stats.dropped > 0) {
    warnings.push(
      `${stats.dropped} statement${stats.dropped === 1 ? " was" : "s were"} removed because ${stats.dropped === 1 ? "it" : "they"} could not be matched to your sources.`,
    );
  }
  const unverifiedKept = kept.filter((c) => !c.verified && c.claimType !== "external").length;
  if (unverifiedKept > 0) {
    warnings.push(`${unverifiedKept} statement${unverifiedKept === 1 ? " is" : "s are"} not backed by a verified source excerpt — check before relying on ${unverifiedKept === 1 ? "it" : "them"}.`);
  }
  const missingSymbols = unsupportedSymbols(content, passages);
  if (missingSymbols.length) {
    warnings.push(`Equations use symbols that do not appear in the cited material: ${missingSymbols.join(", ")}. Check the notation against the source.`);
  }

  const grounded = kept.filter((c) => c.claimType === "source_grounded").length;
  const external = kept.filter((c) => c.claimType === "external").length;
  const claimType: ValidatedSection["claimType"] =
    kept.length === 0 ? "INFERENCE" : external / kept.length >= 0.5 ? "EXTERNAL" : grounded / kept.length >= 0.8 ? "SOURCE_GROUNDED" : "INFERENCE";

  // Confidence: the model's own estimate, discounted by how much survived verification.
  const supportRatio = stats.proposed ? stats.verified / stats.proposed : 0.5;
  let confidence = Math.max(0, Math.min(1, output.confidence * (0.4 + 0.6 * supportRatio)));
  if (missingSymbols.length) confidence = Math.min(confidence, LOW_CONFIDENCE_THRESHOLD - 0.01);

  return { content, claims: kept, claimType, confidence: Number(confidence.toFixed(3)), warnings, stats };
}

/** Removes empty bullets/paragraphs and doubled spaces left behind by dropped claims. */
function tidy(md: string): string {
  return md
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trimEnd())
    .filter((line) => !/^\s*([-*+]|\d+[.)])\s*[.,;:]?\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function balanceMarkers(md: string): string {
  const opens = (md.match(/\[\[claim:/g) ?? []).length;
  const closes = (md.match(/\[\[\/claim\]\]/g) ?? []).length;
  if (opens === closes) return md;
  return md.replace(/\[\[\/?claim(?::[^\]]*)?\]\]/g, "");
}

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

/**
 * Greek-letter symbols used in the section's math that occur nowhere in its
 * passages (as the Unicode character, the LaTeX command, or the spoken name).
 * Catches notation the model introduced rather than took from the source.
 */
export function unsupportedSymbols(content: string, passages: Passage[]): string[] {
  const math = (content.match(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g) ?? []).join(" ");
  if (!math) return [];
  const used = new Set<string>();
  for (const m of math.matchAll(/\\([A-Za-z]+)/g)) if (GREEK[m[1]!]) used.add(m[1]!);
  for (const [name, ch] of Object.entries(GREEK)) if (math.includes(ch)) used.add(name);
  const corpus = passages.map((p) => p.text).join("\n");
  const lower = normalizeForMatch(corpus);
  const missing: string[] = [];
  for (const name of used) {
    const ch = GREEK[name]!;
    const spoken = name.replace(/^var/, "").toLowerCase();
    if (corpus.includes(ch) || corpus.includes(`\\${name}`) || new RegExp(`\\b${spoken}\\b`).test(lower)) continue;
    missing.push(ch);
  }
  return [...new Set(missing)];
}
