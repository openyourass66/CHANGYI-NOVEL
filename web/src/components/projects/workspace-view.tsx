"use client";
import type { WorkspaceView as View } from "@contracts/workspace";
import { ChapterWorkspace } from "./chapter-workspace";
import { AnalysisPanel } from "./analysis-panel";
import { MemoryWorkbench } from "./memory-workbench";
import { ContinuationPanel } from "./continuation-panel";

export function WorkspaceView({ data, focusEntryId }: { data: View; focusEntryId?: string | null }) {
  switch (data.view) {
    case "chapters": return <ChapterWorkspace {...data.props} />;
    case "analysis": return <AnalysisPanel {...data.props} />;
    case "memory": return <MemoryWorkbench {...data.props} focusEntryId={focusEntryId} />;
    case "continuation": return <ContinuationPanel {...data.props} />;
  }
}
