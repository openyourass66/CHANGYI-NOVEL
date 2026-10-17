/** 项目列表的跨运行环境视图类型。 */
export type ProjectSummary = {
  id: string;
  name: string;
  language: string;
  genre: string | null;
  createdAt: string;
  updatedAt: string;
  chapterCount: number;
  sourceCount: number;
  memoryCount: number;
};
