import { PageFrame, ScrollRegion, SearchField } from "@/components/page-frame";

import { useRef, useState, useTransition } from "react";
import Link from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { notify } from "@/components/operation-prompt";
import {
  BookOpen,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectSummary } from "@/lib/projects-view";

const dateFmt = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function ProjectLibrary({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState(projects);
  const [query, setQuery] = useState("");
  const visibleItems = items.filter((item) => `${item.name} ${item.genre ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  async function create() {
    if (!name.trim()) {
      notify.error("请填写项目名称");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), language: "zh", genre: genre.trim() }),
      });
      const data = (await res.json()) as { project?: { id: string }; error?: string };
      if (!res.ok || !data.project) throw new Error(data.error ?? "创建失败");
      notify.success("项目已创建");
      setOpen(false);
      setName("");
      setGenre("");
      router.push(`/projects/${data.project.id}`);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  /** 从备份 JSON 恢复出一个新项目；成功后就地跳转到恢复出的项目。 */
  async function restore(file: File) {
    setRestoring(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/projects/restore", { method: "POST", body: form });
      const data = (await res.json()) as {
        project?: { id: string; name: string };
        summary?: { chapterCount: number; memoryCount: number; droppedCitations: number };
        error?: string;
      };
      if (!res.ok || !data.project) throw new Error(data.error ?? "恢复失败");
      const dropped = data.summary?.droppedCitations ?? 0;
      notify.success(
        `已恢复到「${data.project.name}」：${data.summary?.chapterCount ?? 0} 章、${data.summary?.memoryCount ?? 0} 条记忆${
          dropped > 0 ? `，${dropped} 条引用因备份缺少定位信息被丢弃` : ""
        }`,
      );
      router.push(`/projects/${data.project.id}`);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setRestoring(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const res = await fetch(`/api/projects/${target.id}`, { method: "DELETE" });
    if (!res.ok) {
      notify.error("删除失败");
      return;
    }
    setItems((prev) => prev.filter((p) => p.id !== target.id));
    notify.success("项目已删除");
    startTransition(() => router.refresh());
  }

  return (
    <PageFrame title="项目库" description="从原文出发，让故事继续生长。" actions={<>
          <Button
            variant="outline"
            onClick={() => backupInputRef.current?.click()}
            disabled={restoring}
          >
            <Upload className="size-4" aria-hidden />
            {restoring ? "恢复中…" : "从备份恢复"}
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            新建项目
          </Button></>} toolbar={<><SearchField label="搜索项目名称" value={query} onChange={setQuery} /><span className="text-xs text-muted-foreground">全部项目 {items.length}</span></>}>
      <ScrollRegion label="项目列表" positionKey="project-library">
      <input
        ref={backupInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void restore(file);
        }}
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <BookOpen className="size-9 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">还没有项目</p>
              <p className="mt-1 text-sm text-muted-foreground">
                新建一个项目并导入小说原文，即可开始分析与续写。
              </p>
            </div>
            <Button variant="secondary" onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              新建项目
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="collection-grid">
          {visibleItems.map((p) => (
            <li key={p.id}>
              <Card className="relative h-full transition-colors duration-200 hover:border-primary/40">
                <CardHeader className="pb-3">
                  <div className="project-card-icon"><BookOpen className="size-5" aria-hidden /></div>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      <Link
                        href={`/projects/${p.id}`}
                        aria-label={`打开项目：${p.name}`}
                        className="after:absolute after:inset-0 after:content-[''] rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {p.name}
                      </Link>
                    </CardTitle>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="relative z-10 size-8"
                          aria-label={`${p.name} 的操作`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="size-4" />
                          删除项目
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {p.genre && (
                    <Badge variant="secondary" className="w-fit">
                      {p.genre}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="project-summary"><div><b>{p.chapterCount}</b><span>原文章节</span></div><div><b>{p.sourceCount}</b><span>原文文档</span></div><div><b>{p.memoryCount}</b><span>故事记忆</span></div></div>
                  <div className="project-summary-footer"><span>更新于 {dateFmt.format(new Date(p.updatedAt))}</span><span className="text-primary">进入项目 →</span></div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && visibleItems.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">没有匹配的项目。</p>}
      </ScrollRegion>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>项目保存于本机，原文导入后保持只读。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pj-name">
                项目名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：某部网文续写"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pj-genre">体裁（可选）</Label>
              <Input
                id="pj-genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="玄幻 / 悬疑 / 都市…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={create} disabled={saving}>
              {saving ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{deleteTarget?.name}」及其章节、记忆与本机源文副本，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageFrame>
  );
}
