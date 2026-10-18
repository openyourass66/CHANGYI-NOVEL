# 长忆 · 小说理解与续写工作台

当前主线只维护 **Tauri 原生桌面版 0.2.6**。网页版及旧 Electron 壳已移除，界面、文档解析、故事记忆和续写逻辑均独立保存在 `desktop/`，不再需要安装旧网页版依赖或启动后台 Web 服务。本次源码整理尚未重新生成安装包。

## 功能

- 项目创建与备份恢复，TXT、Markdown、DOCX、EPUB、HTML 和文本 PDF 导入，章节标题、排序、拆分、合并与删除。
- 故事记忆、人物认知、出处定位、历史版本和冲突审阅；逐章分析、全书统合与自动采纳。
- 自定义或生成续写方向、智能或手动规划章数、章纲与正文编辑、自动续写、取消及中断续跑。
- 按当前任务检索相关记忆，参考此前续写正文，并检查同方向章节之间的连续性；生成正文校验 1,800–3,500 字，不合格重试，失败保留已有内容。
- 独立作品库、阅读器、阅读位置与样式保存、TXT 导出，以及确认后将作品正文和记忆并入原作。
- Anthropic、OpenAI-compatible、Ollama 和 LM Studio 模型配置；密钥加密、云端数据授权和本地端点保护。
- 全局自动化配置、任务进度及完成提醒、工作区复制与切换、浅色和深色主题。

项目面向单用户本机使用，不提供账号和云端同步；扫描版 PDF 暂不支持 OCR。完整功能、安装包位置、数据兼容和使用说明见 [桌面版说明](desktop/README.md)。

## 开发与验证

需要 Node.js 22.13+、pnpm 11.1.1、Rust 和 Windows 构建工具。

```powershell
Set-Location desktop
pnpm install --frozen-lockfile
pnpm desktop:dev
```

日常检查与打包均在 `desktop/` 中运行：

```powershell
pnpm test
pnpm test:native
pnpm build
pnpm test:e2e
pnpm desktop:dist
```

`pnpm dev` 和 `pnpm preview` 只预览界面，普通浏览器不会连接本机工作区。实际使用请启动 Tauri 桌面应用。Windows x64 安装包输出到 `desktop/src-tauri/target/release/bundle/nsis/`，安装程序复用系统 WebView2。

## 数据与备份

以应用“设置 → 数据保存位置”显示的当前目录为准；源码整理不会更改已保存的数据目录，也不会删除原 `web/data` 或密钥文件。旧版用户选择现有工作区前，应先备份；兼容规则见桌面版说明。

关闭应用后复制整个工作区，包括隐藏的 `.changyi-storage.json`，可备份项目、独立作品库、模型配置及流程记录。单项目 JSON 不包含独立作品库、全局设置、模型档案或自动流程；阅读进度和样式保存在当前设备中。

环境配置、密钥、数据库、小说原文、本机依赖、构建产物和验证截图不提交到 Git。历史网页版与 Electron 版代码仍可从 Git 历史恢复，不再属于当前维护版本。

## 项目结构

```text
desktop/
├── src/                       # React 界面、组件、领域类型、导入解析及样式
├── src-tauri/
│   ├── src/                   # Rust 业务逻辑、模型接入与 SQLite 存储
│   ├── icons/                 # 桌面应用图标
│   └── tests/                 # 后端集成测试及旧数据库兼容样例
├── tests/                     # 浏览器集成验收（使用隔离的原生后端工作区）
├── scripts/                   # PDF 运行资源准备
└── README.md                  # 功能、数据兼容、安装和开发说明
```
