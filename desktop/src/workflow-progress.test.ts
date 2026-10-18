import { describe, expect, it } from "vitest";
import { workflowProgress, type Workflow } from "./workflow-progress";
import type { RunStatusView } from "@/lib/ai/runner";

function snapshot(changes: Partial<Workflow> = {}): Workflow {
  return { id: "flow", projectId: "project", projectName: "小说", kind: "continue", planId: "plan", status: "running", currentTask: "draft", step: 0, steps: [{ taskType: "draft" }, { taskType: "continuity-check" }, { taskType: "draft-memory" }], run: { taskType: "draft", progress: { unitsDone: 1, unitsTotal: 2 } } as RunStatusView, notified: 0, sound: true, ...changes };
}

describe("automatic workflow progress", () => {
  it("counts the selected direction and reused outline before partial drafts", () => {
    expect(workflowProgress(snapshot())).toMatchObject({ currentIndex: 2, completed: 2, done: 1, total: 2, percent: 50 });
  });
  it("starts memory extraction at step five rather than showing an earlier stage", () => {
    expect(workflowProgress(snapshot({ currentTask: "draft-memory", step: 2, run: { taskType: "draft-memory", progress: { unitsDone: 0, unitsTotal: 5 } } as RunStatusView }))).toMatchObject({ currentIndex: 4, completed: 4, percent: 80, done: 0, total: 5 });
  });
  it("never combines a previous stage's counters with the next stage", () => {
    expect(workflowProgress(snapshot({ currentTask: "continuity-check", step: 1 }))).toMatchObject({ percent: 60, done: 0, total: 0, indeterminate: true });
  });
  it("reserves completion until the work is archived", () => {
    const saving = snapshot({ currentTask: "draft-memory", step: 3, run: { taskType: "draft-memory", progress: { unitsDone: 2, unitsTotal: 2 } } as RunStatusView });
    expect(workflowProgress(saving)).toMatchObject({ percent: 99, saving: true });
    expect(workflowProgress({ ...saving, status: "done" })).toMatchObject({ percent: 100, completed: 5, saving: false });
  });
  it("keeps measured progress when a task fails", () => {
    expect(workflowProgress(snapshot({ status: "failed" }))).toMatchObject({ percent: 50, completed: 2 });
  });
  it("does not describe understanding completion as saving a novel", () => {
    expect(workflowProgress(snapshot({ kind: "understand", currentTask: "chapter-extract", steps: [{ taskType: "chapter-extract" }], step: 1, run: { taskType: "chapter-extract", progress: { unitsDone: 1, unitsTotal: 1 } } as RunStatusView }))).toMatchObject({ percent: 99, saving: false });
  });
});
