export type RunPreview = {
  taskType: string;
  taskLabel: string;
  provider: string;
  providerLabel: string;
  model: string;
  isLocal: boolean;
  unitCount: number;
  unitLabel: string;
  totalChars: number;
  estimatedPromptChars: number;
  sampleText: string;
  note: string;
};
