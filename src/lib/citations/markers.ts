/**
 * Claim markers in stored guide text: [[claim:k3]]…[[/claim]], optionally with
 * a provenance suffix — [[claim:k3@inference]], @external, @unverified.
 * Shared by the renderer and the editor.
 */
export type ClaimLabel = "grounded" | "inference" | "external" | "unverified";

export type ParsedClaim = { key: string; label: ClaimLabel; number: number };

const OPEN = /\[\[claim:(k\d+(?:_\d+)?)(?:@(inference|external|unverified))?\]\]/g;

/** Claims in order of appearance, numbered from 1 for display. */
export function parseClaims(content: string): ParsedClaim[] {
  return [...content.matchAll(OPEN)].map((m, i) => ({ key: m[1]!, label: (m[2] as ClaimLabel | undefined) ?? "grounded", number: i + 1 }));
}

/**
 * Converts markers into Markdown links the renderer turns into citation
 * chips: "statement [3](#cite-k3)". Works inside lists, tables and emphasis.
 */
export function markersToLinks(content: string): string {
  const claims = parseClaims(content);
  let j = 0;
  return content.replace(OPEN, "").replace(/\[\[\/claim\]\]/g, () => {
    const c = claims[j++];
    return c ? ` [${c.number}](#cite-${c.key})` : "";
  });
}

export function markersBalanced(content: string): boolean {
  return (content.match(/\[\[claim:/g) ?? []).length === (content.match(/\[\[\/claim\]\]/g) ?? []).length;
}
