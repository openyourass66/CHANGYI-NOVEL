"use client";

import { useSyncExternalStore } from "react";
import { CircleCheck, Info, OctagonX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PromptKind = "success" | "error" | "warning" | "info";
type Prompt = { id: number; kind: PromptKind; message: string; description?: string };

const titles: Record<PromptKind, string> = {
  success: "操作成功",
  error: "操作失败",
  warning: "请注意",
  info: "提示",
};
const icons = {
  success: CircleCheck,
  error: OctagonX,
  warning: TriangleAlert,
  info: Info,
};
const colors: Record<PromptKind, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-primary",
};

let nextId = 0;
let prompts: Prompt[] = [];
const listeners = new Set<() => void>();
const emptyPrompts: Prompt[] = [];

function publish() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function enqueue(kind: PromptKind, message: string, options?: { description?: string }) {
  if (prompts.some((prompt) => prompt.kind === kind && prompt.message === message && prompt.description === options?.description)) return;
  prompts = [...prompts, { id: ++nextId, kind, message, description: options?.description }];
  publish();
}

function dismiss(id: number) {
  prompts = prompts.filter((prompt) => prompt.id !== id);
  publish();
}

/** 操作反馈统一进入弹窗队列，避免连续操作时覆盖前一条提示。 */
export const notify = {
  success: (message: string, options?: { description?: string }) => enqueue("success", message, options),
  error: (message: string, options?: { description?: string }) => enqueue("error", message, options),
  warning: (message: string, options?: { description?: string }) => enqueue("warning", message, options),
  info: (message: string, options?: { description?: string }) => enqueue("info", message, options),
};

export function OperationPromptHost() {
  const queue = useSyncExternalStore(subscribe, () => prompts, () => emptyPrompts);
  const prompt = queue[0];
  const Icon = prompt ? icons[prompt.kind] : Info;

  return (
    <Dialog key={prompt?.id ?? "empty"} open={Boolean(prompt)} onOpenChange={(open) => {
      if (!open && prompt) dismiss(prompt.id);
    }}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        {prompt && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-left">
                <Icon className={`size-5 shrink-0 ${colors[prompt.kind]}`} aria-hidden="true" />
                {titles[prompt.kind]}
              </DialogTitle>
              <DialogDescription className="break-words text-left text-foreground">
                {prompt.message}
              </DialogDescription>
            </DialogHeader>
            {prompt.description && <p className="break-words text-sm text-muted-foreground">{prompt.description}</p>}
            <DialogFooter>
              <Button className="min-h-11" onClick={() => dismiss(prompt.id)} autoFocus>知道了</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
