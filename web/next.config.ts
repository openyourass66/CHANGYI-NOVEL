import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  async headers() {
    const adminOrigin = new URL(process.env.ADMIN_CONSOLE_URL ?? "http://localhost:3001").origin;
    const cors = [
      { key: "Access-Control-Allow-Origin", value: adminOrigin },
      { key: "Access-Control-Allow-Credentials", value: "true" },
      { key: "Vary", value: "Origin" },
    ];
    return [
      { source: "/api/admin/:path*", headers: [...cors, { key: "Access-Control-Allow-Methods", value: "GET, PATCH, OPTIONS" }, { key: "Access-Control-Allow-Headers", value: "Content-Type" }] },
      { source: "/api/v1/auth/:path*", headers: [...cors, { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" }, { key: "Access-Control-Allow-Headers", value: "Content-Type" }] },
    ];
  },
  outputFileTracingRoot: path.resolve(process.cwd(), ".."),
  async rewrites() {
    return ["projects", "chapters", "memory", "knowledge", "proposals", "analysis", "model-profiles", "health"].map((resource) => ({
      source: `/api/v1/${resource}/:path*`, destination: `/api/${resource}/:path*`,
    }));
  },
  // Next 会把构建时的 .env 复制到 standalone；只在排除了真实环境文件的镜像中启用。
  output: process.env.NOVEL_STANDALONE_BUILD === "1" ? "standalone" : undefined,
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./.env*", "./.verify/**/*"],
  },
  /* 本地单用户 demo：经典渲染语义（默认静态、按需动态），
     避免 cacheComponents 与直接读写 SQLite 的服务器组件冲突。 */
  cacheComponents: false,
  // Prisma / 解析库仅在服务端使用
  serverExternalPackages: ["@prisma/client", "prisma", "ali-oss"],
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
