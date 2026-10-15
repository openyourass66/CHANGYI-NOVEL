import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 本地单用户 demo：经典渲染语义（默认静态、按需动态），
     避免 cacheComponents 与直接读写 SQLite 的服务器组件冲突。 */
  cacheComponents: false,
  // Prisma / 解析库仅在服务端使用
  serverExternalPackages: ["@prisma/client", "prisma"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
