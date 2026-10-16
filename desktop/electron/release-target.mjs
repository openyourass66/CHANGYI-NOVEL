import { readFileSync } from "node:fs";
import { normalizeServerURL } from "./security.mjs";

export function validateReleaseTarget(target) {
  if (!target || !["development", "production"].includes(target.channel)) throw new Error("客户端发布渠道无效。");
  if (!target.serverURL) throw new Error("生产构建需要指定云服务器地址。");
  const serverURL = normalizeServerURL(target.serverURL);
  if (target.channel === "production" && !serverURL.startsWith("https://")) throw new Error("生产构建的云服务器地址必须使用 HTTPS。");
  return { channel: target.channel, serverURL };
}

export function runtimeServerURL(target, { isPackaged, smoke = false, testURL } = {}) {
  const release = validateReleaseTarget(target);
  if (!isPackaged && smoke && testURL) {
    const url = new URL(normalizeServerURL(testURL));
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("隔离检查仅允许本机测试地址。");
    return url.origin;
  }
  return release.serverURL;
}

export function readReleaseTarget() {
  return validateReleaseTarget(JSON.parse(readFileSync(new URL("../runtime/server-target.json", import.meta.url), "utf8")));
}
