import { invoke, isTauri } from "@tauri-apps/api/core";
import type { parseDocument } from "./import/parse";
import { notify } from "@/components/operation-prompt";

type NativeResponse = { status: number; body: unknown };
type ParsedDocument = Awaited<ReturnType<typeof parseDocument>>;

export async function api<T>(path: string, method = "GET", body: unknown = null): Promise<T> {
  if (!isTauri()) throw new Error("请通过桌面开发命令启动应用，浏览器预览无法访问本机工作区。");
  const response = await invoke<NativeResponse>("api_request", { request: { path, method, body } });
  if (response.status >= 400) throw new Error((response.body as { error?: string }).error ?? "操作失败。");
  return response.body as T;
}

export function parseFile(file: File): Promise<ParsedDocument> {
  // PDF.js 的显示层依赖 DOM，由主线程调用；PDF 解析仍由其专用 Worker 执行。
  if (/\.pdf$/i.test(file.name)) {
    return import("./import/parse").then(async ({ parseDocument }) => parseDocument(new Uint8Array(await file.arrayBuffer()), file.name));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./import/worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("文档解析超时，请检查文件大小和内容。")); }, 180_000);
    const cleanup = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = (event: MessageEvent<{ ok: boolean; value: ParsedDocument; error?: string }>) => {
      cleanup();
      if (event.data.ok) resolve(event.data.value);
      else reject(new Error(event.data.error ?? "文档解析失败。"));
    };
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || "文档解析线程启动失败。")); };
    void file.arrayBuffer().then((bytes) => worker.postMessage({ bytes, fileName: file.name }, [bytes])).catch((error: unknown) => { cleanup(); reject(error); });
  });
}

export function encodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** 只适配旧界面的站内 API；静态资源和外部 URL 仍使用原生 fetch。 */
export function installBridge() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return originalFetch(input, init);
    try {
      let body: unknown = null;
      if (init?.body instanceof FormData) {
        if (url.pathname.endsWith("/memory/import")) {
          const files = init.body.getAll("files");
          if (!files.every((file): file is File => file instanceof File)) throw new Error("请选择记忆文件。");
          const { parseMemoryFiles } = await import("./memory-import");
          const match = /^\/api\/projects\/([^/]+)\/memory\/import$/.exec(url.pathname);
          if (!match) throw new Error("导入路径无效。");
          body = await parseMemoryFiles(match[1], files);
        } else {
          const file = init.body.get("file");
          if (!(file instanceof File)) throw new Error("请选择文件。");
          if (file.size > 50 * 1024 * 1024) throw new Error("单文件不得超过 50MB。");
          if (url.pathname.endsWith("/import")) {
            body = { ...await parseFile(file), bytes: encodeBytes(new Uint8Array(await file.arrayBuffer())) };
          } else { body = JSON.parse(await file.text()); }
        }
      } else if (typeof init?.body === "string") { body = JSON.parse(init.body); }
      const value = await api(url.pathname + url.search, init?.method ?? "GET", body);
      return Response.json(value);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  };
  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor) return;
    const url = new URL(anchor.href);
    const match = /^\/api\/projects\/([^/]+)\/(export|memory\/export)$/.exec(url.pathname);
    if (url.origin !== location.origin || !match) return;
    event.preventDefault();
    const format = match[2] === "memory/export" ? "memory-md" : url.searchParams.get("format") ?? "json";
    if (format === "json") notify.info("项目 JSON 用于恢复单个项目。", { description: "不包含独立作品库、自动流程、全局设置和模型配置。完整备份请关闭应用后复制整个数据文件夹，包括隐藏的 .changyi-storage.json；阅读进度与样式保存在当前设备。" });
    void invoke("save_export", { projectId: match[1], format }).catch((error: unknown) => {
      notify.error(String(error));
    });
  });
}
