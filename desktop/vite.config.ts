import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: "public",
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
    dedupe: ["react", "react-dom", "radix-ui", "next-themes"],
  },
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: [path.resolve(root, "..")] },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  clearScreen: false,
  worker: { format: "es" },
});
