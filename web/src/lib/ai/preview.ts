import type { RunPreview } from "@contracts/api";
export type { RunPreview } from "@contracts/api";
import "server-only";
import { prisma } from "@/lib/db";
import { MODEL_PROVIDER } from "@/lib/domain";
import { resolveProfile } from "@/lib/ai/client";
import { AnalysisError } from "@/lib/ai/errors";
import { getTask } from "@/lib/ai/tasks/registry";
import type { RunPayload } from "@/lib/ai/tasks/types";



/**
 * 预览「将发送什么」，不发起任何请求。云端档案据此向用户展示数据流并请求授权。
 */
export async function previewRun(
  projectId: string,
  opts: { payload?: RunPayload; chapterIds?: string[]; taskType: string; profileId: string },
): Promise<RunPreview> {
  const project = await prisma.novelProject.findUnique({ where: { id: projectId }, select: { ownerId: true } });
  if (!project?.ownerId) throw new AnalysisError("项目不存在。", 404);
  const profile = await resolveProfile(opts.profileId, project.ownerId, true);
  const task = getTask(opts.taskType);

  const payload: RunPayload =
    !opts.payload?.chapterIds && opts.chapterIds && opts.chapterIds.length > 0
      ? { ...(opts.payload ?? {}), chapterIds: opts.chapterIds }
      : (opts.payload ?? {});

  const ctx = { projectId, payload };
  const units = await task.listUnits(ctx);
  if (units.length === 0) {
    throw new AnalysisError(task.scope === "chapter" ? "没有可分析的章节。" : "没有可处理的单元。");
  }
  const desc = await task.describe(ctx);

  return {
    taskType: task.type,
    taskLabel: task.label,
    provider: profile.provider,
    providerLabel: MODEL_PROVIDER[profile.provider] ?? profile.provider,
    model: profile.model,
    isLocal: profile.isLocal,
    unitCount: desc.unitCount,
    unitLabel: desc.unitLabel,
    totalChars: desc.totalChars,
    // 粗略估算：每条提示的系统说明与结构描述开销约 900 字，加上正文。
    estimatedPromptChars: desc.totalChars + units.length * 900,
    sampleText: desc.sampleText,
    note: desc.note,
  };
}
