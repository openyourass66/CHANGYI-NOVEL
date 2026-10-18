import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { ProjectNav } from "@/components/projects/project-nav";
import { cn } from "@/lib/utils";

export function PageFrame({ title, description, actions, toolbar, projectId, section, children, className }: {
  title: string; description?: ReactNode; actions?: ReactNode; toolbar?: ReactNode;
  projectId?: string; section?: string; children: ReactNode; className?: string;
}) {
  return <div className={cn("page-frame", className)}>
    <header className="page-heading">
      <div className="min-w-0">
        <nav aria-label="当前位置" className="page-breadcrumb">
          <Link to={projectId ? "/" : section === "作品阅读" ? "/works" : "/"}>{projectId ? "项目库" : section === "作品阅读" ? "作品库" : "长亿"}</Link><span aria-hidden>/</span>
          {projectId && <><span className="truncate">{title}</span><span aria-hidden>/</span></>}
          <span aria-current="page">{section ?? title}</span>
        </nav>
        <h1 className="page-title">{title}</h1>
        {description && <div className="page-description">{description}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
    {projectId && <ProjectNav projectId={projectId} />}
    {toolbar && <div className="page-toolbar">{toolbar}</div>}
    <div className="page-content">{children}</div>
  </div>;
}

export function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="workspace-search"><Search className="size-4 shrink-0" aria-hidden /><span className="sr-only">{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} /></label>;
}

const positions = new Map<string, number>();
export function ScrollRegion({ children, className, label, positionKey, ready = true }: { children: ReactNode; className?: string; label: string; positionKey?: string; ready?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !positionKey || !ready) return;
    element.scrollTop = positions.get(positionKey) ?? 0;
  }, [positionKey, ready]);
  return <div ref={ref} tabIndex={0} role="region" aria-label={label} className={cn("workspace-scroll", className)} onScroll={(e) => { if (positionKey && ready) positions.set(positionKey, e.currentTarget.scrollTop); }}>{children}</div>;
}
