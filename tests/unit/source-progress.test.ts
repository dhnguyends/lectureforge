import { describe, expect, it } from "vitest";
import { computeSourceProgress, displayStages } from "@/components/jobs/source-progress";

describe("displayStages", () => {
  it("prepends the upload to each kind's processing plan", () => {
    expect(displayStages("VIDEO")).toEqual(["UPLOADING", "SCANNING", "EXTRACTING_AUDIO", "TRANSCRIBING", "SEGMENTING", "INDEXING"]);
    expect(displayStages("PDF")).toEqual(["UPLOADING", "SCANNING", "PARSING_DOCUMENT", "OCR", "SEGMENTING", "INDEXING"]);
    expect(displayStages("DOCUMENT")).toEqual(displayStages("PDF"));
    // YouTube's plan already starts with fetching.
    expect(displayStages("YOUTUBE")[0]).toBe("UPLOADING");
    expect(displayStages("YOUTUBE").filter((s) => s === "UPLOADING")).toHaveLength(1);
  });
});

describe("computeSourceProgress", () => {
  it("fills the upload segment while a file is being sent", () => {
    const r = computeSourceProgress({ kind: "PDF", status: "PENDING_UPLOAD", stage: null, progress: 0, uploadFraction: 0.5 });
    expect(r.states).toEqual(["active", "pending", "pending", "pending", "pending", "pending"]);
    expect(r.fill).toBe(0.5);
    expect(r.overall).toBeCloseTo(0.5 / 6);
  });

  it("shows a queued document waiting at its first processing stage", () => {
    const r = computeSourceProgress({ kind: "VIDEO", status: "UPLOADED", stage: null, progress: 0 });
    expect(r.states.slice(0, 2)).toEqual(["done", "active"]);
    expect(r.fill).toBe(0);
  });

  it("maps job progress into the current stage's segment", () => {
    // Video plan has 5 stages; 0.5 overall = halfway through TRANSCRIBING (stage index 2).
    const r = computeSourceProgress({ kind: "VIDEO", status: "PROCESSING", stage: "TRANSCRIBING", progress: 0.5 });
    expect(r.states).toEqual(["done", "done", "done", "active", "pending", "pending"]);
    expect(r.fill).toBeCloseTo(0.5);
    expect(r.overall).toBeCloseTo(3.5 / 6);
  });

  it("marks the failing stage and everything before it", () => {
    const r = computeSourceProgress({ kind: "AUDIO", status: "FAILED", stage: "TRANSCRIBING", progress: 0.45 });
    expect(r.states).toEqual(["done", "done", "done", "failed", "pending", "pending"]);
  });

  it("is complete when ready", () => {
    const r = computeSourceProgress({ kind: "NOTE", status: "READY", stage: "COMPLETE", progress: 1 });
    expect(r.states.every((s) => s === "done")).toBe(true);
    expect(r.overall).toBe(1);
  });
});
