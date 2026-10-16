import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "运营管理 · 长忆",
  description: "长忆平台独立运营管理端",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
