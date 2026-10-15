import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(request: Request) {
  const requestHeaders = new Headers(request.headers);
  // 只供本机自测的共享认证限流桶，不信任客户端传入的转发 IP。
  requestHeaders.set("x-changyi-auth-ip", "127.0.0.1");
  return getAuth().handler(new Request(request, { headers: requestHeaders }));
}

export { handler as GET, handler as POST };
