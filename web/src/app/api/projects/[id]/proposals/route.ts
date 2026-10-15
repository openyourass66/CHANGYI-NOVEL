import { handleError, ok } from "@/lib/api";
import { listProposals, proposalCounts } from "@/lib/ai/proposals";
import type { ProposalState } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const STATES: ProposalState[] = ["pending", "accepted", "rejected", "conflicted"];

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const raw = new URL(request.url).searchParams.get("state");
    const state = raw && STATES.includes(raw as ProposalState) ? (raw as ProposalState) : undefined;
    const [proposals, counts] = await Promise.all([
      listProposals(id, state),
      proposalCounts(id),
    ]);
    return ok({ proposals, counts });
  } catch (error) {
    return handleError(error);
  }
}
