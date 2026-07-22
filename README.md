# furry-agent-pet

一个以轻量、离线优先和跨平台为目标的桌宠，用角色动作和文字气泡展示支持 MCP 的 AI Agent 正在思考、规划、编码、测试、成功或遇到错误。

产品范围与验收标准见 [`docs/PRD.md`](docs/PRD.md)，本轮完整证据见 [`docs/SMOKE_TEST_REPORT.md`](docs/SMOKE_TEST_REPORT.md)，资源包格式见 [`docs/PET_PACKAGES.md`](docs/PET_PACKAGES.md)，当前实现状态见 [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)，Windows 安装验证见 [`docs/WINDOWS_INSTALLER.md`](docs/WINDOWS_INSTALLER.md)，实测性能基线见 [`docs/PERFORMANCE_BASELINE.md`](docs/PERFORMANCE_BASELINE.md)。

Windows 11 x64 当前 Debug 源码已在 `.cache/native-windows-smoke/1784697111517-1268` 通过完整原生套件：七状态/四 GIF、异常恢复、气泡、首次引导/Store v1、悬停/拖拽嵌套、可由角色包定制时长的 `clicked` 一次性动作、拖拽不误触点击、系统和手动 reduced-motion 的 GIF→静态角色→当前 GIF 恢复、手动设置跨重启恢复、140 样本延迟、1001 条 burst、透明合成、Z-order、真实 `(96,64)` 拖动、六项托盘和 `sleeping.gif @ 60,020.66 ms` 均通过，`success=true`、`cleanupSafe=true`。本次 run 从当前源码完整重建 20,264,448-byte Debug EXE（SHA-256 `BE0C7AD5499978751AC0BEA81CDA641DEA3F01C88FFCC731EF4E2B78F8AB5382`）；完整 `npm run check` 为 14/14 Vitest 文件、74/74 前端测试和 57/57 Rust 测试。2026-07-16 的 NSIS/安装后 Release 仍是发布基线，尚未包含交互层和静态降级更新。macOS、Linux X11/Wayland、物理多显示器/混合 DPI/负坐标、Windows 10/ARM64 和真实外部 Agent UI 尚未原生验收；安装包签名、美术许可、初始角色的授权静态 poster，以及减少动态效果前后的 CPU/内存量化也仍待完成。详见 [`docs/SMOKE_TEST_REPORT.md`](docs/SMOKE_TEST_REPORT.md)。

要接入真实 Agent，请按 [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md) 注册 `furry-companion-mcp`；桌宠本身不是 MCP stdio server。

仓库已在本轮用 npm 发布版 `furry-companion-mcp 0.2.0` 复跑 MCP 初始化、`set_state` 调用和隔离 Named Pipe 事件，耗时约 `5.6 s`；安装后的桌宠 UI 与真实 Agent 客户端之间仍需补一次完整端到端验收。

## 当前能力

