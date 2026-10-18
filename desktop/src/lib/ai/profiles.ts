import type { ModelProvider } from "@/lib/domain";

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
