# 应用更新与发布

应用启动 5 秒后检查正式版本，此后每 6 小时检查一次；设置中的“关于与更新”可手动检查。后台检查网络失败不打断使用，手动检查显示错误。用户选择下载后校验更新签名，确认已保存内容后才安装。存在自动流程或待执行、运行中的分析任务时，安装被阻止；安装准备期间拒绝新的业务 API 请求。

## 签名密钥

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
