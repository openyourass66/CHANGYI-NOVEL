"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/operation-prompt";
import {
  Cloud,
  Cpu,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  PlugZap,
  Plus,
  Star,
  Trash2,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MODEL_PROVIDER, type ModelProvider } from "@/lib/domain";
import type { ProfileView } from "@/lib/ai/profiles";

const PROVIDER_HINTS: Record<ModelProvider, { baseUrl: string; model: string }> = {
  "openai-compatible": { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-6" },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "qwen2.5:14b" },
  lmstudio: { baseUrl: "http://localhost:1234/v1", model: "local-model" },
};

type FormState = {
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  isLocal: boolean;
};

const emptyForm = (): FormState => ({
  name: "",
  provider: "openai-compatible",
  model: "",
  baseUrl: "",
  apiKey: "",
  isLocal: false,
});

export function ProfileManager({
  profiles,
  encryptionReady,
}: {
  profiles: ProfileView[];
  encryptionReady: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState(profiles);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileView | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProfileView | null>(null);

  // 服务端刷新导致 profiles 变化时同步本地列表（渲染期调整，避免额外渲染）
  const [prevProfiles, setPrevProfiles] = useState(profiles);
  if (prevProfiles !== profiles) {
    setPrevProfiles(profiles);
    setItems(profiles);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setErrors({});
    setShowKey(false);
    setFormOpen(true);
  }

  function openEdit(p: ProfileView) {
    setEditing(p);
    setForm({
      name: p.name,
      provider: p.provider,
      model: p.model,
      baseUrl: p.baseUrl ?? "",
      apiKey: "",
      isLocal: p.isLocal,
    });
    setErrors({});
    setShowKey(false);
    setFormOpen(true);
  }

  function validate(f: FormState): Record<string, string> {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "请填写名称";
    if (!f.model.trim()) e.model = "请填写模型名";
    const local = f.isLocal;
    const hasExistingKey = editing?.hasKey ?? false;
    if (!local && !f.apiKey.trim() && !hasExistingKey) {
      e.apiKey = "该供应商需要 API 密钥";
    }
    if (f.baseUrl.trim()) {
      try {
        new URL(f.baseUrl.trim());
      } catch {
        e.baseUrl = "服务地址格式不正确";
      }
    }
    return e;
  }

  async function submit() {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        provider: form.provider,
        model: form.model.trim(),
        baseUrl: form.baseUrl.trim(),
        isLocal: form.isLocal,
      };
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();

      const url = editing ? `/api/model-profiles/${editing.id}` : "/api/model-profiles";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "保存失败");

      notify.success(editing ? "档案已更新" : "档案已创建");
      setFormOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const [testing, setTesting] = useState<string | null>(null);

  async function testConnection(p: ProfileView) {
    setTesting(p.id);
    try {
      const res = await fetch(`/api/model-profiles/${p.id}/test`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; sample?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "连接失败");
      notify.success("连接正常", { description: data.sample?.slice(0, 80) });
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "连接失败");
    } finally {
      setTesting(null);
      startTransition(() => router.refresh());
    }
  }

  async function makeDefault(p: ProfileView) {
    const res = await fetch(`/api/model-profiles/${p.id}/default`, { method: "POST" });
    if (!res.ok) {
      notify.error("设置默认失败");
      return;
    }
    notify.success(`已将「${p.name}」设为默认`);
    startTransition(() => router.refresh());
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/model-profiles/${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    if (!res.ok) {
      notify.error("删除失败");
      return;
    }
    notify.success("档案已删除");
    startTransition(() => router.refresh());
  }

  const hint = PROVIDER_HINTS[form.provider];
  const isLocalProvider = form.isLocal;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">模型档案</h2>
          <p className="text-sm text-muted-foreground">
            供应商与密钥由你配置，可随时切换；本地模型请求不外发。
          </p>
        </div>
        <Button onClick={openCreate} disabled={!encryptionReady}>
          <Plus className="size-4" />
          新增档案
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Cpu className="size-8 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">还没有模型档案</p>
              <p className="mt-1 text-sm text-muted-foreground">
                添加一个模型档案后，才能进行章节分析与续写。
              </p>
            </div>
            <Button onClick={openCreate} disabled={!encryptionReady} variant="secondary">
              <Plus className="size-4" />
              新增档案
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((p) => (
            <li key={p.id}>
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      {p.isLocal ? (
                        <Cpu className="size-4 text-muted-foreground" aria-hidden />
                      ) : (
                        <Cloud className="size-4 text-muted-foreground" aria-hidden />
                      )}
                      {p.name}
                    </CardTitle>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`${p.name} 的操作`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!p.isDefault && (
                          <DropdownMenuItem onSelect={() => makeDefault(p)}>
                            <Star className="size-4" />
                            设为默认
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => void testConnection(p)}
                          disabled={testing === p.id}
                        >
                          {testing === p.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <PlugZap className="size-4" />
                          )}
                          测试连接
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openEdit(p)}>
                          <Pencil className="size-4" />
                          编辑
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="size-4" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="truncate text-muted-foreground">{p.model}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">{MODEL_PROVIDER[p.provider]}</Badge>
                    {p.isLocal ? (
                      <Badge className="border-transparent bg-success/15 text-success">
                        本地端点
                      </Badge>
                    ) : (
                      <Badge variant="outline">云端</Badge>
                    )}
                    {p.isDefault && (
                      <Badge className="border-transparent bg-primary/15 text-primary">
                        默认
                      </Badge>
                    )}
                  </div>
                  {!p.isLocal && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <KeyRound className="size-3.5" aria-hidden />
                      {p.hasKey ? p.maskedKey : "未配置密钥"}
                    </p>
                  )}
                  {p.statusNote && (
                    <p className="text-xs text-muted-foreground">{p.statusNote}</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑模型档案" : "新增模型档案"}</DialogTitle>
            <DialogDescription>
              密钥仅在本机加密保存，不会进入客户端、导出包或日志。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pf-name">
                名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pf-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：本地 Ollama"
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-provider">供应商</Label>
              <Select
                value={form.provider}
                onValueChange={(v) => {
                  const provider = v as ModelProvider;
                  setForm({
                    ...form,
                    provider,
                    isLocal: provider === "ollama" || provider === "lmstudio",
                  });
                }}
              >
                <SelectTrigger id="pf-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MODEL_PROVIDER).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-model">
                模型名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pf-model"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder={hint.model}
                aria-invalid={Boolean(errors.model)}
              />
              {errors.model && <p className="text-xs text-destructive">{errors.model}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-base">服务地址</Label>
              <Input
                id="pf-base"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder={hint.baseUrl}
                aria-invalid={Boolean(errors.baseUrl)}
              />
              {errors.baseUrl ? (
                <p className="text-xs text-destructive">{errors.baseUrl}</p>
              ) : (
                <p className="text-xs text-muted-foreground">留空则使用供应商默认地址。</p>
              )}
            </div>

            {!isLocalProvider && (
              <div className="space-y-1.5">
                <Label htmlFor="pf-key">
                  API 密钥 <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="pf-key"
                    type={showKey ? "text" : "password"}
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder={editing?.hasKey ? "留空则保持不变" : "粘贴密钥"}
                    aria-invalid={Boolean(errors.apiKey)}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowKey((s) => !s)}
                  >
                    {showKey ? "隐藏" : "显示"}
                  </Button>
                </div>
                {errors.apiKey && <p className="text-xs text-destructive">{errors.apiKey}</p>}
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="pf-local" className="cursor-pointer">
                  本地端点
                </Label>
                <p className="text-xs text-muted-foreground">
                  开启后请求只留在本机，不会发送到云端。
                </p>
              </div>
              <Switch
                id="pf-local"
                checked={form.isLocal}
                onCheckedChange={(v) => setForm({ ...form, isLocal: v })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "保存中…" : editing ? "保存修改" : "创建档案"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除模型档案？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{deleteTarget?.name}」。已使用该档案的记录会保留，但不再关联模型。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
