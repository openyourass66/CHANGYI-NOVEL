# 应用更新与发布

应用启动 5 秒后检查正式版本，此后每 6 小时检查一次；设置中的“关于与更新”可手动检查。后台检查网络失败不打断使用，手动检查显示错误。用户选择下载后校验更新签名，确认已保存内容后才安装。存在自动流程或待执行、运行中的分析任务时，安装被阻止；安装准备期间拒绝新的业务 API 请求。

## 签名密钥

Windows 安装包使用基于 Tauri CLI v2.12.3 的定制 NSIS 模板，保留当前用户的原安装位置；升级 CLI 时需同步审核模板。

公钥保存在 `src-tauri/tauri.conf.json`。对应私钥由维护者在仓库外保管，当前开发机为 `$env:USERPROFILE\.tauri\changyi-updater.key`。请备份私钥；不要重新生成并替换已经发布版本的公钥，否则旧客户端无法验证后续更新。私钥不上传 GitHub Release，不进入 Git。

## 发布步骤

1. 同步修改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本，并通过 Cargo 更新锁文件中的本包版本。
2. 准备 UTF-8 更新说明文件，例如 `release-notes.txt`。
3. 在已配置 Rust 和 Windows 构建工具的 PowerShell 中执行：

```powershell
Set-Location desktop
pnpm test
pnpm test:release
pnpm test:native
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\changyi-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm release:build ./release-notes.txt
```

`release:build` 执行前端构建、NSIS 打包和签名，然后在 `.release/<版本>/` 中生成 `latest.json`，并复制安装包及签名为英文附件名 `Changyi_<版本>_x64-setup.exe` 和 `.exe.sig`，避免 GitHub 修改中文附件名导致下载地址失效。请上传该目录中的英文附件。生成清单时会检查三个版本一致、更新说明非空、当前版本只有一个 x64 安装包且有签名。单独重新生成清单可执行 `pnpm release:manifest ./release-notes.txt`。

4. 在 `openyourass66/CHANGYI-NOVEL` 创建对应 `v<版本>` Release，上传 NSIS `.exe`、对应 `.exe.sig` 和 `latest.json`。清单中的文件名和 tag 必须与实际上传内容一致。
5. 所有附件上传完整后发布为最新正式版本；草稿和预发布版本不作为默认更新渠道。
6. 使用一个已接入更新功能的较低版本验证发现更新、签名下载、安装及升级后工作区数据完整性。不要在个人数据上进行破坏性测试。

更新入口：`https://github.com/openyourass66/CHANGYI-NOVEL/releases/latest/download/latest.json`。在第一个包含清单的正式版本发布前，此地址可能返回 404；手动检查会显示失败。GitHub 网络不可用时仍可通过原下载渠道手动安装。旧版未接入更新代码的用户需手动安装一次。

应用下载的更新包暂存在进程内存中，“稍后”可在本次运行内继续安装；关闭应用后需要重新下载。当前仅发布 Windows x64 更新。

## 原生更新链路验证

发布后可以使用同一 Tauri 更新插件检查公开端点并下载验证签名，无需启动业务界面或打开个人工作区：

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --example verify-update --release
Copy-Item ./src-tauri/target/release/WebView2Loader.dll ./src-tauri/target/release/examples/
& ./src-tauri/target/release/examples/verify-update.exe 0.2.13 .verify/downloaded-update.exe
```

第一个参数是验证客户端的当前版本。传入最新版本应返回没有更新。该工具不会让不含更新代码的旧版自动获得更新功能，而是用于验证插件的版本比较、公开下载和签名校验。

仅在已经备份、确认应用退出并准备执行真实安装时，可以增加第三个参数，指定要升级的已安装 `changyi.exe` 的绝对路径。工具会调起实际 Windows 更新安装程序并退出，不自动重启业务应用。安装后应核对程序版本、文件校验值、安装路径和工作区数据是否保留。

2026-10-19 已在 Windows 上使用真实公开 GitHub Release 和同一 Tauri 插件完成 `0.2.13 → 0.2.14` 的版本发现、下载、签名验证和 NSIS 安装。安装包清单为 `requireAdministrator`；更新插件调起安装后，程序及卸载信息均为 `0.2.14`，原安装路径保留，全部工作区文件和位置配置的 SHA-256 与升级前一致。验证工具关闭自动重启，业务应用未在验证中打开个人工作区。

## 0.2.14 同版本名称修正

应用显示名称已统一更正为「长忆」。安装器保留旧内部注册表标识，用于识别既有安装记录、沿用原安装目录并更新卸载显示名称；属于当前安装的旧名称快捷方式会移除。应用标识和工作区位置配置保持不变。

此次重新打包仍使用 0.2.14，Release 的安装包、签名、ZIP、校验文件和更新清单必须配套替换。已安装 0.2.14 的客户端不会提示同版本更新，需手动重新安装；0.2.13 仍可发现更新。

本机已完成 0.2.14 同版本重新安装：程序、卸载列表与快捷方式显示为「长忆」，原安装路径保留；7 个工作区文件和两份位置配置的 SHA-256 与安装前一致。安装后程序与构建产物仅存在预期的 NSIS 包类型标记差异。
