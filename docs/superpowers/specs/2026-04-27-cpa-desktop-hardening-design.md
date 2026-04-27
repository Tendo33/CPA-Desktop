# CPA Desktop — 上线工程化 & 体验打磨设计

- **Date**: 2026-04-27
- **Author**: simonsun (with AI pair)
- **Status**: Draft, awaiting user review
- **Targets**: `v0.1.x` (Phase 2) → `v0.2.0` (Phase 3)
- **Out of scope**: 不替换 CPA 自带 `management.html` 面板；不做 native Overview / Keys / Routes 页（留给后续 Phase 1）。

---

## 1. 背景与现状

CPA Desktop 当前（commit `9330c78`）功能上已显著领先参考项目 [eNkru/cpa-ui](https://github.com/eNkru/cpa-ui)：自管理 CPA 二进制、进程托管、健康监控、日志流、`config.yaml` 编辑、托盘、自启动、i18n、主题切换、CPA 一键热更新。

但距离"能稳定向公众分发"仍有缺口，集中在三类：
1. **发布工程**：无前端单测/lint/format；CI 仅做 typecheck + cargo check + clippy（且 clippy `continue-on-error`）；App 自身没有自更新；签名/公证流程未跑通。
2. **健壮性 & 可观测**：health monitor 死循环逻辑、CSP/fs scope 过宽、panic 无落盘、窗口大小未持久化、缺全局快捷键。
3. **前端工程**：组件全是行内 style，Tailwind v4 未真正使用；YAML 编辑器是裸 textarea，无校验/无备份；日志列表非虚拟列表，>5k 行会卡。

本设计分两个阶段，**Phase 2 聚焦上线，Phase 3 聚焦体验**。

---

## 2. Phase 2 — 上线工程化

### 2.1 测试与质量基线

**前端**
- 工具链：`vitest` + `@testing-library/react` + `jsdom` + `@vitest/coverage-v8`；`eslint@9` flat config（`@typescript-eslint`、`react-hooks`、`react-refresh`）；`prettier`；`.editorconfig`。
- 首批测试目标（最小高 ROI 集合）：
  - `lib/i18n.ts` — key 完备性（`zh.keys() === en.keys()`）、复数函数。
  - `lib/utils.ts` — `cn()` 合并行为。
  - `stores/cpa.ts`、`stores/logs.ts`、`stores/settings.ts` — reducer 行为。
  - `components/StatusBar.tsx` — `dotClass / statusColor` 矩阵。
- npm scripts 新增：`test`、`test:run`、`lint`、`lint:fix`、`format`、`format:check`、`typecheck`。
- **不引入覆盖率门槛**（首版避免堵车），仅 CI 打印报告。

**Rust**
- `cargo fmt --check`、`cargo clippy -- -D warnings`（移除 CI `continue-on-error`，先把现存 warnings 清零）。
- 新增单元测试：
  - `app_config::read_port_from_yaml` — 多种输入（缺 key、错类型、注释）。
  - `commands::updater::asset_name` — Win/macOS/Linux × x64/arm64 矩阵。
  - `cpa_manager::CpaStatus` 序列化与 `error` 字段 round-trip。
- 集成测试 `src-tauri/tests/cpa_lifecycle.rs`：用一个 mock binary（`echo + sleep` 的脚本）替代真实 CPA，验证 `spawn_cpa → check_process_alive → kill_cpa` 全链路。

### 2.2 健壮性补强（Rust）

| 文件 | 问题 | 修复 |
|---|---|---|
| `lib.rs::spawn_health_monitor` | 状态非 Running 时 `continue`，monitor 永不退出 | 重构：传入 `cancel: Arc<AtomicBool>`，stop/exit 时置位；非 Running 用 `tokio::time::sleep` 长休并周期性检查 cancel；Stopped/Idle 时直接 return |
| `lib.rs::http_ping` | 每次 ping 新建 `reqwest::Client` | 用 `OnceLock<reqwest::Client>` 共享，启动时构造一次 |
| `updater.rs::download_cpa_update` | 全文件读入 `Vec<u8>`；无完整性校验；失败无回滚 | 仍用内存（CPA 二进制 ≤80MB，可接受）；下载完成后比较 `downloaded == content_length`，失败则恢复 `cli-proxy-api.exe.old` |
| `tauri.conf.json::security.csp` | `connect-src` 含 `https://*` | 收紧为 `'self' http://localhost:* https://api.github.com https://github.com https://objects.githubusercontent.com https://*.githubusercontent.com` |
| `capabilities/default.json` | `fs:allow-app-{read,write}-recursive` 范围广 | 在 Tauri v2 fs scope 中限定到 `$APPDATA/cpa-desktop/**`；移除全 app 递归 |
| `lib.rs` setup auto_start | 用 `sleep 800ms` 后启动 | 改为监听 `tauri::RunEvent::Ready` 后再 spawn |

### 2.3 可观测 / Crash 上报（仅本地，不外发）

- **Rust panic hook**（`lib.rs` 顶部）：写入 `data_dir/logs/panic-YYYYMMDD.log`，并在 `app-settings.json` 标记 `last_panic_at` + 摘要。
- **App log**：新增 `data_dir/logs/app.log`，按日期切割，最大 5MB × 5 份。日志由 Rust 端 `log + env_logger` 接管。
- **前端 ErrorBoundary**：`src/components/ErrorBoundary.tsx` 包裹 `App`；捕获后调用 Rust 命令 `report_frontend_error(msg, stack)` 写入 `app.log`。
- **About 页**：若存在 `last_panic_at`，展示一条"上次崩溃于 X，[查看日志]"；点击 → `opener:open(panic log file)`。
- **Settings**：新增 "Open Log Folder" 按钮。
- **不引入 Sentry/PostHog**（YAGNI）。

### 2.4 Tauri 应用自更新（CPA Desktop 自身）

- 依赖：`tauri-plugin-updater = "2"`（Rust）+ `@tauri-apps/plugin-updater`（前端）+ `@tauri-apps/plugin-process`（用于 relaunch）。
- 密钥：本机 `tauri signer generate` 生成 ed25519 私钥；
  - 私钥进 GitHub Secrets：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
  - 公钥写入 `tauri.conf.json -> plugins.updater.pubkey`。
- 配置 `tauri.conf.json`：
  ```json
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": ["https://github.com/<owner>/CPA-Desktop/releases/latest/download/latest.json"],
      "pubkey": "<public key>"
    }
  }
  ```
- CI：`tauri-action` 加 `includeUpdaterJson: true`，自动产出 `latest.json` 并随 release 上传。
- UI：
  - `Settings → Application` 区底部加 "Check for app updates" 按钮 + 状态文案。
  - 启动 6 小时后自动检查一次（默认开启，但可在 Settings 关闭：`auto_check_app_updates: bool`）。
  - 发现新版用 `notification` 弹通知 → 点击展示 changelog 弹窗（来自 `latest.json` 的 `notes`）→ 用户确认才下载安装。
- **签名/公证暂不做**（决策 Q-A=3）。Windows 用户首次会遇 SmartScreen，README 中说明绕过方法；macOS 用户需 `xattr -cr`，README 同步。

### 2.5 用户感知的小修复

| 项 | 实现 |
|---|---|
| 窗口大小/位置持久化 | `tauri-plugin-window-state` |
| 全局快捷键（仅窗口 focused） | `tauri-plugin-global-shortcut`：`Cmd/Ctrl+R` 刷新嵌入 webview、`Cmd/Ctrl+,` 跳 Settings、`Cmd/Ctrl+L` 跳 Logs |
| 托盘菜单补充 | 在 `tray.rs` 现有项基础上加 "Open Log Folder"、"Check for App Updates" |
| README screenshots | 补 3 张（Dashboard/Logs/Settings），1280×800 |
| LICENSE 一致性 | 确认 LICENSE 文件实际为 MIT，与 README 对齐；若改变需同步 `tauri.conf.json` |
| 数据目录命名 | 沿用 `cpa-desktop` 字符串，但抽到 `app_config::APP_DIR_NAME` 常量 |
| 端口冲突提示 | 启动失败错误中检测 `port already in use` → 弹"端口 X 被占用，是否换 X+1？" |

### 2.6 CI 流水线增强

**`ci.yml`** 新增步骤：
```
- npm run lint
- npm run typecheck
- npm run test:run -- --coverage
- cargo fmt --check --manifest-path src-tauri/Cargo.toml
- cargo test --manifest-path src-tauri/Cargo.toml
- cargo clippy ... -- -D warnings   # 移除 continue-on-error
```

**`release.yml`** 改动：
- 注入 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- `tauri-action` `with.includeUpdaterJson: true`。
- macOS 签名 secret 用 `if: ${{ secrets.APPLE_CERTIFICATE != '' }}` 守卫，未配置时仍出未签名包但不阻塞。

### 2.7 Phase 2 验收标准

1. `npm run lint && npm run typecheck && npm test && cargo test && cargo clippy -- -D warnings` 全绿。
2. `git tag v0.1.1 && git push --tags` → 6 平台安装包 + `latest.json` 出现在 release。
3. 安装 v0.1.1 → 在 Settings 点 "Check for app updates" → 在本机模拟 `latest.json` 指向 v0.1.2 → 完成自更新且重启后版本显示 v0.1.2。
4. 手动 `kill -9 cli-proxy-api`：5–8s 内 UI 显示 Error；CPU 不持续上升（monitor 已退出）。
5. 故意触发 Rust panic（dev build 加测试命令）→ 重启后 About 页显示"上次崩溃"提示，可打开 panic log 文件。
6. 关闭主窗口后再启动，窗口位置和大小恢复。

---

## 3. Phase 3 — 体验 & 设计系统

**前置**：Phase 2 已发布且稳定运行 ≥1 周。

### 3.1 设计系统化

- **Token 同步**：把 `src/index.css` 的 `--c-*` 颜色 token 镜像到 Tailwind v4 `@theme` block；保留 CSS 变量做 fallback；现有页面无需立即改写。
- **基础组件**（`src/components/ui/`）：`Button` (primary/ghost/danger × sm/md)、`Input`、`NumberInput`、`Toggle`、`Select`、`Card`、`Section`、`Row`、`Pill`、`Toast`、`Modal`、`Tooltip`。统一用 `class-variance-authority`（已在依赖里）。
- **替换策略**：渐进式，不一次性大改。优先级：Settings → Logs → Dashboard → About → FirstRunSetup。
- **主题增强**：新增 `theme: 'system'`，监听 `prefers-color-scheme` 实时切换。

### 3.2 配置编辑器升级（薄表单 + YAML 双视图）

- **Tab 切换**：`Form` ↔ `YAML`。
- **Form 视图**（决策 Q-B=1，仅薄表单）：仅暴露 5 个字段：
  - `port`（NumberInput, 1024–65535）
  - `log_level`（Select: trace/debug/info/warn/error）
  - `auth.token`（密码型 Input，可显示/隐藏）
  - `auth.enabled`（Toggle）
  - `request_timeout_seconds`（NumberInput）

  其它字段仍通过 YAML 视图编辑。Form 字段通过 `serde_yaml::Value` 路径读写而非整文件覆写，避免破坏注释。
- **YAML 视图**：`Monaco editor` 懒加载（仅切到该 tab 时加载），带行号、YAML 语法高亮、错误下划线。
- **校验**：保存前 Rust 端 `serde_yaml::from_str::<serde_yaml::Value>(&new)` 失败则不写盘；前端展示行号 + 红框。
- **自动备份**：每次成功保存前把旧文件复制到 `data_dir/backups/config.yaml.<ISO timestamp>`，FIFO 保留最近 10 份；UI 提供"Restore from..."下拉。
- **Apply**：保存成功后弹"配置已保存，需要重启 CPA 才生效。立即重启？"

### 3.3 页面级体验改进

- **Dashboard**：嵌入 webview 顶部加细工具条：刷新、后退/前进（`webview.eval('history.back()')`）、复制 URL、在外部浏览器打开（`opener:open`）、缩放档（`webview.setZoom`）。webview 加载失败 5s 内无回包 → 显示 retry overlay。
- **Logs**：用 `@tanstack/react-virtual` 替换当前 `LogList.tsx` 的 DOM 渲染；导出按钮（保存为 `.log`）；显示进程 PID 列；"Regex" 切换让 search 走正则。
- **Settings**：用新 UI 组件替换；端口冲突一键 +1。
- **About**：精简到 ~150 行；展示 desktop 版本、CPA 版本、commit hash、链接（仓库/issues）；"上次崩溃"区在 Phase 2 已加。
- **FirstRunSetup**：多镜像源（`github.com`、`ghproxy.com`、用户自定义）；HTTP Range 断点续传；进度条用新 `ProgressBar` 组件。

### 3.4 i18n 重构

- 拆 `src/lib/i18n.ts` 到 `src/locales/{zh,en}.ts` + `index.ts` 聚合；保留现 `useT()` API 不变（向后兼容）。
- 复数串改 ICU MessageFormat（用轻量 `intl-messageformat`，约 +20KB gzip，可接受）。
- 准备 `ja.ts` 占位（不翻译，仅保证结构）。

### 3.5 可访问性

- 全部交互元素有可见 `:focus-visible` 样式。
- Sidebar 支持 `↑/↓` 导航。
- 状态点（`status-dot`）补 `aria-label`。
- 用 `axe-core` 在 dev build 跑一次扫描，目标 0 critical、≤5 minor。
- 文本基准从硬 `px` 改 `rem`，支持 OS 缩放。

### 3.6 Phase 3 验收标准

1. Settings、Logs、Dashboard 三页所有按钮/输入用 `components/ui/` 中的组件。
2. 错填 `port: abc` → 保存被拦截 + 红框；之前的合法配置可从 backups 恢复。
3. Logs 灌入 10k 行 → 滚动 60fps 无掉帧（Chrome devtools Performance 测）。
4. axe 扫描 ≤5 minor、0 critical。
5. 系统切换深浅色 → app 在 `system` 主题下实时跟随。

---

## 4. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| Tauri updater 公钥 + 未签名包在 macOS 被 Gatekeeper 拦 | 高 | 用户首次需 `xattr -cr` | README 加专章 + 后续补签名 |
| Monaco editor 体积大（~3MB gzip） | 中 | 安装包变大 | 懒加载到 YAML tab，仅按需下载 |
| `fs` scope 收紧后历史路径访问失败 | 中 | 启动报错 | 灰度：先并存（旧 + 新 scope），1 个版本后移除旧 |
| clippy `-D warnings` 现存 warnings 数量未知 | 中 | 工时膨胀 | Phase 2 第一天先跑一次 baseline，超过 30 个就分 PR 修 |
| 全局快捷键与系统冲突 | 低 | 用户困扰 | 仅在窗口 focused 时启用，且都是常规组合 |
| 自动备份目录无限增长 | 低 | 占空间 | FIFO 上限 10 份 |

---

## 5. 工作量与时间线

| 周 | 内容 |
|---|---|
| W1 | §2.1 测试 lint + §2.2 健壮性 |
| W2 | §2.3 crash + §2.4 自更新（含密钥流） |
| W3 | §2.5 小修复 + §2.6 CI + §2.7 验收 → **v0.1.x release** |
| W4 | §3.1 设计系统 + §3.3 体验小修复 |
| W5 | §3.2 配置编辑器（重头） |
| W6 | §3.4–3.6 + Phase 3 验收 → **v0.2.0 release** |

总计 ≈ 6 周（个人节奏，含调试缓冲）。

---

## 6. 决策记录

- **Q-A**（签名密钥）：选 **3** —— 先做 Tauri updater 公私钥（免费），代码签名延后。
- **Q-B**（配置 Form 表单深度）：选 **1** —— 薄表单，仅 5 个最常用字段。
- **不改** CPA 自带 `management.html` 嵌入面板。
- **不引入** Sentry/PostHog 等远程遥测。

---

## 7. 后续（不在本设计范围）

以下留给未来的 spec：

- Phase 1：Native Overview / Keys / Routes 页（依赖 CPA HTTP API 列表）。
- 完整代码签名（Apple Developer + SignPath/Azure Trusted Signing）。
- 第三语言（日语等）实际翻译。
- 配置 schema 完全表单化（Q-B 升级到 3）。
- 远程崩溃上报（如真有规模化用户）。
