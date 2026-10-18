import { useState } from "react";
import { Link } from "react-router-dom";
import { BookPlus, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { notify } from "@/components/operation-prompt";
import { api } from "./bridge";
import type { Work } from "./works";

export function MergeWorkButton({ work }: { work: Work }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [merged, setMerged] = useState(Boolean(work.mergedAt));
  const [conflicts, setConflicts] = useState(0);
  async function merge() {
    setOpen(false); setBusy(true);
    try {
      const result = await api<{ merge: { chapterCount: number; memoryAdded: number; memoryConflicts: number; memorySkipped: number }; alreadyMerged: boolean }>(`/api/works/${work.id}/merge`, "POST", { confirmed: true });
      setMerged(true); setConflicts(result.merge.memoryConflicts);
      notify.success(result.alreadyMerged ? "这部作品已经并入原作，无需重复操作。" : `已将 ${result.merge.chapterCount} 章正文并入「${work.sourceProjectName}」，${result.merge.memoryAdded} 条记忆已加入记忆工作台。`, { description: `${result.merge.memorySkipped ? `${result.merge.memorySkipped} 条已采纳、已忽略或重复的记忆未重复写入。` : ""}${result.merge.memoryConflicts ? `${result.merge.memoryConflicts} 条记忆与人工修改存在冲突，已保留待处理，请到理解分析或续写规划中审阅。` : "正文与记忆已同步保存。"}` });
    } catch (error) { notify.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" size="sm" disabled={busy || merged || !work.sourceProjectId} onClick={() => setOpen(true)}>
      {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : merged ? <Check className="size-4" /> : <BookPlus className="size-4" />}
      {merged ? "已并入原作" : busy ? "正在并入…" : work.sourceProjectId ? "一键并入原作" : "原作已删除"}
    </Button>
    {conflicts > 0 && work.sourceProjectId && <Link className="text-xs underline" to={`/projects/${work.sourceProjectId}/analysis`}>查看记忆冲突</Link>}
    <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>确认并入原作？</AlertDialogTitle>
      <AlertDialogDescription>将「{work.title}」的 {work.chapterCount ?? work.chapters?.length ?? 0} 章正文追加到「{work.sourceProjectName}」末尾，接续原作编号，同时处理这部作品保存的 {work.memoryCount ?? 0} 条记忆变化。新记忆自动加入记忆工作台；已采纳或已忽略的记忆不重复写入，人工修改冲突留待处理。原有章节和作品库副本保留，同一作品只并入一次。</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void merge()}>确认并入</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