- Tauri 2 透明、无边框、置顶窗口，可通过桌宠或设置面板标题栏拖动，并可缩放、调整透明度；恢复到已移除显示器的位置时，会按当前显示器工作区和 DPI 计算安全位置，并恢复已保存的显示/隐藏状态。首次启动或托盘不可用时保证窗口可达。
- Windows Named Pipe 消费端（已实测）与 macOS/Linux Unix Socket 代码路径（待目标平台验证）。Linux 当前采用“启动始终可见、关闭直接退出”的可达性降级，仍需分别在 X11/Wayland 实测。
- 64 KiB 有界增量解析，支持半包、粘包、CRLF、非法事件恢复。
- 断线后按 1、2、4、8、16、30 秒退避重连，连接状态与 Agent 错误分离；短命连接立即 EOF 不会把退避错误重置为 1 秒。
- 七种 Agent 状态；Rust 在 50 ms 窗口收敛高频重复非终态，重复同状态的详情更新不会重置视觉计时。Rust 到主线程的 publication queue 最多保留 64 项、可合并队尾，并按连接 generation 淘汰旧事件，避免重连竞态覆盖新状态或让积压无界增长。
- 普通、file-only、success 和 error 气泡；支持悬停/焦点/选择文本暂停，error 保持到用户确认或新事件覆盖。
- 系统托盘：显示/隐藏、恢复位置、置顶、设置、重连和退出；设置页也提供完全结束后台进程的退出入口。
- Rust 统一校验并写入 Tauri Store 的设置持久化，以及 Single Instance；前端不维护第二种磁盘格式。
- 首次启动接入向导提供可一键复制给 Agent 的完整提示词、连接状态和重新检测；不显示自定义 IPC 地址或最近事件时间。
- manifest 驱动的宠物包目录和运行时选择/切换基础设施；当前只内置一个包，可为七种状态分别选择包内动作，并以可选 `interactions` 独立扩展拖拽、悬停、点击等短暂动作及一次性动作时长。
- 悬停与真实窗口拖拽已接入 token 化交互控制器，点击接入可复用的有界一次性动作控制器：角色包可为一次性动作声明 `durationMs`（100–60,000 ms），未声明时 `clicked` 使用 650 ms；重复点击只刷新结束时间，动作结束后恢复仍有效的交互或最新 Agent 状态，真实拖拽产生的浏览器合成点击会被抑制。
- 角色包提供专用交互动画时只渲染包内资源，不叠加内置 CSS；未提供映射时才使用有界、低成本的 `hovering`、`dragging`、`clicked` CSS 后备。动作语义与后备效果分别记录，新增交互无需扩充七状态 IPC。
- 操作系统要求减少动态效果时，活动 GIF 会停止显示并优先切换到角色包映射的静态动作，未配置时使用内置静态角色；CSS 悬停/拖拽/点击/庆祝效果同时关闭。系统偏好恢复后回到当时最新的状态或交互动作，静态 PNG/WebP 无需降级；设置页不再提供重复的手动开关。
- 角色包可通过 `reducedMotionAnimations` 把每个 GIF 动作映射到同一动画字典中的非循环 PNG/WebP；这些静态资源复用完整的 Rust 导入、安全解码、快照和 asset protocol 边界。初始四 GIF 包尚无专用 poster，继续使用内置静态后备。
- 桌面设置页可选择本地 `pet.json`。Rust 会验证 manifest、相对路径、真实媒体格式、尺寸与解码成本，再把 manifest 和被引用资源复制成应用数据目录中的内容寻址快照；原始目录无需长期授权，导入后可以移动或删除。Rust DTO 为每个已安装媒体返回明确的绝对 `assetPaths`，前端逐文件调用 `convertFileSrc`，不再依赖 Windows encoded backslash URL 的相对解析。
- 设置与首次接入向导在桌宠右侧展开，不遮挡角色；设置内容独立滚动，关闭按钮固定在右上角。接入向导提供可一键复制给 Agent 的提示词，MCP 始终使用平台默认地址自动连接。
- 应用和 Windows 安装器统一命名为 `furry-agent-pet`，并使用仓库内 `src-tauri/icons/FAS_logo.png` 派生图标。正式 NSIS 安装器请求管理员权限，支持选择包括受限目录在内的安装路径。
- 本地快照可从设置页删除；删除前先切回内置默认包，删除命令只接受导入器生成的 `local-<24 位十六进制>` ID，并再次校验受管目录边界。

## 技术栈

- Tauri 2 + Rust + Tokio
- Vanilla TypeScript + Vite
- Tauri Store、Window State、Single Instance
- Vitest

## 环境要求

- Node.js 20 或更高版本
- Rust stable
- Windows：MSVC Rust 工具链、Visual Studio C++ Build Tools、WebView2
- macOS/Linux：遵循 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

项目命令会在 Windows 上自动加载 Visual Studio Developer Environment。若终端找不到 Rust，重启终端以重新加载用户 `PATH`。

Windows 缺少 C++ workload 或 Windows SDK 时，在 Visual Studio Installer 中导入仓库根目录的 `.vsconfig`。macOS 透明窗口启用了 Tauri private API，因此未来发布方式应使用站外签名/公证，不以 Mac App Store 为目标。

## 本地开发

安装依赖：

```bash
npm install
```

终端一启动协议兼容模拟器：

```bash
npm run mock:ipc
```

默认 demo 会依次发送 `thinking`、`planning`、`coding`、`testing`、`error`、`success`，连接建立时还会先发送 `idle`。

终端二启动桌宠：

```bash
npm run tauri:dev
```

