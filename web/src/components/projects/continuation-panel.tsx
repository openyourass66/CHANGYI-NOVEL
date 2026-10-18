"use client";

import { useCallback, useEffect, useState } from "react";
import { notify } from "@/components/operation-prompt";
import {
  AlertTriangle,
  Check,
  Compass,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PLAN_STATUS_LABEL, PLAN_STATUS_TONE } from "@/lib/continuation-view";
import type {
  ContinuationPlanView,
  DraftChapterView,
  OutlineItem,
} from "@/lib/continuation-view";
import type { ProfileView } from "@/lib/ai/profiles";
import type { RunStatusView } from "@/lib/ai/runner";
import type { TaskSummary } from "@/lib/ai/tasks/registry";
import { toneClass } from "@/lib/domain";
import { REQUIREMENT_HINT, requirementMet } from "@/lib/ai/requirements";
import { stageMetaOf, stageStatusOf } from "@/lib/ai/progress-view";
import { ProjectNav } from "@/components/projects/project-nav";
import { CloudAuthorizeDialog } from "@/components/projects/cloud-authorize-dialog";
import { ContinuationResults } from "@/components/projects/continuation-results";
import { DraftEditor } from "@/components/projects/draft-editor";
import { DirectionEditor } from "@/components/projects/direction-editor";
import { StageRail, type Stage } from "@/components/projects/stage-rail";
import { RunStatusPanel } from "@/components/projects/run-status";
import { useAnalysisRun } from "@/components/projects/use-analysis-run";

const OUTLINE_COUNT_OPTIONS = [3, 5, 8, 10];

/** 这些步骤需要所选方向的草稿作为输入。 */
const DRAFT_STAGES = new Set(["draft", "continuity-check", "draft-memory"]);

/** 「已产出」的量词，按步骤给。 */
const PRODUCED_LABEL: Record<string, string> = {
  direction: "个方向",
  outline: "章",
  draft: "章",
  "continuity-check": "处问题",
  "draft-memory": "条提案",
};

type Editing = { planId: string; items: OutlineItem[] };

