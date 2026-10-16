import { createServer, type Socket } from "node:net";

/** 隔离验证专用 RESP2 测试替身；不替代部署环境的真实 Redis 联调。 */
export async function startRedisFixture() {
  const values = new Map<string, { value: string; expires: number }>();
  const sockets = new Set<Socket>();
  const get = (key: string) => { const row = values.get(key); if (row && row.expires <= Date.now()) values.delete(key); return values.get(key)?.value ?? null; };
  function command(args: string[]): string | number | null {
    const [raw, key, value, ...rest] = args; const name = raw.toUpperCase();
    if (name === "CLIENT" || name === "SELECT" || name === "QUIT") return "OK";
    if (name === "PING") return "PONG";
    if (name === "GET") return get(key);
    if (name === "SET") { const ex = rest.findIndex(v => v.toUpperCase() === "EX"); values.set(key, { value, expires: ex < 0 ? Infinity : Date.now() + Number(rest[ex + 1]) * 1000 }); return "OK"; }
    if (name === "DEL") return values.delete(key) ? 1 : 0;
    if (name === "EVAL") {
      const target = args[3];
      if (key.includes("INCR")) { const count = Number(get(target) ?? "0") + 1; const expires = count === 1 ? Date.now() + Number(args[4]) * 1000 : values.get(target)!.expires; values.set(target, { value: String(count), expires }); return count; }
      if (key.includes("GET") && key.includes("DEL")) { const found = get(target); values.delete(target); return found; }
    }
    throw new Error(`Redis 测试替身不支持 ${name}`);
  }
  function parse(buffer: Buffer): { args: string[]; consumed: number } | null {
    const first = buffer.indexOf("\r\n"); if (first < 0) return null;
    if (buffer[0] !== 42) throw new Error("需要 RESP 数组");
    const count = Number(buffer.subarray(1, first).toString()); let cursor = first + 2; const args: string[] = [];
    for (let i = 0; i < count; i++) { const end = buffer.indexOf("\r\n", cursor); if (end < 0) return null; const length = Number(buffer.subarray(cursor + 1, end).toString()); if (buffer.length < end + 2 + length + 2) return null; args.push(buffer.subarray(end + 2, end + 2 + length).toString()); cursor = end + 2 + length + 2; }
    return { args, consumed: cursor };
  }
  const server = createServer(socket => {
    socket.on("error", () => {});
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); let pending: Buffer = Buffer.alloc(0);
    socket.on("data", chunk => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        const request = parse(pending); if (!request) break; pending = pending.subarray(request.consumed);
        try { const result = command(request.args); socket.write(result === null ? "$-1\r\n" : typeof result === "number" ? `:${result}\r\n` : `$${Buffer.byteLength(result)}\r\n${result}\r\n`); }
        catch { socket.write("-ERR unsupported fixture command\r\n"); }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("测试 Redis 未启动");
  return { url: `redis://127.0.0.1:${address.port}`, stop: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
