"use client";
import { forwardRef, type ComponentProps } from "react";
import { notify } from "@/components/operation-prompt";
import { apiFetch } from "@/lib/client-api";
export const DownloadLink = forwardRef<HTMLAnchorElement, ComponentProps<"a">>(function DownloadLink({ href, onClick, ...props }, ref) {
  return <a {...props} ref={ref} href={href} onClick={async (event) => {
    onClick?.(event);
    if (!window.changyi || event.defaultPrevented || !href) return;
    event.preventDefault();
    try {
      const response = await apiFetch(href);
      if (!response.ok) throw new Error("导出失败，请重试。");
      const disposition = response.headers.get("content-disposition") ?? "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const fallback = disposition.match(/filename="?([^";]+)/i)?.[1] ?? "export";
      const link = document.createElement("a");
      const url = URL.createObjectURL(await response.blob());
      link.href = url; link.download = encoded ? decodeURIComponent(encoded) : fallback;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) { notify.error(error instanceof Error ? error.message : "导出失败。"); }
  }} />;
});
