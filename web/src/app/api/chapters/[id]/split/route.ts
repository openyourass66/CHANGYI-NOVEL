import { withAccount } from "@/lib/access";
import { z } from "zod";
import { handleError, ok, readJson } from "@/lib/api";
import { splitChapter } from "@/lib/chapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ atOffset: z.number().int().min(1) });

async function handlePOST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { atOffset } = schema.parse(await readJson(request));
    return ok({ chapters: await splitChapter(id, atOffset) });
  } catch (error) {
    return handleError(error);
  }
}

export const POST = withAccount("chapter", handlePOST);
