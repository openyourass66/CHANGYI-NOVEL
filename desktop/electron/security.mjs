import net from "node:net";
export function normalizeServerURL(value) {
  const url = new URL(value);
  const host = url.hostname;
  const privateHost = host === "localhost" || host === "[::1]" || (net.isIPv4(host) && (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)));
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && privateHost))) throw new Error("服务地址需要 HTTPS；本机和私有网络自测可使用 HTTP，地址不能包含路径或凭据。");
  return url.origin;
}
export function apiURL(server, path) {
  if (typeof path !== "string" || !path.startsWith("/api/v1/") || /[\\#\r\n]/.test(path) || /%(?:2f|5c|2e)/i.test(path)) throw new Error("API 路径无效。");
  const url = new URL(path, normalizeServerURL(server));
  if (url.origin !== server || !url.pathname.startsWith("/api/v1/")) throw new Error("API 路径无效。");
  return url;
}
export function localURL(value, provider) {
  const url = new URL(value || (provider === "ollama" ? "http://127.0.0.1:11434/v1" : "http://127.0.0.1:1234/v1"));
  if (!["http:","https:"].includes(url.protocol) || !["127.0.0.1","localhost","[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error("本地模型仅允许当前电脑的 localhost、127.0.0.1 或 ::1 地址。");
  return url.href.replace(/\/+$/, "");
}
export function validateChat(request) {
  if (!request || !Array.isArray(request.messages) || request.messages.length > 100 || !request.messages.length || request.messages.some(m => !["system","user","assistant"].includes(m.role) || typeof m.content !== "string") || JSON.stringify(request).length > 8_000_000) throw new Error("模型请求无效或过大。");
  if (request.maxTokens !== undefined && (!Number.isInteger(request.maxTokens) || request.maxTokens < 1 || request.maxTokens > 131072)) throw new Error("输出长度无效。");
  if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) throw new Error("采样参数无效。");
}
