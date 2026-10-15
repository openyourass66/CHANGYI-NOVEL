import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-session";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { LOCAL_PROVIDERS, MODEL_PROVIDER, type ModelProvider } from "@/lib/domain";

const providerValues = Object.keys(MODEL_PROVIDER) as [ModelProvider, ...ModelProvider[]];

export const profileInputSchema = z.object({
  name: z.string().trim().min(1, "请填写名称").max(80),
  provider: z.enum(providerValues),
  model: z.string().trim().min(1, "请填写模型名").max(120),
  baseUrl: z.string().trim().url("服务地址格式不正确").max(300).optional().or(z.literal("")),
  apiKey: z.string().trim().max(400).optional(),
  isLocal: z.boolean().optional(),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

/** 对外暴露的档案视图：绝不包含明文或密文密钥。 */
export type ProfileView = {
  id: string;
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string | null;
  isLocal: boolean;
  isDefault: boolean;
  hasKey: boolean;
  maskedKey: string | null;
  statusNote: string | null;
  lastCheckedAt: string | null;
  updatedAt: string;
};

export function resolveIsLocal(provider: ModelProvider, explicit?: boolean): boolean {
  return LOCAL_PROVIDERS.includes(provider) || explicit === true;
}

function toView(p: {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  isLocal: boolean;
  isDefault: boolean;
  statusNote: string | null;
  lastCheckedAt: Date | null;
  updatedAt: Date;
}): ProfileView {
  let masked: string | null = null;
  if (p.apiKeyEncrypted) {
    try {
      masked = maskSecret(decryptSecret(p.apiKeyEncrypted));
    } catch {
      masked = "••••••(无法解密)";
    }
  }
  return {
    id: p.id,
    name: p.name,
    provider: p.provider as ModelProvider,
    model: p.model,
    baseUrl: p.baseUrl,
    isLocal: p.isLocal,
    isDefault: p.isDefault,
    hasKey: Boolean(p.apiKeyEncrypted),
    maskedKey: masked,
    statusNote: p.statusNote,
    lastCheckedAt: p.lastCheckedAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listProfiles(): Promise<ProfileView[]> {
  const user = await requireUser();
  const rows = await prisma.modelProfile.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  return rows.map(toView);
}

export async function getProfile(id: string) {
  const user = await requireUser();
  return prisma.modelProfile.findFirst({ where: { id, userId: user.id } });
}

export async function createProfile(input: ProfileInput): Promise<ProfileView> {
  const user = await requireUser();
  const isLocal = resolveIsLocal(input.provider, input.isLocal);
  if (!isLocal && !input.apiKey?.trim()) {
    throw new Error("该供应商需要 API 密钥。");
  }
  const encrypted = input.apiKey?.trim() ? encryptSecret(input.apiKey.trim()) : null;

  const count = await prisma.modelProfile.count({ where: { userId: user.id } });
  const profile = await prisma.modelProfile.create({
    data: {
      userId: user.id,
      executionLocation: isLocal ? "device" : "server",
      name: input.name,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl?.trim() || null,
      apiKeyEncrypted: encrypted,
      isLocal,
      isDefault: count === 0,
    },
  });
  return toView(profile);
}

export async function updateProfile(
  id: string,
  input: Partial<ProfileInput> & { clearApiKey?: boolean },
): Promise<ProfileView> {
  const existing = await getProfile(id);
  if (!existing) throw new Error("档案不存在。");

  const provider = (input.provider ?? existing.provider) as ModelProvider;
  const isLocal = resolveIsLocal(provider, input.isLocal);

  let apiKeyEncrypted = existing.apiKeyEncrypted;
  if (input.clearApiKey) {
    apiKeyEncrypted = null;
  } else if (input.apiKey?.trim()) {
    apiKeyEncrypted = encryptSecret(input.apiKey.trim());
  }
  if (!isLocal && !apiKeyEncrypted) {
    throw new Error("该供应商需要 API 密钥。");
  }

  const profile = await prisma.modelProfile.update({
    where: { id },
    data: {
      name: input.name ?? existing.name,
      provider,
      model: input.model ?? existing.model,
      baseUrl:
        input.baseUrl === undefined ? existing.baseUrl : input.baseUrl.trim() || null,
      apiKeyEncrypted,
      isLocal,
      executionLocation: isLocal ? "device" : "server",
    },
  });
  return toView(profile);
}

export async function deleteProfile(id: string): Promise<void> {
  const user = await requireUser();
  const existing = await getProfile(id);
  if (!existing) return;
  await prisma.modelProfile.delete({ where: { id } });
  if (existing.isDefault) {
    const next = await prisma.modelProfile.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } });
    if (next) {
      await prisma.modelProfile.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }
}

export async function setDefaultProfile(id: string): Promise<void> {
  const user = await requireUser();
  if (!(await getProfile(id))) throw new Error("档案不存在。");
  await prisma.$transaction([
    prisma.modelProfile.updateMany({ where: { userId: user.id }, data: { isDefault: false } }),
    prisma.modelProfile.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

/** 记录一次连接测试结果（供设置页展示）。 */
export async function recordProfileCheck(
  id: string,
  ok: boolean,
  note: string,
): Promise<ProfileView> {
  if (!(await getProfile(id))) throw new Error("档案不存在。");
  const profile = await prisma.modelProfile.update({
    where: { id },
    data: { statusNote: `${ok ? "✓ 正常" : "✗ 失败"}：${note}`.slice(0, 200), lastCheckedAt: new Date() },
  });
  return toView(profile);
}

/** 仅服务端调用：取出明文密钥用于请求，绝不经由 API 返回客户端。 */
export async function resolveApiKey(id: string): Promise<string | null> {
  const p = await getProfile(id);
  if (!p?.apiKeyEncrypted) return null;
  return decryptSecret(p.apiKeyEncrypted);
}