export function ContinuationPanel({
  projectId,
  projectName,
  profiles,
  tasks,
  initialPlans,
  initialRun = null,
  taskRuns: initialTaskRuns,
  hasMemory,
  initialStage,
  onExportText,
  onAutoContinue,
  automationActive = false,
}: {
  projectId: string;
  projectName: string;
  profiles: ProfileView[];
  tasks: TaskSummary[];
  initialPlans: ContinuationPlanView[];
  initialRun?: RunStatusView | null;
  taskRuns: Record<string, RunStatusView | null>;
  hasMemory: boolean;
  initialStage: string | null;
  onExportText?: (fileName: string, text: string) => Promise<void>;
  onAutoContinue?: (planId: string, profileId: string, outlineCount: number) => Promise<void>;
  automationActive?: boolean;
}) {
  const [profileId, setProfileId] = useState(
    () => profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? "",
  );
  const [taskType, setTaskType] = useState(() => initialStage ?? tasks[0]?.type ?? "direction");
  const [outlineCount, setOutlineCount] = useState(5);
  const [taskRuns, setTaskRuns] = useState(initialTaskRuns);

  const [plans, setPlans] = useState(initialPlans);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    () =>
      initialPlans.find((p) => p.status === "active")?.id ?? initialPlans[0]?.id ?? null,
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [actingPlan, setActingPlan] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ContinuationPlanView | null>(null);
  const [directionEditor, setDirectionEditor] = useState<{ plan: ContinuationPlanView | null } | null>(null);

  const [loadedDrafts, setDrafts] = useState<DraftChapterView[]>([]);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [loadedDraftScope, setLoadedDraftScope] = useState<string | null>(null);
  const [loadedDraftError, setLoadedDraftError] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [previousData, setPreviousData] = useState({ plans: initialPlans, runs: initialTaskRuns });
  if (previousData.plans !== initialPlans || previousData.runs !== initialTaskRuns) {
    setPreviousData({ plans: initialPlans, runs: initialTaskRuns });
    setPlans(initialPlans);
    setTaskRuns(initialTaskRuns);
    setReloadKey((value) => value + 1);
  }

  const activeTask = tasks.find((t) => t.type === taskType) ?? tasks[0];
  const needsPlan = Boolean(activeTask?.requirement) && activeTask?.requirement !== "memory";
  const showOutlineCount = activeTask?.type === "outline";
  const showAutomaticCount = Boolean(onAutoContinue) && taskType === "direction";
  const isContinuityTask = activeTask?.type === "continuity-check";
  const isDraftMemoryTask = activeTask?.type === "draft-memory";
  const showDrafts = DRAFT_STAGES.has(taskType);

  const targetPlan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const targetPlanId = targetPlan?.id ?? null;
  const draftScope = JSON.stringify([projectId, targetPlanId, taskType]);
  const draftRequestKey = JSON.stringify([projectId, targetPlanId, taskType, reloadKey]);
  const draftsLoading = showDrafts && Boolean(targetPlanId) && loadedDraftKey !== draftRequestKey;
  const draftsError = loadedDraftKey === draftRequestKey ? loadedDraftError : null;
  const drafts = loadedDraftScope === draftScope ? loadedDrafts : [];
  const editingDraft = drafts.find((d) => d.id === editingDraftId) ?? null;

  const refreshPlans = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/plans`, { cache: "no-store" });
      const data = (await res.json()) as { plans?: ContinuationPlanView[] };
      if (data.plans) setPlans(data.plans);
    } catch {
      // 刷新失败不打断主流程
    }
  }, [projectId]);

  const {
    run: hookRun,
    runActive: taskActive,
    busy,
    preview,
    authOpen,
    setAuthOpen,
    authorizing,
    start: startRun,
    confirmAuthorize,
    cancel,
    resume,
  } = useAnalysisRun({
    projectId,
    initialRun,
    onSettled: (settled) => {
      void refreshPlans();
      setTaskRuns((prev) => ({ ...prev, [settled.taskType]: settled }));
      setReloadKey((k) => k + 1);
    },
  });
  const runActive = taskActive || automationActive;

  useEffect(() => {
    if (!showDrafts || !targetPlanId) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/plans/${targetPlanId}/drafts`, { cache: "no-store" });
        const data = (await res.json()) as { drafts?: DraftChapterView[]; error?: string };
        if (!res.ok || !data.drafts) throw new Error(data.error ?? "草稿加载失败");
        if (active) { setDrafts(data.drafts); setLoadedDraftKey(draftRequestKey); setLoadedDraftScope(draftScope); setLoadedDraftError(null); }
      } catch (error) {
        if (active) { setLoadedDraftError(error instanceof Error ? error.message : "草稿加载失败"); setLoadedDraftKey(draftRequestKey); }
      }
    })();
    return () => { active = false; };
  }, [showDrafts, draftRequestKey, draftScope, targetPlanId, projectId]);

  /** 某一步骤要展示的运行：进行中的那次优先，否则用该步骤的服务端最近一次。 */
  function runForStage(key: string): RunStatusView | null {
    const stored = taskRuns[key] ?? null;
    const candidate = hookRun?.taskType === key && (!stored || hookRun.createdAt >= stored.createdAt) ? hookRun : stored;
    return candidate?.payload.planId && candidate.payload.planId !== targetPlanId ? null : candidate;
  }

  const requirementState = {
    hasMemory,
    planCount: plans.length,
    outlineCount: targetPlan?.outline.length ?? 0,
    draftCount: targetPlan?.draftCount ?? 0,
  };

  const stages: Stage[] = tasks.map((t) => {
    const stageRun = runForStage(t.type);
    const met = requirementMet(t.requirement, requirementState);
    const fallbackMeta =
      t.requirement === "plan"
        ? `共 ${plans.length} 个方向`
        : t.requirement === "outline"
          ? `当前方向 ${targetPlan?.outline.length ?? 0} 章纲`
          : t.requirement === "drafts"
            ? `当前方向 ${targetPlan?.draftCount ?? 0} 章草稿`
            : null;
    return {
      key: t.type,
      label: t.type === "direction" ? "确定续写方向" : t.label,
      description: t.type === "direction" ? "自己填写构思，或让 AI 生成候选方向。" : t.description,
      status: t.type === "direction" && plans.length > 0 && !["running", "pending"].includes(stageRun?.status ?? "")
        ? "done" : stageStatusOf(stageRun),
      meta: t.type === "direction" ? `共 ${plans.length} 个方向` : stageMetaOf(stageRun) ?? fallbackMeta,
      hint: t.type === "direction" ? null : met || !t.requirement ? null : REQUIREMENT_HINT[t.requirement],
    };
  });

  const activeStage = stages.find((s) => s.key === taskType);
  const displayRun = runForStage(taskType);
  const runActions =
    hookRun && displayRun?.id === hookRun.id
      ? { busy, onCancel: () => void cancel(), onResume: () => void resume() }
      : null;

  async function start() {
    if (needsPlan && !targetPlan) {
      notify.error("请先添加或生成一个续写方向。");
      return;
    }
    await startRun({
      taskType,
      profileId,
      payload: needsPlan
        ? { planId: targetPlan!.id, ...(showOutlineCount ? { outlineCount } : {}) }
        : undefined,
    });
  }

  async function regenerateDraft(draft: DraftChapterView) {
    if (!targetPlanId) return;
    await startRun({
      taskType: "draft",
      profileId,
      payload: { planId: targetPlanId, outlineIndex: draft.index },
    });
  }

  async function activate(id: string) {
    setActingPlan(id);
    setSelectedPlanId(id);
    try {
      if (onAutoContinue) {
        await onAutoContinue(id, profileId, outlineCount);
        await refreshPlans();
        return;
      }
      const res = await fetch(`/api/projects/${projectId}/plans/${id}/activate`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "选定失败");
      await refreshPlans();
      notify.success("已选为当前续写方向");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "选定失败");
    } finally {
      setActingPlan(null);
    }
  }

  async function removePlan(plan: ContinuationPlanView) {
    setPendingDelete(null);
    setActingPlan(plan.id);
    try {
      const res = await fetch(`/api/projects/${projectId}/plans/${plan.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "删除失败");
      if (editing?.planId === plan.id) setEditing(null);
      await refreshPlans();
      notify.success("已删除该方向");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setActingPlan(null);
    }
  }

  function beginEdit(plan: ContinuationPlanView) {
    setSelectedPlanId(plan.id);
    setEditing({
      planId: plan.id,
      items: plan.outline.map((item) => ({ ...item, beats: [...item.beats] })),
    });
  }

  function updateItem(index: number, patch: Partial<OutlineItem>) {
    setEditing((prev) =>
      prev
        ? { ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }
        : prev,
    );
  }

  function addItem() {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            items: [
              ...prev.items,
              {
                index: prev.items.length + 1,
                title: "",
                summary: "",
                beats: [],
                relatedThreads: [],
              },
            ],
          }
        : prev,
    );
  }

  function removeItem(index: number) {
    setEditing((prev) =>
      prev ? { ...prev, items: prev.items.filter((_, i) => i !== index) } : prev,
    );
  }

  async function saveOutline() {
    if (!editing) return;
    const items = editing.items.map((it) => ({ ...it, title: it.title.trim() }));
    if (items.some((it) => !it.title)) {
      notify.error("每一章都要有标题。");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/plans/${editing.planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline: items }),
      });
      const data = (await res.json()) as { plan?: ContinuationPlanView; error?: string };
      if (!res.ok || !data.plan) throw new Error(data.error ?? "保存失败");
      const saved = data.plan;
      setPlans((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setEditing(null);
      notify.success("章纲已保存");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const blocked =
    showOutlineCount && targetPlan && targetPlan.draftCount > 0
      ? `当前方向已有 ${targetPlan.draftCount} 章草稿。为避免旧草稿错配新章纲，请先导出需要保留的草稿并删除该方向的现有草稿。`
      : needsPlan && !hasMemory ? REQUIREMENT_HINT.memory : activeStage?.hint ?? null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 lg:px-6">
      <ProjectNav projectId={projectId} />
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{projectName}</h1>
        <p className="text-sm text-muted-foreground">
          {onAutoContinue ? "配置模型和章数后，选定方向即可自动完成章纲、正文、检查与记忆提取。已有章纲和正文会保留。" : "确定续写方向 → 排章纲 → 写草稿 → 核对并提取记忆变化。方向可以自己填写，也可以由 AI 生成。"}
        </p>
      </header>

      {/* 步骤轨 + 当前步骤配置 */}
      <Card>
        <CardContent className="space-y-4 py-5">
          <StageRail
            stages={stages}
            activeKey={taskType}
            onSelect={setTaskType}
            disabled={runActive}
          />

          <Separator />

          {taskType === "direction" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">已经有续写构思？</p>
                <p className="text-xs text-muted-foreground">直接填写并保存，无需先生成候选方向。</p>
              </div>
              <Button variant="outline" disabled={runActive} onClick={() => setDirectionEditor({ plan: null })}>
                <Plus className="size-4" />自定义方向
              </Button>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{activeTask?.label}</span>
              <p className="text-xs text-muted-foreground">{activeTask?.description}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cn-profile">模型档案</Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger id="cn-profile">
                  <SelectValue placeholder="选择模型档案" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {profiles.length === 0 && (
                <p className="text-xs text-destructive">暂无模型档案，请先到「设置」新增。</p>
              )}
            </div>
          </div>

          {(needsPlan || showOutlineCount || showAutomaticCount) && (
            <div className="grid gap-4 md:grid-cols-2">
              {needsPlan && (
                <div className="space-y-1.5">
                  <Label htmlFor="cn-plan">目标方向</Label>
                  <Select
                    value={targetPlan?.id ?? ""}
                    onValueChange={(v) => setSelectedPlanId(v)}
                    disabled={plans.length === 0 || runActive}
                  >
                    <SelectTrigger id="cn-plan">
                      <SelectValue placeholder="尚无方向" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {PLAN_STATUS_LABEL[p.status]} · {p.direction.slice(0, 24)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {showOutlineCount
                      ? targetPlan?.draftCount
                        ? "该方向已有草稿，需先导出并删除现有草稿，才能重新生成章纲。"
                        : `章纲会覆盖写入该方向，并把它的版本号 +1${
                            targetPlan && targetPlan.outline.length > 0
                              ? `（当前已有 ${targetPlan.outline.length} 章，将被覆盖）`
                              : ""
                          }`
                      : isContinuityTask
                        ? "逐章核对这个方向的草稿，产出「待核对」的问题；重新检查会替换上一次的结果。"
                        : isDraftMemoryTask
                          ? "逐章对照记忆，提取草稿带来的新事件、人物变化与悬念进展，产出待确认的记忆提案。"
                          : "只生成还没有草稿的章；已有草稿的章请到下方草稿列表里单独重新生成。"}
                  </p>
                </div>
              )}

              {(showOutlineCount || showAutomaticCount) && (
                <div className="space-y-1.5">
                  <Label htmlFor="cn-count">规划章数</Label>
                  <Select
                    value={String(outlineCount)}
                    onValueChange={(v) => setOutlineCount(Number(v))}
                  >
                    <SelectTrigger id="cn-count">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTLINE_COUNT_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          接下来 {n} 章
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {blocked && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{blocked}（仍可启动，服务端会再次校验）。</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              onClick={() => void start()}
              disabled={
                busy ||
                runActive ||
                profiles.length === 0 ||
                (showOutlineCount && Boolean(targetPlan?.draftCount))
              }
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {taskType === "direction" ? "AI 生成候选方向" : `开始${activeTask?.label ?? "续写任务"}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 运行状态（常驻） */}
      <RunStatusPanel
        taskLabel={activeTask?.label ?? "续写任务"}
        run={displayRun}
        producedLabel={PRODUCED_LABEL[taskType] ?? "项"}
        idleHint={
          taskType === "direction"
            ? "可以添加自定义方向，或使用上方的 AI 生成候选方向。"
            : blocked
              ? `这个步骤还没有运行过。${blocked}。`
              : "这个步骤还没有运行过，配置好后点上面的「开始」。"
        }
        actions={runActions}
      />

      {taskType === "direction" && <Card aria-label="续写方向结果">
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Compass className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">续写方向</span>
              <span className="text-sm text-muted-foreground">共 {plans.length} 个</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={runActive} onClick={() => setDirectionEditor({ plan: null })}>
                <Plus className="size-4" />自定义方向
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void refreshPlans()}>
                <RotateCcw className="size-4" />
                刷新
              </Button>
            </div>
          </div>

          {plans.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                还没有续写方向。可以直接填写自己的构思，也可以积累故事记忆后，让 AI 生成候选方向。
              </p>
              <Button className="mt-4" variant="outline" disabled={runActive} onClick={() => setDirectionEditor({ plan: null })}>
                <Plus className="size-4" />添加自定义方向
              </Button>
            </div>
          ) : (
            <ul role="list" className="space-y-3">
              {plans.map((plan) => {
                return (
                  <li key={plan.id} className="rounded-lg border bg-card">
                    <div className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={toneClass(PLAN_STATUS_TONE[plan.status])}
                        >
                          {PLAN_STATUS_LABEL[plan.status]}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          v{plan.version}
                        </Badge>

                      </div>

                      <p className="font-medium">{plan.direction}</p>
                      {plan.summary && (
                        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                          {plan.summary}
                        </p>
                      )}

                      {plan.relatedThreads.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {plan.relatedThreads.map((t, i) => (
                            <Badge key={i} variant="outline" className="text-xs font-normal">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <Button variant="ghost" size="sm" disabled={runActive || actingPlan === plan.id}
                          onClick={() => setDirectionEditor({ plan })}>
                          <Pencil className="size-4" />
                          {plan.outline.length > 0 || plan.draftCount > 0 ? "修改并另存" : "编辑方向"}
                        </Button>
                        {(plan.status !== "active" || onAutoContinue) && (
                          <Button
                            size="sm"
                            onClick={() => void activate(plan.id)}
                            disabled={actingPlan !== null || runActive}
                          >
                            {actingPlan === plan.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                            {onAutoContinue ? (plan.draftCount > 0 ? "继续此方向的自动续写" : "选定此方向并开始续写") : "选定此方向"}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete(plan)}
                          disabled={actingPlan === plan.id}
                        >
                          <Trash2 className="size-4" />
                          删除
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>}

      {taskType === "outline" && <Card aria-label="章纲结果"><CardContent className="space-y-4 py-5">
        <h2 className="font-medium">所选方向的章纲</h2>
        {targetPlan ? (() => {
          const plan = targetPlan;
          const isEditing = editing?.planId === plan.id;
          return (<div className="space-y-3 border-t bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">章纲</span>
              {!isEditing && (
                <Button variant="outline" size="sm" onClick={() => beginEdit(plan)}>
                  <Pencil className="size-4" />
                  编辑章纲
                </Button>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-3">
                {editing!.items.map((item, i) => (
                  <div key={i} className="space-y-2 rounded-md border bg-card p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        第 {i + 1} 章
                      </span>
                      <Input
                        value={item.title}
                        onChange={(e) => updateItem(i, { title: e.target.value })}
                        placeholder="章标题"
                        aria-label={`第 ${i + 1} 章标题`}
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(i)}
                        aria-label={`删除第 ${i + 1} 章`}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={item.summary}
                      onChange={(e) => updateItem(i, { summary: e.target.value })}
                      placeholder="本章走向"
                      aria-label={`第 ${i + 1} 章走向`}
                      rows={2}
                    />
                    <Textarea
                      value={item.beats.join("\n")}
                      onChange={(e) =>
                        updateItem(i, {
                          beats: e.target.value
                            .split("\n")
                            .map((b) => b.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="关键节拍，一行一条"
                      aria-label={`第 ${i + 1} 章节拍`}
                      rows={3}
                    />
                  </div>
                ))}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={addItem}>
                    <Plus className="size-4" />
                    添加一章
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(null)}
                      disabled={saving}
                    >
                      取消
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void saveOutline()}
                      disabled={saving}
                    >
                      {saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      保存章纲
                    </Button>
                  </div>
                </div>
              </div>
            ) : plan.outline.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                这个方向还没有章纲。选中「生成章纲」步骤即可为它排序接下来的章节。
              </p>
            ) : (
              <ol className="space-y-2">
                {plan.outline.map((item) => (
                  <li key={item.index} className="rounded-md border bg-card p-3">
                    <p className="text-sm font-medium">
                      第 {item.index} 章 · {item.title}
                    </p>
                    {item.summary && (
                      <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                        {item.summary}
                      </p>
                    )}
                    {item.beats.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {item.beats.map((b, i) => (
                          <li
                            key={i}
                            className="text-xs text-muted-foreground before:mr-1.5 before:content-['·']"
                          >
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.relatedThreads.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.relatedThreads.map((t, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="text-xs font-normal"
                          >
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>);
        })() : <p className="text-sm text-muted-foreground">请先在「确定续写方向」中添加方向。</p>}
      </CardContent></Card>}

      {taskType === "draft" && (
        <Card aria-label="草稿结果">
          <CardContent className="space-y-4 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-medium">续写草稿</span>
                <span className="text-sm text-muted-foreground">
                  {targetPlan
                    ? `方向「${targetPlan.direction.slice(0, 24)}」共 ${drafts.length} 章`
                    : "尚未选定方向"}
                </span>
              </div>
              {targetPlanId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  <RotateCcw className="size-4" />
                  刷新
                </Button>
              )}
            </div>

            {draftsLoading ? <p role="status" className="text-sm text-muted-foreground">正在加载草稿…</p> : draftsError ? <p role="alert" className="text-sm text-destructive">{draftsError}</p> : !targetPlan ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  先到上方生成并选定一个续写方向。
                </p>
              </div>
            ) : drafts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {targetPlan.outline.length === 0
                    ? "这个方向还没有章纲，请先运行「生成章纲」。"
                    : `章纲已有 ${targetPlan.outline.length} 章，选中「生成草稿」步骤即可逐章写出正文。`}
                </p>
              </div>
            ) : (
              <ul role="list" className="space-y-2">
                {drafts.map((d) => (
                  <li key={d.id} className="rounded-lg border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            第 {d.index} 章 · {d.title || "（无标题）"}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            v{d.version}
                          </Badge>
                          <Badge variant="outline" className="text-xs font-normal">
                            {d.content.length} 字
                          </Badge>

                        </div>
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {d.content.slice(0, 120)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" disabled={busy || runActive} onClick={() => void regenerateDraft(d)}>
                          <RotateCcw className="size-4" />重新生成
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingDraftId(d.id)}
                        >
                          <Pencil className="size-4" />
                          阅读 / 编辑
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {(isContinuityTask || isDraftMemoryTask) && <ContinuationResults
        key={`${projectId}:${targetPlanId}:${taskType}`}
        projectId={projectId} planId={targetPlanId} drafts={drafts}
        kind={isContinuityTask ? "continuity" : "memory"} reloadKey={reloadKey}
        loadingDrafts={draftsLoading} draftsError={draftsError} disabled={runActive}
        onRefresh={() => setReloadKey((value) => value + 1)}
      />}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个续写方向？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.direction}」及其章纲、草稿都会被删除，无法撤销。原文与记忆不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingDelete && void removePlan(pendingDelete)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {directionEditor && (
        <DirectionEditor projectId={projectId} plan={directionEditor.plan}
          onClose={() => setDirectionEditor(null)}
          onSaved={(saved, goToOutline) => {
            setPlans((prev) => [saved, ...prev.filter((p) => p.id !== saved.id).map((p) =>
              saved.status === "active" && p.status === "active" ? { ...p, status: "draft" as const } : p,
            )]);
            setSelectedPlanId(saved.id);
            setDirectionEditor(null);
            if (goToOutline) {
              if (onAutoContinue) {
                void activate(saved.id);
                return;
              }
              setEditing(null);
              setTaskType("outline");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
            notify.success(goToOutline ? "方向已保存并选定，请确认章纲配置后开始生成。" : "续写方向已保存");
          }} />
      )}

      {taskType === "draft" && editingDraft && (
        <DraftEditor
          key={`${editingDraft.id}-${editingDraft.version}`}
          draft={editingDraft}
          open
          regenerating={runActive}
          onOpenChange={(o) => !o && setEditingDraftId(null)}
          onSaved={(saved) =>
            setDrafts((prev) => prev.map((d) => (d.id === saved.id ? saved : d)))
          }
          onDeleted={(id) => {
            setDrafts((prev) => prev.filter((d) => d.id !== id));
            setEditingDraftId(null);
          }}
          onRegenerate={() => void regenerateDraft(editingDraft)}
          onExportText={onExportText}
        />
      )}

      <CloudAuthorizeDialog
        open={authOpen}
        preview={preview}
        authorizing={authorizing}
        onOpenChange={setAuthOpen}
        onConfirm={() => void confirmAuthorize()}
      />
    </div>
  );
}
