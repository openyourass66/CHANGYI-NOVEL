import { spawn } from "node:child_process";
import { createServer } from "vite";
import { prepareTarget } from "./prepare-target.mjs";
prepareTarget();
const server=await createServer();await server.listen();
const env={...process.env,CHANGYI_DEV_URL:"http://127.0.0.1:5173"};delete env.ELECTRON_RUN_AS_NODE;
const {default:electron}=await import("electron");
const child=spawn(electron,["."],{env,stdio:"inherit",windowsHide:true});
async function close(code=0){child.kill();await server.close();process.exit(code);}
child.on("exit",code=>void close(code??0));process.on("SIGINT",()=>void close());process.on("SIGTERM",()=>void close());
