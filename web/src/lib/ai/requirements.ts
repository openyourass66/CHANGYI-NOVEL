/**
 * 任务硬前提的展示逻辑。仅供客户端组件使用（只依赖类型），服务端 validate 才是最终兜底。
 */
import type { TaskRequirement } from "@/lib/ai/tasks/registry";

export const REQUIREMENT_HINT: Record<TaskRequirement, string> = {
  memory: "需先完成「逐章抽取」，产出记忆条目",
  plan: "需先生成一个续写方向",
  outline: "该方向还没有章纲，需先「生成章纲」",
  drafts: "该方向还没有草稿，需先「生成草稿」",
};

/** 当前数据是否满足该任务的前提。 */
export function requirementMet(
  requirement: TaskRequirement | null,
  state: { hasMemory: boolean; planCount: number; outlineCount: number; draftCount: number },
): boolean {
  switch (requirement) {
    case null:
      return true;
    case "memory":
      return state.hasMemory;
    case "plan":
      return state.planCount > 0;
    case "outline":
      return state.outlineCount > 0;
    case "drafts":
      return state.draftCount > 0;
  }
}
