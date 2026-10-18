import { z } from "zod";

export const DIRECTION_NAME_LIMIT = 300;
export const DIRECTION_SUMMARY_LIMIT = 10000;

export const directionNameSchema = z.string().trim().max(DIRECTION_NAME_LIMIT, "方向名称最多 300 字。");
export const directionSummarySchema = z.string().trim().min(1, "请填写方向说明。")
  .max(DIRECTION_SUMMARY_LIMIT, "方向说明最多 10000 字。");

export const createDirectionSchema = z.object({
  direction: directionNameSchema.default(""),
  summary: directionSummarySchema,
  sourcePlanId: z.string().min(1).optional(),
  select: z.boolean().default(false),
});

export function directionName(name: string, summary: string): string {
  return name.trim() || Array.from(summary.trim().split(/\r?\n/)[0]).slice(0, 30).join("");
}

/** 章纲与正文使用相同的作者要求，避免只传方向名称而遗漏详细构思。 */
export function renderDirection(plan: { direction: string; summary: string | null }): string {
  return [
    `【已选定的续写方向】\n${plan.direction}`,
    ...(plan.summary?.trim() ? [`【方向说明与作者要求】\n${plan.summary.trim()}`] : []),
    "方向说明中的剧情目标、人物选择、节奏和禁用情节均需遵循；其中的未来构思不能当作已经发生的故事事实。",
  ].join("\n\n");
}
