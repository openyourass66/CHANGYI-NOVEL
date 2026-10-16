import type { ChatRequest, ChatResult } from "./api";
import type { ModelProvider } from "./domain";
// ModelProvider is a domain value; the bridge never carries account session tokens.
export type LocalProfileInput = { provider: ModelProvider; model: string; baseUrl: string; apiKey?: string };
export type LocalProfileView = Omit<LocalProfileInput, "apiKey"> & { hasKey: boolean };
export type DesktopConfiguration = { serverURL: string; deviceId: string; version: string };
export type NativeRequest = { path: string; method: string; headers: Record<string,string>; body?: ArrayBuffer };
export type NativeResponse = { status: number; headers: [string,string][]; body: ArrayBuffer };
export type DeviceJob = { id: string; runId: string; profileId: string; request: ChatRequest; leaseToken: string };
export type DesktopBridge = {
  configuration(): Promise<DesktopConfiguration>;
  configure(serverURL: string): Promise<DesktopConfiguration>;
  request(request: NativeRequest): Promise<NativeResponse>;
  localProfile(id: string): Promise<LocalProfileView | null>;
  saveLocalProfile(id: string, input: LocalProfileInput): Promise<void>;
  removeLocalProfile(id: string): Promise<void>;
  infer(id: string, profileId: string, request: ChatRequest): Promise<ChatResult>;
  cancelInference(id: string): Promise<void>;
};
declare global { interface Window { changyi?: DesktopBridge } }
