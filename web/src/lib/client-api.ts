import type {} from "@contracts/desktop";

/** 所有界面请求经过这一入口。浏览器使用同源 Cookie，桌面凭据仅由原生进程持有。 */
export const apiFetch: typeof fetch = async (input, init) => {
  if (typeof window === "undefined" || !window.changyi) return fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input), "https://desktop.local");
  if (url.origin !== "https://desktop.local" && url.origin !== window.location.origin) throw new Error("请求目标无效。");
  if (!url.pathname.startsWith("/api/")) throw new Error("仅支持工作台 API 请求。");
  const pathname = url.pathname.startsWith("/api/v1/") ? url.pathname : url.pathname.replace(/^\/api\//, "/api/v1/");
  const request = new Request(`https://desktop.local${pathname}${url.search}`, input instanceof Request ? input : undefined);
  const merged = new Request(request, init);
  if (merged.signal.aborted) throw new DOMException("请求已取消。", "AbortError");
  const result = await window.changyi.request({ path: pathname + url.search, method: merged.method,
    headers: Object.fromEntries(merged.headers), body: ["GET", "HEAD"].includes(merged.method) ? undefined : await merged.arrayBuffer(),
  });
  if (merged.signal.aborted) throw new DOMException("请求已取消。", "AbortError");
  return new Response([204,205,304].includes(result.status) ? null : result.body, { status: result.status, headers: result.headers });
};

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error ?? "请求失败，请重试。"), { status: response.status });
  return body as T;
}
