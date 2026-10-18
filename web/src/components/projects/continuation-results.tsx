"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ISSUE_SEVERITY, ISSUE_STATUS, MEMORY_CATEGORY, type IssueStatus } from "@/lib/domain";
import type { ContinuityIssueView, DraftChapterView } from "@/lib/continuation-view";
import type { ProposalView } from "@/lib/ai/types";

const PROPOSAL_STATES = { pending: "待处理", accepted: "已采纳", rejected: "已忽略", conflicted: "需处理冲突" } as const;

export function ContinuationResults({ projectId, planId, drafts, kind, reloadKey, loadingDrafts, draftsError, disabled, onRefresh }: {
  projectId: string;
  planId: string | null;
  drafts: DraftChapterView[];
  kind: "continuity" | "memory";
  reloadKey: number;
  loadingDrafts: boolean;
  draftsError: string | null;
  disabled: boolean;
  onRefresh: () => void;
}) {
  const [issues, setIssues] = useState<ContinuityIssueView[]>([]);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [state, setState] = useState<keyof typeof PROPOSAL_STATES>("pending");
  const requestKey = JSON.stringify([projectId, planId, kind, reloadKey]);
  const loading = Boolean(planId) && loadedKey !== requestKey;

  useEffect(() => {
    if (!planId) return;
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/${kind === "continuity" ? "issues" : "proposals"}`, { cache: "no-store" });
        const data = await response.json() as { issues?: ContinuityIssueView[]; proposals?: ProposalView[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "结果加载失败");
        if (active) { setIssues(data.issues ?? []); setProposals(data.proposals ?? []); setLoadError(null); setError(null); }
      } catch (error) { if (active) setLoadError(error instanceof Error ? error.message : "结果加载失败"); }
      finally { if (active) setLoadedKey(requestKey); }
    })();
    return () => { active = false; };
  }, [projectId, planId, kind, requestKey]);

  const draftIds = new Set(drafts.filter((draft) => draft.planId === planId).map((draft) => draft.id));
  const scopedIssues = issues.filter((issue) => issue.draftId && draftIds.has(issue.draftId));
  const scopedProposals = proposals.filter((proposal) => proposal.draftId && draftIds.has(proposal.draftId));
  const draftLabel = (id: string | null) => {
    const draft = drafts.find((draft) => draft.id === id);
    return draft ? `第 ${draft.index} 章 · ${draft.title || "（无标题）"}` : "来源草稿";
  };

  async function updateIssue(id: string, status: IssueStatus) {
    setActing(id); setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await response.json() as { issue?: ContinuityIssueView; error?: string };
      if (!response.ok || !data.issue) throw new Error(data.error ?? "问题处理失败");
      setIssues((previous) => previous.map((issue) => issue.id === id ? data.issue! : issue));
    } catch (error) { setError(error instanceof Error ? error.message : "问题处理失败"); }
    finally { setActing(null); }
  }

  async function handleProposal(id: string, action: "accept" | "reject") {
    setActing(id); setError(null);
    try {
      const response = await fetch(`/api/proposals/${id}/${action}`, { method: "POST" });
      const data = await response.json() as { proposal?: ProposalView; error?: string };
      if (!response.ok || !data.proposal) throw new Error(data.error ?? "提案处理失败");
      setProposals((previous) => previous.map((proposal) => proposal.id === id ? data.proposal! : proposal));
      if (data.proposal.state === "conflicted") setState("conflicted");
    } catch (error) { setError(error instanceof Error ? error.message : "提案处理失败"); }
    finally { setActing(null); }
  }

  const waiting = loading || loadingDrafts;
  return <Card aria-label={kind === "continuity" ? "连续性检查结果" : "记忆变化结果"}>
    <CardContent className="space-y-4 py-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">{kind === "continuity" ? "连续性检查结果" : "本次草稿的记忆提案"}</h2>
        <Button variant="outline" size="sm" disabled={waiting || Boolean(acting)} onClick={onRefresh}>刷新</Button>
      </div>
      {(error || draftsError || loadError) && <p role="alert" className="text-sm text-destructive">{draftsError || loadError || error}</p>}
      {!planId ? <p className="text-sm text-muted-foreground">请先在「确定续写方向」中添加方向。</p>
        : waiting ? <p role="status" className="text-sm text-muted-foreground">正在加载结果…</p>
        : draftsError || loadError ? null
        : !drafts.length ? <p className="text-sm text-muted-foreground">这个方向尚无草稿，请先完成「生成草稿」。</p>
        : kind === "continuity" ? <>
          <p className="text-sm text-muted-foreground">已检查 {drafts.filter((draft) => draft.continuityCheckedAt).length} / {drafts.length} 章，{scopedIssues.filter((issue) => issue.status === "open").length} 处待处理</p>
          {!scopedIssues.length && <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">{drafts.every((draft) => draft.continuityCheckedAt) ? "检查完成，未发现明确冲突。" : "尚无检查问题。运行本步骤后将在这里显示问题与证据。"}</p>}
          {scopedIssues.map((issue) => <article key={issue.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{draftLabel(issue.draftId)}</span>
              <Badge variant="outline">{issue.category}</Badge><Badge variant="outline">{ISSUE_SEVERITY[issue.severity]}</Badge><Badge variant="secondary">{ISSUE_STATUS[issue.status]}</Badge>
            </div>
            <p className="whitespace-pre-wrap text-sm">{issue.description}</p>
            {issue.evidence.length > 0 && <div className="space-y-2 border-l-2 pl-3 text-sm text-muted-foreground">
              <p className="text-xs font-medium">对应证据</p>
              {issue.evidence.map((evidence, index) => <div key={index} className="space-y-1">
                <p className="text-xs">{evidence.kind === "draft" ? "草稿片段" : evidence.kind === "memory" ? "记忆依据" : "原文依据"}</p>
                {evidence.excerpt && <blockquote className="whitespace-pre-wrap">{evidence.excerpt}</blockquote>}
                {evidence.entryId && <Link className="underline" href={`/projects/${projectId}/memory?entry=${evidence.entryId}`}>查看对应记忆</Link>}
                {evidence.chapterId && <Link className="underline" href={`/projects/${projectId}`}>查看原文章节</Link>}
              </div>)}
            </div>}
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ISSUE_STATUS) as IssueStatus[]).filter((status) => status !== issue.status).map((status) => <Button key={status} variant="outline" size="sm" disabled={disabled || Boolean(acting)} onClick={() => void updateIssue(issue.id, status)}>{status === "open" ? "重新打开" : status === "resolved" ? "标为已解决" : status === "ignored" ? "忽略" : "采纳问题"}</Button>)}
            </div>
          </article>)}
        </> : <>
          <div role="group" aria-label="记忆提案状态" className="flex flex-wrap gap-2">
            {(Object.keys(PROPOSAL_STATES) as (keyof typeof PROPOSAL_STATES)[]).map((value) => <Button key={value} size="sm" variant={value === state ? "default" : "outline"} aria-pressed={value === state} onClick={() => setState(value)}>{PROPOSAL_STATES[value]}（{scopedProposals.filter((proposal) => proposal.state === value).length}）</Button>)}
          </div>
          {!scopedProposals.some((proposal) => proposal.state === state) && <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">{scopedProposals.length ? "该状态下暂无提案。" : "暂无记忆提案。运行本步骤后将在这里显示草稿产生的记忆变化。"}</p>}
          {scopedProposals.filter((proposal) => proposal.state === state).map((proposal) => <article key={proposal.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{draftLabel(proposal.draftId)}</span><Badge variant="outline">{MEMORY_CATEGORY[proposal.category]}</Badge><Badge variant="secondary">{PROPOSAL_STATES[proposal.state]}</Badge></div>
            {proposal.title && <p className="text-sm font-medium">{proposal.title}</p>}
            <p className="whitespace-pre-wrap text-sm">{proposal.content}</p>
            {proposal.reason && <p className="text-sm text-muted-foreground">{proposal.reason}</p>}
            {proposal.state === "pending" && <div className="flex gap-2"><Button size="sm" disabled={disabled || Boolean(acting)} onClick={() => void handleProposal(proposal.id, "accept")}>采纳</Button><Button variant="outline" size="sm" disabled={disabled || Boolean(acting)} onClick={() => void handleProposal(proposal.id, "reject")}>忽略</Button></div>}
            {proposal.state === "conflicted" && <Link className="text-sm underline" href={`/projects/${projectId}/memory${proposal.targetEntryId ? `?entry=${proposal.targetEntryId}` : ""}`}>前往记忆工作台处理冲突</Link>}
          </article>)}
        </>}
    </CardContent>
  </Card>;
}
