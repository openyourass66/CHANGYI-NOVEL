import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = new URL("../public/pdfjs/", import.meta.url);
await mkdir(target, { recursive: true });
for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(
    fileURLToPath(new URL(`../node_modules/pdfjs-dist/${folder}/`, import.meta.url)),
    fileURLToPath(new URL(`${folder}/`, target)),
    { recursive: true, filter: (file) => !file.endsWith(".map") },
  );
}
