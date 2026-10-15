import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** 将已知错误转为结构化响应；未知错误保持 500 但不泄露堆栈。 */
export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return fail(first?.message ?? "输入校验失败", 422, {
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    return fail(error.message, typeof status === "number" ? status : 400);
  }
  return fail("服务器内部错误", 500);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
