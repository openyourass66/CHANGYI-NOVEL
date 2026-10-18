/** 只允许返回站内项目页面，同时保留项目子页及查询条件。 */
export function projectReturnPath(value: string | null): string | null {
  if (!value?.startsWith("/projects/") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://changyi.local");
    if (url.origin !== "https://changyi.local" || !/^\/projects\/[^/]+(?:\/|$)/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}
