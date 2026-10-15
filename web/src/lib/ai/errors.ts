/** 分析任务相关的错误类型。独立成模块，供任务定义与运行器共同引用，避免循环依赖。 */

export class AnalysisError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AnalysisError";
    this.status = status;
  }
}