模拟半包、粘包和非法输入：

```bash
npm run mock:ipc:protocol
```

已安装到本地测试目录的发布版 runtime 可用仓库脚本验证：

```bash
npm run smoke:mcp:published -- --runtime <furry-companion-mcp-dist-index.js>
```

质量检查和当前平台的 release 构建：

```bash
npm run check
npm run tauri:build
```

Windows 隔离 Debug 原生冒烟（自动构建、随机 Named Pipe/CDP 端口、隔离 AppData）：

```bash
npm run smoke:windows:native
```

已经生成最新 Debug EXE 时可使用 `npm run smoke:windows:native -- --skip-build`，但该模式不能证明本次源码已重建。脚本会验证七状态与四个 GIF 映射、异常协议、气泡交互、首次向导、Rust-owned 设置的磁盘 schema 与重启恢复、140 样本状态延迟、1001 条 burst、真实 60 秒 idle 变体、`WM_CLOSE` 隐藏、隐藏状态持久化、重启恢复、第二实例唤醒、两色透明合成、实际 Z-order 置顶开关、无边框 client 几何、真实鼠标拖动、真实托盘交互以及隔离数据清理。2026-07-16 最新当前源码完整重建 run 的证据生命周期为 `188.820 s`（`2026-07-16T11:32:14.653Z` 到 `2026-07-16T11:35:23.473Z`），证据目录 `.cache/native-windows-smoke/1784201511453-9204`；Debug EXE 为 20,196,864 bytes，SHA-256 `33D052E6D24DB481F364AAC23BF6582784F3911377F5676ED725A42BC17836F4`。140 样本为 p50 `1.53 ms`、p95 `6.08 ms`、max `8.25 ms`，1001 条事件对应 2 次 DOM marker 更新；`sleeping.gif` 在 60,018.8381 ms 被观察到，图片完整、自然尺寸 576 x 530 且无图片错误。透明、Z-order、client/window 几何、`(96,64)` 真实拖动和六项托盘交互均通过。connecting/disabled 仅有单测映射，tooltip 只断言绑定托盘图标的 UIA accessible name 包含状态，普通任务栏图标缺失未被明确验证。Debug 链接阶段的 MSVC runtime PDB `LNK4099` 是非阻断警告。

`npm run check` 会执行类型检查、前端自动化测试、Rust 测试、`cargo check`、Rust 格式检查和前端生产构建。

Windows x64 NSIS 开发安装包：

```bash
npm run tauri:build:windows -- --no-sign --ci
```

从当前源码构建正式/隔离安装器并验证安装、隔离启动、窗口响应、卸载和零残留：

```bash
npm run smoke:windows:installer
```

可使用 `-- --preflight-only` 只做安全预检，或使用 `-- --skip-build` 复验磁盘上的已有安装器；后者不能单独证明当前源码构建。正式安装器采用 per-machine 模式并触发 UAC；自动化 harness 的隔离身份仍使用非管理员 current-user 安装、跨运行独占锁、本次 run 内的产物快照、隔离 `/D=` 目录和独立 `furry-agent-pet-smoke.exe`，不会启动或清理正式身份 AppData。原生与安装器 smoke 共享原子的 desktop-interaction lock；仍应串行执行，重叠运行会 fail closed。

产物位于 `src-tauri/target/release/bundle/nsis/`，交付副本位于 `artifacts/windows/`。当前 `furry-agent-pet` FAS Logo 安装器为 5,766,250 bytes，SHA-256 `81D40108AFF885D99DEBF37C7B31C434B322790B1ADFD46CD398FA06E413DDAF`，Authenticode 为 `NotSigned`；生成的 NSIS 明确包含安装目录选择页、`perMachine` 和 `RequestExecutionLevel admin`，安全预检已通过。2026-07-16 的完整安装/卸载与安装后 Release 套件仍是历史生命周期基线；公开发布前还需为当前产物完成完整安装器复跑、签名与美术授权确认。

## 宠物资源

内置资源目录由 `public/pets/index.json` 管理，首个角色包位于 `public/pets/furry-ai-state/`：

```text
pet.json
animations/
  idle.gif
  coding.gif
  sleeping.gif
  exhausted.gif
```

