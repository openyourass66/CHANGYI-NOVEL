import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  base: "./", plugins: [react(), tailwindcss(), { name: "desktop-dev-csp", apply: "serve", transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173") }],
  resolve: { alias: [
    { find: "next/link", replacement: here("./src/link.tsx") },
    { find: "next/navigation", replacement: here("./src/navigation.tsx") },
    { find: "@", replacement: here("../web/src") },
    { find: "@contracts", replacement: here("../packages/contracts/src") },
    { find: /^react$/, replacement: here("./node_modules/react") },
    { find: /^react-dom$/, replacement: here("./node_modules/react-dom") },
  ], dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", strictPort: true, port: 5173, fs: { allow: [here("..") ] } },
});
