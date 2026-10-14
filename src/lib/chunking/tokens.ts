/**
 * Cheap token estimate (~4 chars/token for English prose, a little denser for
 * math and code). Used only for sizing chunks, never for billing.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const symbolHeavy = (text.match(/[\\{}()[\]^_=+\-*/<>|$]/g)?.length ?? 0) / text.length > 0.08;
  return Math.ceil(text.length / (symbolHeavy ? 3 : 4));
}
