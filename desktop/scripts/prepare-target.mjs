import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateReleaseTarget } from "../electron/release-target.mjs";

export function prepareTarget({ channel = process.env.CHANGYI_BUILD_CHANNEL ?? "development", productionURL = process.env.CHANGYI_PRODUCTION_SERVER_URL } = {}) {
  const servers = JSON.parse(readFileSync(new URL("../config/servers.json", import.meta.url), "utf8"));
  const target = validateReleaseTarget({ channel, serverURL: channel === "production" ? productionURL || servers.production : servers.development });
  const directory = new URL("../runtime/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL("server-target.json", directory), JSON.stringify(target, null, 2) + "\n");
  console.log(`Client build target: ${target.channel} (${target.serverURL})`);
  return target;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) prepareTarget();
