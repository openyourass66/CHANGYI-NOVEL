import "server-only";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
type OssClient = import("ali-oss");

let client: OssClient | undefined;
export function getOssClient() {
  if (client) return client;
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
    throw Object.assign(new Error("头像存储尚未配置，请联系管理员。"), { status: 503 });
  }
  const OSS = require("ali-oss") as typeof import("ali-oss");
  client = new OSS({ region: OSS_REGION, bucket: OSS_BUCKET, endpoint: "https://oss-cn-beijing.aliyuncs.com", accessKeyId: OSS_ACCESS_KEY_ID, accessKeySecret: OSS_ACCESS_KEY_SECRET, secure: true });
  return client;
}
