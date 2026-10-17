import { parseDocument } from "./parse";

self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; fileName: string }>) => {
  try {
    const { bytes, fileName } = event.data;
    self.postMessage({ ok: true, value: await parseDocument(new Uint8Array(bytes), fileName) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "文档解析失败。" });
  }
};
