import { GET as legacyGET, POST as legacyPOST } from "@/app/api/auth/[...all]/route";
function canonical(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api\/v1\/auth\//, "/api/auth/");
  return new Request(url, request);
}
export const runtime = "nodejs";
export const GET = (request: Request) => legacyGET(canonical(request));
export const POST = (request: Request) => legacyPOST(canonical(request));
