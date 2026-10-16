import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
export async function createVault(directory, encryption) {
  if (!encryption.isEncryptionAvailable()) throw new Error("Windows 安全凭据存储不可用，无法保存会话。请检查系统后重试。");
  const file = path.join(directory,"credentials.bin");
  let state = {serverURL:"", deviceId:randomUUID(), servers:{}};
  try { state = JSON.parse(encryption.decryptString(await readFile(file))); } catch(error) { if(error.code !== "ENOENT") throw new Error("无法解密本机凭据，请恢复当前 Windows 用户的凭据文件。"); }
  let writes = Promise.resolve();
  return { state, save() {
    const bytes = encryption.encryptString(JSON.stringify(state));
    writes = writes.catch(()=>{}).then(async()=>{
      await mkdir(directory,{recursive:true});
      const temporary=file+"."+randomUUID()+".tmp";
      await writeFile(temporary,bytes,{mode:0o600}); await rename(temporary,file);
    });
    return writes;
  } };
}
