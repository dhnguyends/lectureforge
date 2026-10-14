import { describe, expect, it } from "vitest";
import { nextUndone } from "@/lib/navigation";

describe("nextUndone", () => {
  it("finds the next item not done, wrapping round to skipped ones", () => {
    const done = [false, true, false, true, false];
    expect(nextUndone(done, 0)).toBe(2);
    expect(nextUndone(done, 2)).toBe(4);
    expect(nextUndone(done, 4)).toBe(0);
    expect(nextUndone([true, true], 0)).toBe(-1);
    expect(nextUndone([], 0)).toBe(-1);
  });
});
