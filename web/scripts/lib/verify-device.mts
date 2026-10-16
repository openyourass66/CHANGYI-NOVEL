import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { DeviceJob } from "@contracts/desktop";
type Requester = (route: string, cookie?: string, method?: string, body?: unknown, origin?: string) => Promise<Response>;
export async function verifyDevice(prisma: PrismaClient, request: Requester, cookies: string[], projectId: string, profileId: string) {
  const deviceId = randomUUID();
  const start = async () => {
    const result = await request(`/api/v1/projects/${projectId}/analysis`, cookies[0], "POST", { profileId, deviceId, taskType: "chapter-extract" });
    assert.equal(result.status, 201); return (await result.json()).runId as string;
  };
  const poll = async <T,>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> => {
    for (let i = 0; i < 80; i++) { const value = await read(); if (done(value)) return value; await new Promise(resolve => setTimeout(resolve, 200)); }
    throw new Error("设备推理状态未在限时内变化");
  };
  const claim = async (cookie = cookies[0], device = deviceId): Promise<DeviceJob | null> => {
    const response = await request("/api/v1/device-inferences/claim", cookie, "POST", { deviceId: device }); assert.equal(response.status, 200); return (await response.json()).job;
  };
  const claimNext = async () => { const job = await poll(claim, Boolean); assert(job); return job; };
  const waitStatus = (runId: string, status: string) => poll(() => prisma.analysisRun.findUniqueOrThrow({ where: { id: runId } }), row => row.status === status);
  const result = { text: JSON.stringify({ chapterNote: { summary: "设备推理产生的章节摘要", excerpt: "private text" } }), usage: { totalTokens: 4 } };
  const submit = (job: {id:string;leaseToken:string}, cookie = cookies[0], extra: object = { result }) => request(`/api/v1/device-inferences/${job.id}/result`, cookie, "POST", { deviceId, leaseToken: job.leaseToken, ...extra });
  assert.equal((await request(`/api/v1/projects/${projectId}/analysis/preview`, cookies[0], "POST", { profileId })).status, 200);
  assert.equal((await request(`/api/v1/projects/${projectId}/analysis`, cookies[0], "POST", { profileId })).status, 400, "浏览器不能要求虚拟机访问设备 localhost");
  const first = await start();
  assert.equal(await claim(cookies[1]), null, "其他账号不能领取本机任务");
  assert.equal(await claim(cookies[0], randomUUID()), null, "其他设备不能领取本机任务");
  const job = await claimNext(); assert.equal(job.runId, first); assert.equal(job.profileId, profileId);
  assert(JSON.stringify(job.request).includes("private text"));
  assert.equal((await submit(job, cookies[1])).status, 409);
  assert.equal((await submit({ ...job, leaseToken: "0".repeat(64) })).status, 409);
  assert.equal((await submit(job)).status, 200);
  assert.equal((await submit(job)).status, 409, "设备结果必须单次写入");
  await waitStatus(first, "done");
  assert.equal(await prisma.deviceInference.count({ where: { runId: first } }), 0, "处理后删除推理消息副本");
  assert(await prisma.memoryProposal.count({ where: { runId: first } }) > 0, "设备结果经过服务端校验，写入待审阅提案");
  const canceled = await start(); const cancelJob = await claimNext();
  assert.equal((await request(`/api/v1/analysis/${canceled}/cancel`, cookies[0], "POST", {})).status, 200);
  assert.equal((await submit(cancelJob)).status, 409);
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal((await prisma.analysisRun.findUniqueOrThrow({ where: { id: canceled } })).status, "canceled", "取消状态不得被运行器错误覆盖");
  const retry = await start(); const failedJob = await claimNext();
  assert.equal((await submit(failedJob, cookies[0], { error: "test connection failure" })).status, 200);
  await waitStatus(retry, "failed");
  assert.equal((await request(`/api/v1/analysis/${retry}/resume`, cookies[0], "POST", {})).status, 200);
  const resumedJob = await claimNext(); assert.equal(resumedJob.runId, retry);
  assert.equal((await submit(resumedJob)).status, 200);
  await waitStatus(retry, "done");
}
