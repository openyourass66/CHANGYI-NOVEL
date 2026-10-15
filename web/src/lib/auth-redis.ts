import "server-only";
import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | undefined;
let connecting: Promise<void> | undefined;

async function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("请配置 REDIS_URL 连接认证 Redis。");

  if (!client) {
    client = createClient({ url });
    client.on("error", () => {});
  }
  if (!client.isOpen) {
    connecting ??= client.connect().then(() => undefined).finally(() => { connecting = undefined; });
    await connecting;
  }
  return client;
}

const keyFor = (key: string) => `${process.env.AUTH_REDIS_PREFIX ?? "changyi:auth"}:${key}`;

export const authRedisStorage = {
  async get(key: string) {
    return (await getRedisClient()).get(keyFor(key));
  },
  async getAndDelete(key: string) {
    const result = await (await getRedisClient()).eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      { keys: [keyFor(key)], arguments: [] },
    );
    return typeof result === "string" ? result : null;
  },
  async set(key: string, value: string, ttl?: number) {
    const redis = await getRedisClient();
    if (ttl && ttl > 0) await redis.set(keyFor(key), value, { EX: Math.ceil(ttl) });
    else await redis.set(keyFor(key), value);
  },
  async delete(key: string) {
    await (await getRedisClient()).del(keyFor(key));
  },
  async increment(key: string, ttl: number) {
    const result = await (await getRedisClient()).eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
      { keys: [keyFor(key)], arguments: [String(Math.ceil(ttl))] },
    );
    return Number(result);
  },
};
