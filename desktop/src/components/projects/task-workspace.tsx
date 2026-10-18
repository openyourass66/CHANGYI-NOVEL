import { type ReactNode, useEffect, useRef, useState } from "react";
import { PageFrame, ScrollRegion } from "@/components/page-frame";
import { StageRail, type Stage } from "./stage-rail";
import { Button } from "@/components/ui/button";

export function TaskWorkspace({ projectId, projectName, section, description, stages, taskType, onSelect, running, modelName, configuration, children }: {
  projectId: string; projectName: string; section: string; description: string;
  stages: Stage[]; taskType: string; onSelect: (key: string) => void; running: boolean;
  modelName?: string; configuration: ReactNode; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const configurationRef = useRef<HTMLDetailsElement>(null);
  const active = stages.find((stage) => stage.key === taskType);
  useEffect(() => { setExpanded(!running); }, [taskType]);
  useEffect(() => { if (running) setExpanded(false); }, [running]);
  function showConfiguration() {
    setExpanded(true);
    configurationRef.current?.closest(".workspace-scroll")?.scrollTo({ top: 0, behavior: "instant" });
  }
  return <PageFrame projectId={projectId} title={projectName} section={section} description={description} toolbar={<>
    <span className="text-sm font-medium">{active?.label}</span><span className="text-xs text-muted-foreground">模型 · {modelName ?? "尚未选择"}</span>
    <Button variant="outline" size="sm" className="toolbar-end" onClick={showConfiguration}>配置任务</Button>
  </>}>
    <div className="workspace-split">
      <aside className="workspace-sidebar" aria-label={section === "理解分析" ? "分析步骤" : "创作步骤"}>
        <h2 className="workspace-sidebar-heading">{section === "理解分析" ? "分析步骤" : "创作步骤"}</h2>
        <StageRail stages={stages} activeKey={taskType} onSelect={onSelect} disabled={running} vertical />
      </aside>
      <section className="workspace-panel">
        <div className="workspace-panel-heading"><h2>{active?.label}</h2><small>{running ? "任务进行中" : active?.meta ?? "按步骤完成当前任务"}</small></div>
        <ScrollRegion label={`${section}内容`} className="task-content" positionKey={`${projectId}:${section}:${taskType}`}>
          <details ref={configurationRef} className="task-configuration" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
            <summary>任务配置{running ? " · 当前任务运行中" : ""}</summary>
            {configuration}
          </details>
          {children}
        </ScrollRegion>
      </section>
    </div>
  </PageFrame>;
}
