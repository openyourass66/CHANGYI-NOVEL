import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const builder=createRequire(require.resolve("electron-builder"));
const dependency=createRequire(builder.resolve("app-builder-lib"));
const asar=dependency("@electron/asar");
const archive="release/win-unpacked/resources/app.asar";
const entries=asar.listPackage(archive).map(file=>file.replaceAll("\\","/"));
assert(!entries.some(file=>/\/(?:\.env[^/]*|credentials\.bin|[^/]*\.(?:db|sqlite))$/.test(file)),"安装包混入私有文件");
assert(!entries.some(file=>/\/(?:node_modules|data|\.verify)\//.test(file)||/\/(?:smoke|integration)\.mjs$/.test(file)),"安装包混入依赖、数据或测试入口");
let verifiedFiles=0;
for(const folder of ["electron","dist","runtime"]) {
  for(const file of fs.readdirSync(folder,{recursive:true})){
    if(folder==="electron"&&["smoke.mjs","integration.mjs"].includes(file))continue;
    const name=path.join(folder,file);if(!fs.statSync(name).isFile())continue;
    assert(fs.readFileSync(name).equals(asar.extractFile(archive,name)),`安装包与当前源码/构建不一致：${name}`);verifiedFiles++;
  }
}
const version=JSON.parse(fs.readFileSync("package.json","utf8")).version;
const name=`Changyi-${version}-Setup.exe`,installer=path.join("release",name),bytes=fs.readFileSync(installer);
const sha256=createHash("sha256").update(bytes).digest("hex");
fs.writeFileSync(installer+".sha256",`${sha256}  ${name}\n`);
console.log(JSON.stringify({installer,bytes:bytes.length,sha256,verifiedFiles},null,2));
