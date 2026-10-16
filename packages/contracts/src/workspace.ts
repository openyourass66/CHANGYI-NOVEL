import type { ChapterSummary } from "./chapters-view";
import type { ContinuationPlanView } from "./continuation-view";
import type { KeyConflict, KnowledgeView, MemoryEntryView } from "./memory-view";
import type { ProfileView, ProposalView, RunStatusView, TaskSummary } from "./api";

export const API_VERSION = 1;
export type WorkspaceKind = "chapters" | "analysis" | "memory" | "continuation";
type Base = { projectId: string; projectName: string };
type Runs = { initialRun: RunStatusView | null; taskRuns: Record<string, RunStatusView | null>; initialStage: string | null };
export type WorkspaceView =
  | { view: "chapters"; props: Base & { genre: string | null; source: { fileName: string; formatLabel: string; byteSize: number; encoding: string | null; importedAt: string } | null; initialChapters: ChapterSummary[] } }
  | { view: "analysis"; props: Base & Runs & { chapters: { id: string; index: number; title: string; charCount: number }[]; profiles: ProfileView[]; tasks: TaskSummary[]; initialProposals: ProposalView[]; initialCounts: Record<string, number>; totalMemory: number; hasMemory: boolean } }
  | { view: "memory"; props: Base & { initialEntries: MemoryEntryView[]; initialCounts: Record<string, number>; initialConflicts: KeyConflict[]; initialKnowledge: KnowledgeView[]; chapters: { id: string; index: number; title: string }[] } }
  | { view: "continuation"; props: Base & Runs & { profiles: ProfileView[]; tasks: TaskSummary[]; initialPlans: ContinuationPlanView[]; hasMemory: boolean } };
export type SettingsView = { profiles: ProfileView[]; encryptionReady: boolean; serverOnly: boolean };
export type ApiErrorBody = { error: string; issues?: { path: string; message: string }[] };
