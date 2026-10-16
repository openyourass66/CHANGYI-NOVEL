import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import type { ChatRequest, ChatResult } from "@contracts/api";
import type { DeviceJob } from "@contracts/desktop";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/auth-session";

export const deviceExecution = new AsyncLocalStorage<{ runId: string; deviceId?: string }>();
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** 任务编排和输出校验仍在服务端，本机仅执行模型推理；所有等待均有截止时间。 */
export async function requestDeviceInference(profileId: string, request: ChatRequest): Promise<ChatResult> {
  const context = deviceExecution.getStore();
  if (!context?.deviceId) throw new Error("本地模型需要由启动任务的桌面客户端执行。");
  const job = await prisma.deviceInference.create({ data: { runId: context.runId, deviceId: context.deviceId, profileId, requestJson: JSON.stringify(request), expiresAt: new Date(Date.now() + 180_000) } });
  try {
    for (;;) {
      const current = await prisma.deviceInference.findUnique({ where: { id: job.id }, include: { run: { select: { status: true } } } });
      if (!current || current.run.status === "canceled" || current.status === "canceled") throw new Error("任务已取消。");
      if (current.status === "completed" && current.responseJson) return JSON.parse(current.responseJson) as ChatResult;
      if (current.status === "failed") throw new Error(current.error ?? "本机模型执行失败。");
      if (Date.now() >= current.expiresAt.getTime()) throw new Error("本机模型执行超时；请保持启动任务的桌面客户端在线，再恢复任务。");
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  } finally {
    // 推理内容已进入领域校验流程，不额外长期保存完整模型消息副本。
    await prisma.deviceInference.deleteMany({ where: { id: job.id } });
  }
}

export async function claimDeviceInference(userId: string, deviceId: string): Promise<DeviceJob | null> {
  await prisma.deviceInference.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
  const job = await prisma.deviceInference.findFirst({ where: { deviceId, status: "pending", expiresAt: { gt: new Date() }, run: { status: "running", project: { ownerId: userId } } }, orderBy: { createdAt: "asc" } });
  if (!job) return null;
  const leaseToken = randomBytes(32).toString("hex");
  const changed = await prisma.deviceInference.updateMany({ where: { id: job.id, status: "pending", run: { status: "running", project: { ownerId: userId } } }, data: { status: "claimed", leaseTokenHash: hash(leaseToken) } });
  if (!changed.count) return null;
  return { id: job.id, runId: job.runId, profileId: job.profileId, request: JSON.parse(job.requestJson), leaseToken };
}

export async function finishDeviceInference(userId: string, id: string, input: { deviceId: string; leaseToken: string; result?: ChatResult; error?: string }) {
  const changed = await prisma.deviceInference.updateMany({ where: { id, deviceId: input.deviceId, leaseTokenHash: hash(input.leaseToken), status: "claimed", expiresAt: { gt: new Date() }, run: { status: "running", project: { ownerId: userId } } }, data: {
    status: input.result ? "completed" : "failed", responseJson: input.result ? JSON.stringify(input.result) : null,
    // 不接收设备自由文本作为服务日志/错误，避免携带模型正文或密钥。
    error: input.result ? null : "本机模型调用失败，请检查当前设备配置和模型连接后恢复任务。", requestJson: "{}", leaseTokenHash: null,
  } });
  if (!changed.count) throw new AccessError("推理任务不存在、已过期或已经处理。", 409);
}
