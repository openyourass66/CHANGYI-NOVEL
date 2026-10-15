import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Run interactively on the VM. Credentials never enter command arguments or logs.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Please run this command in an interactive terminal (-it).");
  process.exit(1);
}
let hidden = false;
const output = new Writable({
  write(chunk, encoding, done) {
    if (!hidden) process.stdout.write(chunk, encoding);
    done();
  },
});
const terminal = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
terminal.on("SIGINT", () => { terminal.close(); process.exit(130); });
async function ask(prompt, fallback = "", secret = false) {
  process.stdout.write(`${prompt}${fallback ? ` [${fallback}]` : ""}: `);
  hidden = secret;
  try { return (await terminal.question("")).trim() || fallback; }
  finally { hidden = false; if (secret) process.stdout.write("\n"); }
}
try {
  const file = ".env.vm";
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Expected a regular .env.vm file.");
  const existing = await readFile(file, "utf8");
  const host = await ask("SMTP host", "smtp.163.com");
  const port = await ask("SMTP port", "465");
  const user = await ask("Sender email");
  const password = await ask("SMTP client authorization code (hidden)", "", true);
  if (!host || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || !password) {
    throw new Error("Invalid SMTP settings; .env.vm was not changed.");
  }
  const values = { SMTP_HOST: host, SMTP_PORT: port, SMTP_SECURE: port === "465" ? "true" : "false", SMTP_USER: user, SMTP_PASSWORD: password, SMTP_FROM: user };
  let contents = existing;
  for (const [key, value] of Object.entries(values)) {
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error("Control characters are not allowed.");
    // Compose dotenv: JSON quoting handles backslashes; $$ preserves literal $.
    const line = `${key}=${JSON.stringify(value.replaceAll("$", "$$"))}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
  console.log("SMTP settings saved privately in .env.vm. No credentials were printed.");
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("Invalid SMTP") ? error.message : "Unable to configure SMTP; check the local file and input.");
  process.exitCode = 1;
} finally {
  terminal.close();
}
