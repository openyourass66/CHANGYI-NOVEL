"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  createDirectionSchema, directionName, DIRECTION_NAME_LIMIT, DIRECTION_SUMMARY_LIMIT,
} from "@/lib/continuation-direction";
import type { ContinuationPlanView } from "@/lib/continuation-view";

export function DirectionEditor({ projectId, plan, onClose, onSaved }: {
  projectId: string;
  plan: ContinuationPlanView | null;
  onClose: () => void;
  onSaved: (plan: ContinuationPlanView, goToOutline: boolean) => void;
}) {
  const [name, setName] = useState(plan?.direction ?? "");
  const [summary, setSummary] = useState(plan?.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ direction?: string; summary?: string; request?: string }>({});
  const copy = Boolean(plan && (plan.outline.length > 0 || plan.draftCount > 0));

  async function save(goToOutline: boolean) {
    if (saving) return;
    const parsed = createDirectionSchema.safeParse({ direction: name, summary });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message])));
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const update = plan && !copy;
      const res = await fetch(`/api/projects/${projectId}/plans${update ? `/${plan.id}` : ""}`, {
        method: update ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: directionName(parsed.data.direction, parsed.data.summary),
          summary: parsed.data.summary,
          select: goToOutline,
          ...(update ? { expectedVersion: plan.version } : plan ? { sourcePlanId: plan.id } : {}),
        }),
      });
      const data = await res.json() as { plan?: ContinuationPlanView; error?: string };
      if (!res.ok || !data.plan) throw new Error(data.error ?? "保存失败，请重试。");
      onSaved(data.plan, goToOutline);
    } catch (error) {
      setErrors({ request: error instanceof Error ? error.message : "保存失败，请重试。" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{copy ? "另存为新方向" : plan ? "编辑续写方向" : "自定义续写方向"}</DialogTitle>
          <DialogDescription>
            {copy ? "原方向已有章纲或草稿。修改后将保存为独立的新方向，原有成果继续保留。"
              : "写下你想让故事如何发展。保存到本地后，可继续排章纲和生成草稿。"}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
          <div className="space-y-2">
            <Label htmlFor="direction-name">方向名称 <span className="font-normal text-muted-foreground">（选填）</span></Label>
            <Input id="direction-name" value={name} onChange={(event) => setName(event.target.value)}
              maxLength={DIRECTION_NAME_LIMIT} disabled={saving} aria-invalid={Boolean(errors.direction)}
              aria-describedby="direction-name-hint" placeholder="例如：追查旧案，揭开师门秘密" />
            <p id="direction-name-hint" className="text-xs text-muted-foreground">留空时使用方向说明的开头作为名称。</p>
            {errors.direction && <p role="alert" className="text-sm text-destructive">{errors.direction}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="direction-summary">方向说明 <span className="text-destructive">*</span></Label>
            <Textarea id="direction-summary" value={summary} onChange={(event) => setSummary(event.target.value)}
              className="min-h-56 leading-relaxed" maxLength={DIRECTION_SUMMARY_LIMIT} disabled={saving}
              aria-required aria-invalid={Boolean(errors.summary)} aria-describedby="direction-summary-hint"
              placeholder="写下接下来希望如何发展，可以包含核心冲突、人物选择、想回收的伏笔，以及不希望出现的情节。" />
            <div id="direction-summary-hint" className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span>支持直接粘贴构思，生成章纲和正文时会参考完整说明。</span>
              <span className="shrink-0">{summary.length} / {DIRECTION_SUMMARY_LIMIT}</span>
            </div>
            {errors.summary && <p role="alert" className="text-sm text-destructive">{errors.summary}</p>}
          </div>
          {errors.request && <p role="alert" className="text-sm text-destructive">{errors.request}</p>}
          <p className="text-xs text-muted-foreground">保存不会调用模型。“保存并排章纲”会进入章纲配置，由你确认后开始生成。</p>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>取消</Button>
            <Button type="submit" variant="outline" disabled={saving}>{copy ? "另存为新方向" : "保存"}</Button>
            <Button type="button" disabled={saving} onClick={() => void save(true)}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              保存并排章纲
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
