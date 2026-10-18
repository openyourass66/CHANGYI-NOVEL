import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Popover } from "radix-ui";
import { ChevronDown, Database, X } from "lucide-react";
import { api } from "../bridge";

type Totals = { input: number | null; output: number | null; total: number | null; requests: number; unknown: number; pending: number; legacy: number };
type Usage = { task: Totals; project: Totals; global: Totals; models: string[]; taskId: string | null; running: boolean; projectId: string | null; projectName: string | null };
const number = (value: number | null) => value === null ? "未提供" : value.toLocaleString("zh-CN");
function Amount({ value }: { value: Totals }) {
  return <><div className="text-3xl font-semibold tabular-nums tracking-tight">{value.requests === 0 ? "0" : (value.total === null && value.pending > 0 ? "等待返回" : number(value.total))} <span className="text-sm font-normal text-muted-foreground">Token</span></div>
    <div className="mt-3 grid grid-cols-2 gap-4 text-sm"><div><span className="text-muted-foreground">输入 Token</span><p className="mt-1 font-medium tabular-nums">{value.requests === 0 ? "0" : number(value.input)}</p></div><div className="border-l pl-4"><span className="text-muted-foreground">输出 Token</span><p className="mt-1 font-medium tabular-nums">{value.requests === 0 ? "0" : number(value.output)}</p></div></div>
    {value.unknown > 0 && <p className="mt-2 text-xs text-muted-foreground">{value.unknown} 条用量记录不完整；以上仅累计已知用量</p>}</>;
}
export function TokenUsage() {
  const { pathname } = useLocation();
  const projectId = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
  const [data, setData] = useState<Usage | null>(null);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    setData(null);
    const poll = async () => {
      const query = new URLSearchParams();
      if (projectId) query.set("projectId", projectId);
      if (model) query.set("model", model);
      try { const result = await api<Usage>(`/api/token-usage?${query}`); if (active) { setData(result); setError(""); } }
      catch (e) { if (active) setError(String(e)); }
      if (active) timer = setTimeout(() => void poll(), 1500);
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [projectId, model]);
  const headline = data?.running ? data.task : data?.global;
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild>
    <button className="flex min-h-9 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="查看 Token 用量">
      <Database className="size-4" /><span className="hidden sm:inline">{data?.running ? "当前任务" : "全部累计"}</span><strong className="tabular-nums">{error ? "暂不可用" : headline ? headline.requests === 0 ? "0" : (headline.total === null && headline.pending > 0 ? "等待返回" : number(headline.total)) : "加载中"}</strong><span className="hidden sm:inline">Token</span><ChevronDown className="size-3" />
    </button>
  </Popover.Trigger><Popover.Portal><Popover.Content align="end" sideOffset={12} collisionPadding={12} className="z-50 max-h-[calc(100dvh-90px)] w-[min(430px,calc(100vw-24px))] overflow-y-auto rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl" aria-label="Token 用量详情">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Token 用量</h2><Popover.Close aria-label="关闭用量面板" className="rounded p-2 hover:bg-muted"><X className="size-4" /></Popover.Close></div>
    <div className="my-4 flex items-center justify-between gap-3"><span className="truncate text-sm text-muted-foreground">{data?.projectName ?? "全部项目"}</span><select aria-label="筛选用量模型" value={model} onChange={(e) => setModel(e.target.value)} className="max-w-48 rounded-md border bg-popover p-2 text-sm"><option value="">全部模型</option>{data?.models.map((m) => <option key={m}>{m}</option>)}</select></div>
    {error && <p role="alert" className="mb-3 text-sm text-destructive">用量刷新失败：{error}</p>}
    {data && <><section className="rounded-lg border border-primary/20 bg-primary/5 p-4"><div className="mb-3 flex justify-between text-sm text-muted-foreground"><span>{data.running ? "当前任务累计" : "最近任务累计"}</span><span>{data.running ? "● 任务进行中" : "任务已结束"}</span></div>{data.taskId ? <Amount value={data.task} /> : <p className="text-sm text-muted-foreground">暂无任务</p>}{data.running && <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">{data.task.pending ? "正在请求模型，等待本次用量返回" : "等待下一步任务；用量随模型响应更新"}</p>}</section>
    <section className="border-b py-4"><p className="mb-2 text-sm text-muted-foreground">当前项目累计</p>{data.projectId ? <Amount value={data.project} /> : <p className="text-sm text-muted-foreground">请选择项目</p>}</section>
    <section className="py-4"><p className="mb-2 text-sm text-muted-foreground">全部项目累计</p><Amount value={data.global} /></section>
    <div className="border-t pt-3 text-xs leading-5 text-muted-foreground"><p>每次模型返回后更新；包含失败与重试请求。</p>{data.global.legacy > 0 && <p>已导入历史已记录用量；旧版未记录的消耗无法补算。</p>}<p>全部累计包含连接测试及已删除项目的用量。</p></div></>}
  </Popover.Content></Popover.Portal></Popover.Root>;
}