`pet.json` 将 Agent 状态映射到动画 ID，并支持延迟状态变体。当前 `idle` 持续满 60 秒后切换到 `sleeping`；当前 Debug 与安装后 Release 已分别在 60,018.8381 ms 和 60,028.4089 ms 观察到完整的 576 x 530 `sleeping.gif`，且无图片错误。后续加入 thinking、planning、testing、success 等专用资源时，只需把文件放入包目录、扩展动画字典和状态映射，不需要修改渲染器。新增整个内置角色包时，再把包 ID 与 manifest 路径登记到 `public/pets/index.json`，设置页会自动列出它。

可扩展性回归直接读取真实 `public/pets/index.json`：TypeScript 使用生产 catalog loader 加载每个条目并解析七状态，另递归扫描每个包的 GIF/PNG/WebP，要求媒体集合与 manifest 的唯一引用集合完全一致，因此能同时发现缺失资源和孤儿媒体；Rust 测试也遍历真实 catalog，并对每个包调用 `validate_package_source()` 校验所有已声明媒体。四个初始 GIF 的 SHA-256、七状态映射和 `idle → sleeping @ 60000 ms` 作为兼容性子集锁定，不限制继续增加新动作。

延迟变体由可注入定时器的 scheduler 管理，自动化覆盖 60 秒边界、状态切换取消、用户 override 禁用、过期 state revision 和旧 schedule generation。设置中修改非当前状态的 override 只持久化配置，不会重渲染或重新调度当前 `idle`，避免无关设置操作唤醒当前动画。

在桌面应用的设置页选择“导入 pet.json”即可安装本地包。当前导入器接受 GIF、静态 PNG 和静态 WebP；APNG 与动画 WebP 会被拒绝，PNG/WebP 必须在 32 MiB 解码内存边界内完成真实解码。主要边界为：manifest 64 KiB、最多 64 个动画、单个媒体 10 MiB、manifest 与全部唯一引用媒体合计 64 MiB、画布和实际媒体宽高各 2048 px、整包累计解码像素 120,000,000、GIF 最多 300 帧且每轮最多 60 秒，以及最多 32 个本地快照。完整 manifest 契约、GIF 帧率/像素预算、WebP 容器校验和路径规则见 [`docs/PET_PACKAGES.md`](docs/PET_PACKAGES.md)。

应用只通过受限的 Tauri asset protocol 展示应用数据目录 `pet-packages/` 下已验证的快照，不向前端开放通用文件系统权限。相同内容会得到相同的本地包 ID；损坏或被篡改的快照会在启动扫描时被跳过，已失效的选择会回退到内置默认包。

Windows 隔离 Debug runtime 已验证：原生文件对话框导入成功，设置只保存 `local-…` ID 且不含源路径，快照中的 manifest 与四个 GIF 哈希逐一等于源文件；源目录改名后重启仍能显示本地包，间隔 750 ms 的两帧采样有 45.08% 像素变化，证明 GIF 正在播放；从 UI 删除后快照目录消失，设置恢复为 `furry-ai-state`。2026-07-16 安装器基线已通过正式身份安装/卸载及隔离 Release 的当时全量套件，但尚未重复本地角色包原生 dialog/import/delete/恶意包 UI，也不包含当前交互层和 reduced-motion 更新；macOS/Linux 实机仍待验证。完整记录见 [`docs/SMOKE_TEST_REPORT.md`](docs/SMOKE_TEST_REPORT.md)。

这四个 GIF 来自用户提供的本地 `furry-ai-state` 资源。公开分发前仍需确认美术作者和再分发许可。本地导入功能不改变作品授权，用户仍需确保所导入资源具备合法使用权。

## Agent 状态链路

```text
MCP Agent
  -> furry-companion-mcp set_state
  -> Named Pipe / Unix Domain Socket (JSON Lines)
  -> Rust IPC consumer
  -> Tauri events
  -> Pet renderer + completion bubble
```

Agent 成功完成任务时，通过 `success.message` 返回一段结束语，桌宠会在庆祝效果旁完整展示该文本。重复同状态事件可以更新 `message`/`file`，但不会重置 success 返回 idle 或 idle 延迟动作的计时；`error` 会保持到新的合法事件或用户确认，确认不会向 Runtime 反向发送状态。
