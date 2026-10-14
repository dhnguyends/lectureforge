/**
 * Index of the next item that is not done after `from`, wrapping round to the
 * start (so skipped items come back); -1 when every item is done. Used by the
 * flashcard review and quiz runners.
 */
export function nextUndone(done: readonly boolean[], from: number): number {
  const n = done.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!done[i]) return i;
  }
  return -1;
}
