import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
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
  serverExternalPackages: ["@prisma/client", "prisma"],
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
