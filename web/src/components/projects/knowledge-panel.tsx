"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, UserRound } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  KNOWLEDGE_RELATION,
  KNOWLEDGE_RELATION_TONE,
  toneClass,
  type KnowledgeRelation,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { KnowledgeView } from "@/lib/memory-view";

const RELATIONS = Object.keys(KNOWLEDGE_RELATION) as KnowledgeRelation[];

export function KnowledgePanel({
  projectId,
  initialKnowledge,
}: {
  projectId: string;
  initialKnowledge: KnowledgeView[];
}) {
  const [items, setItems] = useState(initialKnowledge);
  const [characterName, setCharacterName] = useState("");
  const [infoItem, setInfoItem] = useState("");
  const [relation, setRelation] = useState<KnowledgeRelation>("known");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeView | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, KnowledgeView[]>();
    for (const it of items) {
      const arr = map.get(it.characterName) ?? [];
      arr.push(it);
      map.set(it.characterName, arr);
    }
    return Array.from(map.entries());
  }, [items]);

  async function add() {
    const name = characterName.trim();
    const info = infoItem.trim();
    if (!name || !info) {
      toast.error("请填写人物与信息条目");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterName: name, infoItem: info, relation }),
      });
      const data = (await res.json()) as { item?: KnowledgeView; error?: string };
      if (!res.ok || !data.item) throw new Error(data.error ?? "添加失败");
      const created = data.item;
      setItems((prev) => [...prev, created]);
      setInfoItem("");
      toast.success("已添加认知");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }

  async function changeRelation(item: KnowledgeView, next: KnowledgeRelation) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/knowledge/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterName: item.characterName,
          infoItem: item.infoItem,
          relation: next,
        }),
      });
      const data = (await res.json()) as { item?: KnowledgeView; error?: string };
      if (!res.ok || !data.item) throw new Error(data.error ?? "更新失败");
      const updated = data.item;
      setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: KnowledgeView) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/knowledge/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      toast.success("已删除认知");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyId(null);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium">记录人物对信息的掌握情况</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          「已知 / 误信 / 未知」用于约束续写时人物能说什么、不能说什么，避免越界。
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.5fr_auto_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="kb-name">人物</Label>
            <Input
              id="kb-name"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="例如：林舟"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-info">信息条目</Label>
            <Input
              id="kb-info"
              value={infoItem}
              onChange={(e) => setInfoItem(e.target.value)}
              placeholder="例如：师父的真实身份"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-relation">认知</Label>
            <Select
              value={relation}
              onValueChange={(v) => setRelation(v as KnowledgeRelation)}
            >
              <SelectTrigger id="kb-relation" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {KNOWLEDGE_RELATION[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={add} disabled={adding} className="w-full sm:w-auto">
              {adding ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              添加
            </Button>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">尚未记录任何人物认知。</p>
        </div>
      ) : (
        <ul role="list" className="space-y-4">
          {groups.map(([name, list]) => (
            <li key={name} className="rounded-lg border bg-card p-4">
              <h3 className="flex items-center gap-2 font-medium">
                <UserRound className="size-4 text-muted-foreground" aria-hidden />
                {name}
                <span className="text-xs font-normal text-muted-foreground">
                  {list.length} 条
                </span>
              </h3>
              <ul role="list" className="mt-3 space-y-2">
                {list.map((it) => {
                  const busy = busyId === it.id;
                  return (
                    <li
                      key={it.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border p-2.5"
                    >
                      <span className="min-w-0 flex-1 text-sm">{it.infoItem}</span>
                      <Select
                        value={it.relation}
                        onValueChange={(v) => changeRelation(it, v as KnowledgeRelation)}
                        disabled={busy}
                      >
                        <SelectTrigger
                          className={cn("w-24", toneClass(KNOWLEDGE_RELATION_TONE[it.relation]))}
                          aria-label={`调整「${name}」对「${it.infoItem}」的认知`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RELATIONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {KNOWLEDGE_RELATION[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`删除「${name}」对「${it.infoItem}」的认知`}
                        onClick={() => setDeleteTarget(it)}
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="size-4" aria-hidden />
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除认知条目？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{deleteTarget?.characterName}」对「{deleteTarget?.infoItem}」的认知记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyId)}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyId)}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) void remove(deleteTarget);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
