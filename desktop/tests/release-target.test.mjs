import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runtimeServerURL, validateReleaseTarget } from "../electron/release-target.mjs";
const servers=JSON.parse(readFileSync(new URL("../config/servers.json",import.meta.url),"utf8"));
const development={channel:"development",serverURL:servers.development};
test("installed builds always use the fixed release target",()=>{
  assert.equal(runtimeServerURL(development,{isPackaged:true,smoke:true,testURL:"http://127.0.0.1:9999"}),"http://192.168.150.102:3000");
  assert.equal(runtimeServerURL(development,{isPackaged:false,testURL:"http://127.0.0.1:9999"}),servers.development);
  assert.equal(runtimeServerURL(development,{isPackaged:false,smoke:true,testURL:"http://127.0.0.1:9999"}),"http://127.0.0.1:9999");
  assert.throws(()=>runtimeServerURL(development,{isPackaged:false,smoke:true,testURL:"https://untrusted.example"}),/本机测试/);
});
test("production builds require an explicit HTTPS cloud target",()=>{
  assert.throws(()=>validateReleaseTarget({channel:"production",serverURL:servers.production}),/云服务器地址/);
  assert.throws(()=>validateReleaseTarget({channel:"production",serverURL:"http://192.168.150.102:3000"}),/HTTPS/);
  assert.throws(()=>validateReleaseTarget({channel:"other",serverURL:"https://api.example.com"}),/发布渠道/);
  const target={channel:"production",serverURL:"https://api.example.com"};
  assert.equal(runtimeServerURL(target,{isPackaged:true,testURL:servers.development}),target.serverURL);
});
