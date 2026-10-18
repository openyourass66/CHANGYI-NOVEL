import type { TaskScope } from "./types";

export type TaskRequirement = "memory" | "plan" | "outline" | "drafts";

export type TaskSummary = {
  type: string;
  label: string;
  scope: TaskScope;
  unitLabel: string;
  description: string;
  requirement: TaskRequirement | null;
};
