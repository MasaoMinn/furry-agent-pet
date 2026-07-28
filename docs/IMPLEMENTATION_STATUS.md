# 实现状态

更新日期：2026-07-28
当前里程碑：v0.2.0 已接入七状态专属预设资源、可展开动作预览、双路径 MCP 接入教程与项目介绍入口；应用范围为 Windows-only，并支持 Windows 开机自启、设置/向导侧栏自动左右避让和可选会话标题气泡。Agent 状态、用户交互动作与 reduced-motion 静态替代保持正交；既有四 GIF、七状态协议和 60 秒 `idle → sleeping` 兼容不变。完整历史证据见 [`SMOKE_TEST_REPORT.md`](SMOKE_TEST_REPORT.md)。

## 2026-07-28 v0.2.0 Windows 安装包

- npm、Rust crate 与 Tauri 配置版本统一为 `0.2.0`。
- `npm run check` 通过 24/24 Vitest 文件、109/109 前端测试、57/57 Rust 测试、TypeScript、`cargo check`、`cargo fmt --check` 和 production build。
- `npm run tauri:build:windows -- --no-sign --ci` 生成 15,654,606-byte NSIS `furry-agent-pet_0.2.0_x64-setup.exe`，SHA-256 `7B564985A5777C7499E4A94DDC28217AA9E24F49FD45A7C8E34EF7253B01B090`，Authenticode `NotSigned`；portable EXE 为 24,446,976 bytes，SHA-256 `6278CCF8F5FB4EC615FA8E83DFFCBECFB64887858650D94BEF0D4C0AE0B96350`。
- 安装器 preflight 因本机存在用户的 v0.1.0 安装记录而安全停止；未覆盖、卸载或清理现有应用，本轮不声明安装生命周期通过。Release 链接仍有非阻断 `LNK4099` 调试符号警告。

## 2026-07-28 接入教程与项目介绍

- 动作候选不再显示角色外观或动作情节的叙述性文案，只保留状态、动作 ID 和必要的中性无障碍文本。
- 接入向导改为“发送指令给代理”和“手动配置 MCP”两种方法；完整 Agent 指令、Codex 命令、两处 MCP JSON，以及三条排障命令均可独立复制。
- 设置页新增“项目介绍”按钮。Tauri Opener 仅被授权使用系统浏览器打开指定飞书 HTTPS 页面，不开放任意 URL 或本地路径。
- `npm run check` 通过 TypeScript、21/21 Vitest 文件、103/103 前端测试、57/57 Rust 测试、`cargo check`、`cargo fmt --check` 和 production build；随后新增固定 URL 调用回归并复跑为 22/22 Vitest 文件、104/104 前端测试。

## 2026-07-28 设置微调

- “复制指令”改为卡片右上角的小按钮；复制成功或失败时按钮直接显示结果，1.6 秒后恢复原文，所有代码段复制按钮使用相同行为。
- 内置资源包下拉项只显示 `Furry AI State`，不附带版本号；本地导入包保留来源与版本信息。
- 设置页移除“显示文件”勾选框，前端规范化会把旧 `showFilePath=true` 强制关闭；Rust Store 字段暂时保留用于向后兼容，产品 UI 不再允许开启。
- 开发规范明确：文案、样式、标签或单一控件的小改动只跑相关 Vitest、TypeScript 和必要的前端构建，不默认执行完整检查或 Windows 原生冒烟。
- 本次按该规范运行 4 个相关 Vitest 文件、21 个定向测试、`npm run check:frontend`、`npm run build`、native smoke 脚本语法检查和 `git diff --check`，均通过；未运行完整 Rust 或 Windows 原生套件。

## 2026-07-28 七状态预设资源与状态专属选择

- 从 `D:\IntegratedSourceOnDesktop\furry-ai-state\media\images` 接入七个状态目录中的 22 个逻辑预设。相同字节通过多个状态专属动画 ID 引用同一 `source`，因此包内实际保存 13 份唯一媒体；四个初始 GIF 的原路径与 SHA-256 保持不变。
- manifest 新增可选 `stateAnimationChoices`。显式声明时七状态必须齐全，每状态 1–16 个、整包最多 64 个、不得重复或引用未知动作，并且必须包含默认动作；延迟变体也只能引用所属状态候选。旧包省略时兼容为每状态只允许默认动作。
- 设置页仅从当前状态的候选列表生成动作卡；运行时解析和旧 Store override 校验使用相同列表，跨状态动作不会显示或渲染。15 个 GIF 逻辑动作均映射到所属状态的静态 PNG，系统减少动态效果不再退回通用占位图。
- 13 份唯一媒体已完成首帧联系表视觉检查；TypeScript 的真实 catalog 回归和 Rust `validate_package_source()` 已通过，确认媒体集合精确匹配、13 个唯一文件均可解码，整包为 13,036,029 bytes / 89,244,857 解码像素，满足既有 64 MiB / 120,000,000 像素边界。`npm run check` 通过 19/19 Vitest 文件、94/94 前端测试、57/57 Rust 测试、TypeScript、`cargo check`、`cargo fmt --check` 和 production build。
- 当前源码完整重建的 Windows Debug run `.cache/native-windows-smoke/1785220817686-16956` 为 `success=true`、`cleanupSafe=true`；30,294,016-byte EXE 的 SHA-256 为 `0DB8A51193DC3E3CAC8E9835363647D6086B2F4AC83A2C92457A3DC25B759212`。真实 WebView2 中 coding 行恰有 3 个本状态候选，跨状态 `error-2` 不存在；无 hover/焦点时 `coding-2` 已生成 132 px 宽静态首帧，选择后实时播放 `coding-2.gif`，恢复后播放默认 `coding.gif`。系统 reduced-motion 从 `idle.gif` 切换到包内 `idle-static.png`，恢复后回到 `idle.gif`。完整套件还通过七状态、140 样本 p50 `1.47 ms` / p95 `10.44 ms` / max `13.04 ms`、1001 条事件到 2 次 DOM marker、`sleeping.gif` 于 `60,045.80 ms` 激活、真实托盘/窗口/设置/开机自启/重启持久化和隔离清理。

## 2026-07-28 状态与候选动作卡片

- 动作设置总览改为七个整行状态项，每项直接显示当前动作；点击状态后在该行下方展开候选动作，再次点击可收起，选择后保持该行展开并立即更新状态动作。
- 状态与候选卡片无需 hover 或键盘聚焦即可看到实际媒体预览。GIF 通过 `fetch`、`createImageBitmap` 和有界画布生成并缓存首帧 PNG，PNG/WebP 直接作为静态预览；所有卡片仍只共享一个生产 `PetRenderer` 实时动画元素，当前状态或当前选中候选播放实时动画，不会同时解码全部 GIF 动画。
- 设置打开时点击宠物周围空白会关闭设置；宠物、状态栏、气泡、向导和设置内容均属于保护区域。
- `npm run check` 通过 19/19 Vitest 文件、93/93 前端测试、56/56 Rust 测试及生产构建。当前源码完整重建的 20,403,200-byte Debug EXE（SHA-256 `1B467A6F03CF59013ACBC18FCCD63CCAE0149A9C3AF3D0934C0CF2DA8FB71D76`）在 `.cache/native-windows-smoke/1785211873195-29520` 实际记录七个等宽整行状态项、coding 行内 5 张候选卡，以及未 hover、未聚焦的 `exhausted.gif` 候选生成 130 × 120 PNG 首帧；选择后实时播放 `exhausted.gif`，恢复默认后实时播放 `coding.gif`。该 run 在后段 60 秒 idle 计时器调度探针超时，另两次复跑因检测到外部鼠标移动而由全局输入安全锁中止，因此本轮定向原生证据有效，但不替代此前 `success=true` 的完整 Windows 基线。

## 2026-07-27 v0.1.1 动作预览与设置精简

- 设置页不再显示或持久化“完成气泡时间”；旧 Store 中的 `successBubbleDurationMs` 会在规范化保存时移除，成功消息统一使用 15 秒自动关闭行为。
- “动作选择与预览”只渲染当前聚焦或刚切换的状态动作，并复用生产 `PetRenderer`、角色包解析和系统 reduced-motion 降级路径；不会为预览同时加载全部 GIF。
- npm、Rust crate 与 Tauri 配置版本统一为 `0.1.1`。
- `npm run check` 通过 17/17 Vitest 文件、84/84 前端测试、56/56 Rust 测试及生产构建。当前 Windows WebView2 run 已实际验证固定 15 秒关闭后仍可悬停回看完成内容、动作预览切换到 `exhausted.gif` 并恢复 `coding.gif`、旧时长控件缺失与 9 字段 Store；完整套件随后两次因外部鼠标移动触发全局输入安全门而中止，未把本轮标记为新的全量原生成功基线。
- v0.1.1 NSIS 已生成：5,781,877 bytes，SHA-256 `0BCEB9BF192A4A95E53A665E3DA0C0C3823BA0166CFC97E7FD9F3925CA39BFB0`，Authenticode `NotSigned`。

## 2026-07-27 Windows-only、开机自启与会话区分

- Rust 运行时、默认 IPC、打包配置、CI 和开发脚本只保留 Windows 路径；默认端点固定为 Named Pipe `\\.\pipe\furry-companion-mcp`，NSIS 是唯一安装包目标。
- 设置页新增由 Rust Store 持久化的“开机时启动”开关。Rust 在保存前同步 Windows 登录启动注册，失败时不会把未生效的值写成成功；隔离原生冒烟真实启用/禁用专属 Run 值并确认无残留。
- 侧栏布局使用当前显示器物理工作区、DPI、桌宠锚点和左右溢出量选择展开方向。原生 run `.cache/native-windows-smoke/1785137435175-5396` 把桌宠拖到右缘 48 px，确认设置从左侧完整展开；拖动设置窗口后关闭，桌宠保持新的锚点。
- JSON Lines 事件可携带可选 `session_title`，Rust 与 TypeScript 都限制长度并按纯文本渲染。success 原生证据显示“IPC 演示会话”；当前 `furry-companion-mcp 0.2.0` 的 `set_state` 工具尚未暴露该参数，因此已接入的旧 Agent 仍兼容但不能主动填写标题。
- `npm run check` 通过 17/17 Vitest 文件、84/84 前端测试、57/57 Rust 测试；上述原生 run 为 `success=true`、`cleanupSafe=true`，使用 20,404,224-byte Debug EXE（SHA-256 `CBE158124FABDFDAB948E2BFBAC71CF670FE0F069E11FAD4D5157D7B440D720E`）。

## 2026-07-22 减少动态效果

- `PetRenderer` 记住最新解析动作。系统偏好切到 reduce 时，GIF 优先解析包内静态映射，没有映射才改用 `fallback-idle.svg`，并保留动作语义 alt；偏好恢复时重新解析最新状态/交互，而不是恢复旧 URL 快照。
- 角色包可用 `reducedMotionAnimations` 把 GIF 动作映射到同一动画字典中的非循环 PNG/WebP。目标复用既有 Rust 路径、格式、解码预算、内容寻址快照和前端逐文件 asset URL 校验；没有映射时才使用内置静态角色。
- 静态 PNG/WebP 继续显示；系统媒体查询和手动 `data-reduced-motion` 标记都会关闭 CSS 悬停、拖拽和庆祝动效。设置页开关由 Rust Store 持久化，系统请求无法被手动关闭。初始四 GIF 包还没有获得授权的专用 poster。
- `.cache/native-windows-smoke/1784697111517-1268/reduced-motion-integration.json` 在真实 WebView2 中分别记录系统与手动路径的 `idle.gif / hovering-bob → fallback-idle.svg / none → idle.gif / hovering-bob`，并记录 `reduceMotion=true` 退出后由 Rust Store 在重启时恢复，静态角色仍然生效。同一完整重建 run 的 Debug EXE 为 20,264,448 bytes、SHA-256 `BE0C7AD5499978751AC0BEA81CDA641DEA3F01C88FFCC731EF4E2B78F8AB5382`，`success=true`、`cleanupSafe=true`；包内映射另有前端、Rust 校验和受管快照自动化覆盖。

## 2026-07-22 交互动作扩展

- `pet.json.interactions` 最多 32 项，使用安全动作 ID，并且只能引用 `animations` 中已声明的资源；Rust 本地导入验证与 TypeScript 内置/导入 loader 使用同一规则。
- 当前运行时触发 `hovering`、`dragging` 与 `clicked`。若角色包声明映射，只渲染专用动画；若未声明才保持当前状态 GIF 并施加对应 CSS 后备，避免角色自带动作与通用动效叠加。动作语义 `data-action` 和 `data-action-fallback` 分离，未来新增 `petting` 等交互时不需要修改七状态 IPC 合约。
- 交互以 token 入栈，最后开始的动作优先。`clicked` 使用注入调度器的通用一次性控制器；角色包可以声明 `durationMs`（100–60,000 ms），未声明时使用 650 ms。重复点击刷新当前计时但不重新开始动作，精确边界后恢复此前仍有效的动作。鼠标按下超过 300 ms 的浏览器合成点击不触发 `clicked`，键盘/辅助技术产生的 `detail=0` 点击仍可用。
- 最新完整 Windows run `.cache/native-windows-smoke/1784697111517-1268` 记录 `hovering/hovering-bob → dragging/dragging-float → hovering/hovering-bob → 无交互`，确认真实拖拽历史中没有 `clicked`；独立点击随后进入默认 650 ms 的 `clicked/clicked-pop` 并恢复为无交互。窗口 requested/observed 均为 `(96,64)`；140 样本 p50 `1.35 ms` / p95 `5.70 ms` / max `6.68 ms`，1001 事件到 2 次 DOM marker 更新，`sleeping.gif` 在 `60,020.66 ms` 完整呈现。六项托盘、透明合成、Z-order、隐藏/重启/单实例和清理全部通过。自定义时长的边界、camelCase 序列化及源目录删除后的受管快照重载由前端和 Rust 自动化覆盖。
- 该成功 run 从当前源码完整重建后直接验证，没有使用 `--skip-build`。2026-07-16 的安装后 Release 证据仅代表旧基线，不包含本次动作层与静态降级。

## 此前已在 Windows 验证的基线

- 透明、无边框、置顶桌宠窗口，拖动、缩放、透明度和基础位置持久化。
- 系统托盘显示/隐藏、恢复位置、置顶、打开设置、重新连接和退出。
- Windows Named Pipe JSON Lines 消费端，以及断线后的 1–30 秒指数退避重连；短命连接立即 EOF 不再错误重置退避，高频合并期间连接诊断最多每秒刷新一次最近事件时间。Rust 到主线程的 publication queue 最多保留 64 项、合并队尾并按连接 generation 清除旧 backlog，旧 reader 不会在重连后覆盖新连接状态。
- npm 发布版 `furry-companion-mcp 0.2.0` 的 stdio MCP 初始化、`tools/list`、两次 `set_state` 调用和隔离 Named Pipe 事件烟测；当前源码本轮复跑耗时约 `5.6 s`。
- 七种逻辑状态、四个初始 GIF 的可扩展映射、长时间 idle 后 sleeping 变体；当前 Debug 与安装后 Release 已分别在 `60,018.8381 ms` 和 `60,028.4089 ms` 观察到完整的 576 x 530 `sleeping.gif`，无图片错误。
- success 庆祝效果、完整结束语、缺省文案、暂停计时和手动关闭。
- 有界协议解析、未知字段兼容、非法输入恢复、Rust-owned Tauri Store 设置持久化和单实例。
- 连接状态和最近连接错误的可见诊断信息；按产品要求不再展示最近事件时间或自定义 IPC 地址。
- 首次启动接入向导，以及当前用户级 NSIS 的安装、启动和卸载生命周期。

安装产物、生命周期与历史哈希见 [`WINDOWS_INSTALLER.md`](WINDOWS_INSTALLER.md)；当前 Debug 交互、2026-07-16 安装器基线和发布边界见 [`SMOKE_TEST_REPORT.md`](SMOKE_TEST_REPORT.md)。验证结论只适用于报告记录的精确产物和环境。

## 当前已在隔离 Windows Debug runtime 验证

### 状态气泡、事件归一化与退出

- 原生 WebView2 CDP 已逐一观察 `idle`、`thinking`、`planning`、`coding`、`testing`、`error`、`success`。协议 mock 同时发送半包、粘包、空行、CRLF、坏 JSON 和未知状态，后续合法事件仍能正常展示。
- 普通气泡支持 `message`、可选 `file` 和 file-only 详情；悬停桌宠或键盘聚焦可回看当前详情。悬停、焦点或选择文本期间暂停倒计时，隐藏时会清理交互状态，避免下一条消息永久暂停。
- `error` 气泡使用 alert 语义且不会自动关闭；新合法状态可覆盖错误，用户确认则只把本地展示切回 `idle`，不会向 MCP Runtime 回写状态。本轮原生冒烟已验证错误确认，文本选择暂停和 file-only 由 Vitest 覆盖。
- Rust 对同一非终态事件使用 50 ms leading/trailing 窗口，只保留窗口内最后一个完整事件。状态变化与 `success`/`error` 立即发送，断线或较新的协议错误前按线序刷新 pending；前端重复同状态时更新详情，但不重置动画、idle 延迟变体或 success 返回 idle 的计时。高频输入期间诊断状态以 1 Hz 上限更新，恢复中的协议诊断立即刷新。发往主线程的事件通过最多 64 项的单-flight publication queue 串行交付，队尾可合并；generation 切换会清除旧 backlog，主线程认领时也会丢弃已退役 generation，且锁内不调用 Tauri/UI。
- 设置页与托盘退出共用 Rust `AppHandle::exit(0)` 路径，不增加 process/shell capability。原生冒烟确认可见和隐藏退出均为退出码 0，并完成 `main.visible=false` 隐藏保存、重启保持隐藏、第二实例唤醒和最终 `main.visible=true` 保存闭环；测试进程和隔离数据无残留。
- 设置持久化由 Rust command 统一规范化并写入 Tauri Store；前端只提交/接收同一个 DTO，不建立第二种磁盘格式。当前原生冒烟从真实 WebView 修改设置并验证磁盘 schema 与重启恢复；首次向导还完成了“稍后”、设置页重开、重新检测、完成写入 Store v1 和重启保持完成状态，Debug 与安装后 Release 均通过。
- `npm run smoke:windows:native` 可重复执行隔离 Debug 构建与 CDP/Win32 冒烟；已有最新 Debug EXE 时可使用 `--skip-build`，但最新当前源码证据使用完整重建模式。证据生命周期 `188.820 s`（`2026-07-16T11:32:14.653Z` 到 `2026-07-16T11:35:23.473Z`），目录 `.cache/native-windows-smoke/1784201511453-9204`；Debug EXE 为 20,196,864 bytes，SHA-256 `33D052E6D24DB481F364AAC23BF6582784F3911377F5676ED725A42BC17836F4`。140 样本延迟为 p50 `1.53 ms`、p95 `6.08 ms`、max `8.25 ms`，1001 条 burst 对应 2 次 DOM marker 更新；`sleeping.gif` 在 `60,018.8381 ms` 完整呈现为 576 x 530，图片错误为 0。机器可读的 `desktop-integration.json` 还记录两种背景色均从透明采样点逐 RGB 精确透出、opaque 探针保持 `(246,196,46)`、置顶启用/禁用时 Z-order 比较分别为 `-1` / `1`、client bounds 与 window bounds 完全一致，以及请求与观测拖动均为 `(96,64)`。run 标记 `success=true`、`cleanupSafe=true`。
- 同一目录的 `tray-integration.json` 记录六项真实托盘菜单交互：connected/disconnected 状态、左键隐藏/恢复、菜单隐藏/显示、恢复位置到屏幕中心、隐藏时打开设置并获焦、置顶 native/UI/menu 同步、断线后 client 连接从 1 增至 2，以及隐藏窗口通过托盘退出且退出码 0。connecting/disabled 仅有 Rust 单测文案映射；tooltip 断言是绑定托盘图标的 UIA accessible name 包含状态，不是像素级可视检查；普通任务栏图标缺失没有被明确验证。

### 本地角色包

- 设置页可以选择一个文件名为 `pet.json` 的本地 manifest；当前没有“直接选择目录”入口，也不会长期授权或直接渲染源目录。
- Rust 在阻塞工作线程中验证 manifest 和所有被引用媒体，然后把 `pet.json` 与引用资源复制到应用数据目录的 `pet-packages/` 受管目录。
- 快照 ID 为 `local-` 加内容 SHA-256 的前 24 位十六进制；相同内容复用同一个有效快照。每次导入使用包含 PID、时间戳和进程内计数器的唯一 `.staging-*` 目录，完成后再重命名；本次导入失败会立即清理自己的 staging。
- 本地包的列出、导入和删除由同一个进程内互斥锁串行化。列表扫描不会删除任何 staging；只有开始新导入时才尝试清理修改时间已满 24 小时、且整棵目录树不含链接/重解析点或非常规文件的 stale staging，近期或可能仍活跃的目录保持不动。
- 前端只持久化本地 catalog ID。原始绝对路径不会写入设置；导入成功后源目录可以移动或删除。
- 设置页可以删除本地包。删除前切回内置默认包；Rust 只接受导入器生成的 ID，并在递归删除前检查受管目录 containment，再遍历整个待删树，拒绝任意层级的符号链接、Windows 重解析点或非常规文件。
- 启动时逐目录重新校验内容哈希和包内容；损坏、被篡改或格式无效的本地快照会被跳过。已保存的包不存在时，选择和状态动作覆盖会修复为内置默认值。
- WebView 只可读取 `$APPDATA/pet-packages/**/*`；CSP 仅允许图片使用 `asset:` / `http://asset.localhost`，前端没有通用文件系统或 shell capability。
- Rust DTO 为 manifest 中每个唯一媒体 source 返回已安装快照内的明确绝对 `assetPaths`；前端要求该映射与 manifest 精确一致，再逐文件调用 `convertFileSrc`。本地包不再通过 manifest asset URL 对 Windows encoded backslash 做相对 URL 解析。
- 内置资源回归读取真实 `public/pets/index.json`。TypeScript 生产 loader 测试加载全部 catalog 条目并解析七状态；另一测试递归枚举每个包的 GIF/PNG/WebP，要求实际媒体集合与 manifest 唯一引用集合完全一致，能捕获缺失资源和孤儿媒体。Rust 测试也遍历真实 catalog，并让每个条目通过 `validate_package_source()` 的全部已声明媒体校验。
- `furry-ai-state` 的四个初始 GIF 哈希作为必须保留的兼容性子集，不把动画字典限制为四项；七状态映射和 `idle → sleeping @ 60000 ms` 同时被锁定。因此新增动作可以扩展 manifest，而误改初始资源或映射会使测试失败。
- 延迟变体 scheduler 接受可注入定时器，自动化覆盖 60 秒边界、状态切换取消、override 禁用、过期 state revision 与旧 schedule generation。修改非当前状态的 override 只持久化设置，不重渲染或重新调度当前 `idle`。

详细格式与所有上限见 [`PET_PACKAGES.md`](PET_PACKAGES.md)。当前 Rust 导入边界包括 64 KiB manifest、最多 64 个动画、10 MiB 单媒体、manifest 与全部唯一引用媒体合计 64 MiB、画布和实际媒体 2048 px 单边、300 帧 GIF、整包累计 120,000,000 解码像素、每轮 60 秒、动态帧最小 2 cs 延迟，以及最多 32 个本地快照。GIF 元数据检查有 16 MiB 内存边界；静态 PNG/WebP 会在 32 MiB 内存边界内真实解码。APNG、动画 WebP、未精确闭合的 WebP RIFF、重复图像数据或容器/位流/解码器尺寸不一致的 WebP 都会被拒绝。

### Windows 角色包运行时证据

- 原生文件对话框成功选择并导入真实 `pet.json`，生成 `local-c6ee…` 内容寻址 ID。
- Rust-owned Tauri Store 中只保存该 `local-…` catalog ID，没有保存源 manifest 或源目录路径。
- 快照内的 manifest 与四个 GIF 分别计算哈希，均逐一等于对应源文件。
- 导入后把源目录改名使原路径失效，再重启应用，本地包仍保持选中并从快照显示；对同一 GIF 间隔 750 ms 的两帧采样有 45.08% 像素不同，确认不是静态占位图而是实际播放。
- 首轮验证暴露了 Windows encoded backslash 在 asset URL 中无法可靠作为相对基址解析的问题。改为 Rust DTO 返回逐资源绝对 `assetPaths`、前端逐文件 `convertFileSrc` 后，重启加载与 GIF 播放回归通过；TypeScript 回归测试同时覆盖 Windows 路径转换和 manifest/assetPaths 映射不匹配拒绝。
- 在 UI 删除当前本地包后，对应快照目录消失，设置回退为内置 `furry-ai-state`。

### 跨显示器窗口恢复与可见性

- Window State 持久化 `POSITION | VISIBLE`，缩放仍由应用设置推导窗口逻辑尺寸，避免两套尺寸恢复相互竞争。启动时跳过插件默认恢复，只恢复位置，再按已保存的 `main.visible` 明确显示或隐藏。
- 没有 Window State 的首次启动默认显示；托盘不可用时无论已保存值为何都强制显示，避免透明、无任务栏入口的窗口变成不可达后台进程。
- 启动、第二实例唤醒以及窗口移动、缩放、DPI 变化或重新获得焦点时，Rust 会检查当前位置。
- 只要窗口仍与任意显示器有交集就保留用户位置；完全离屏时选择距离最近的显示器，距离相同时优先主显示器，并把窗口放回该显示器工作区。
- 安全边距为 16 个逻辑像素，按目标显示器 scale factor 转换；支持负坐标显示器。窗口大于工作区时居中，以最大化可见面积。

Windows 隔离 Debug runtime 中把窗口左上角设为 `(1000000, 1000000)` 后，应用把窗口恢复到边界 `(left, top, right, bottom) = (1996, 916, 2536, 1576)`；当前屏幕为 `2560 × 1600`，恢复后的完整窗口位于屏幕范围内，右侧和底部各留 24 px。可见性回归还验证了无状态和 `visible=true` 时显示、`WM_CLOSE` 后隐藏但不退出、隐藏退出写入 `main.visible=false`、重启保持隐藏，以及第二实例退出码 0 并把原实例重新显示；最终退出写入 `main.visible=true`。这些结果不外推为物理拔插显示器、负坐标多屏或混合 DPI 已完成实机验收。

上述本地角色包导入/删除与完全离屏恢复证据来自隔离 Debug 构建。2026-07-16 当前源码的隔离身份安装后 Release 已重复七状态、四 GIF、向导/设置、透明合成、topmost、client geometry、真实拖动、真实托盘和 60 秒 sleeping，但仍未重复本地角色包原生 dialog/import/delete/恶意包 UI，也未验证升级/降级。证据边界见 [`SMOKE_TEST_REPORT.md`](SMOKE_TEST_REPORT.md)。

### 2026-07-16 Windows Release / NSIS 基线

当时的 harness 从同一份源码分别构建正式身份与隔离身份 NSIS，并把安装器、Release EXE 快照及安装后全量 native smoke 绑定到机器可读报告 `.cache/windows-installer-smoke/1784201848768-33384/installer-smoke-report.json`。报告生命周期 `518.730 s`；记录 `currentSourceBuild=true`、`success=true`，且 installer 与 desktop-interaction 原子锁均在验证无残留后释放。该基线早于当前交互层和 reduced-motion 静态降级。

- 正式名 NSIS 为 5,664,565 bytes，SHA-256 `EA181EFE9A93B153570AA92D893F351049492E821BED7C5064559163E79DF5DF`；隔离 NSIS 为 5,665,555 bytes，SHA-256 `E629E932BEB152191A46C98EC73A8F102D49FD5FD98488C1F8B343119F39E7AF`。两者低于 20 MB 目标，但 Authenticode 均为 `NotSigned`。
- 对精确正式产物执行 current-user `/S /NS /D=...` 安装与卸载，退出码均为 0；静默安装未自启，安装目录与卸载项由 NSIS 删除，正式 AppData 未进入测试清理范围。
- 隔离身份使用独立 `agent-desktop-pet-smoke.exe`。同次构建源 EXE 为 14,349,824 bytes、SHA-256 `1ADBAF9A79F20AA393C6C8955E052A8ED48396E03C79EFA5160428A04A4DE514`；安装后精确 EXE 同为 14,349,824 bytes、SHA-256 `E6DF0C4422886688C22202B334944F57912FA749199BBBB687C3E589181BAD34`，两者只有 Tauri 的 `__TAURI_BUNDLE_TYPE_VAR_UNK` → `..._NSS` marker 补丁。
- 安装后 Release 的全量原生证据位于 `.cache/native-windows-smoke/1784202165728-19428`：七状态与四 GIF 映射、error/success 气泡、首次向导/Store v1 设置、隐藏/重启/单实例、桌面集成和六项真实托盘均通过；140 样本 p50 `1.22 ms`、p95 `5.11 ms`、max `6.07 ms`，1001 条 burst 对应 2 次 DOM marker 更新，`sleeping.gif` 在 `60,028.4089 ms` 出现，托盘隐藏退出码为 0。
- manufacturer key、隔离 AppData/Profile 由 harness 在精确路径校验后清理；正式与隔离安装/卸载退出码均为 0，最终独立复核无安装目录、相关注册表、进程、隔离数据或锁残留。
- 此前 `2D4A…` / `5E93…`、`FCD4…` / `FB79…`、`BE55…` / `267D…` 和 `0291…` / `5829…` 哈希只保留为较早源码的历史记录，不再代表当前源码安装器。
- 尚未验证签名、升级/降级、自动更新、快捷方式生命周期、正式身份安装后的全量交互、本地角色包原生 dialog/import/delete/恶意包 UI，以及 Windows 10/ARM64。

## 已实现但尚未完成 Windows 实机矩阵验证

- Tauri 的透明窗口、Windows 托盘、文件选择器、受限 asset protocol 和窗口恢复代码路径。
- GitHub Actions 的 Windows 检查与无安装包编译任务。
- Windows Named Pipe、开机自启注册和设置同步代码路径。

当前仓库尚未推送并观察本轮远程 CI 运行结果。Windows 10/11、x64/ARM64 和物理多显示器矩阵仍需分别验证。

## 仓库中已有的相关自动化覆盖

- Rust：内容寻址快照与源目录独立性、路径穿越、媒体伪装、GIF 帧数/帧率、整包累计像素预算、PNG/WebP 真实解码、WebP 容器夹带/重复数据、唯一 staging、列表不清理近期 staging、画布边界和本地 ID 格式边界。
- Rust：多显示器交集、最近显示器、主显示器平局、负坐标、DPI 安全边距和超大窗口恢复算法。
- Rust：Window State `visible` 解析，以及收到合法事件/稳定连接后重置退避、短命连接保持指数退避。
- Rust：50 ms 状态归一化的 1000 条 burst、最终完整事件、状态切换、终态旁路、字段清空、pending/诊断线序和 1 Hz 诊断刷新上限；bounded publication queue 还覆盖 generation 清空、旧 generation 拒绝、队尾合并、单-flight 交付与最多 64 项边界，以及关闭请求的平台安全策略。
- TypeScript：每个 Windows 快照绝对路径逐文件转换为受限 asset URL、`assetPaths` 与 manifest 精确匹配、非法本地 ID、manifest/state/variant 边界、坏内置包隔离和失效动作回退。
- TypeScript：原生字符串、`Error`、对象消息和异常 getter 的安全错误归一化，包含空白折叠与 512 字符上限。
- TypeScript：error 持续与确认、file-only、关闭文件路径时保留普通消息/关闭纯文件气泡、悬停/焦点/选择文本暂停、交互中替换消息、隐藏后清理交互状态和 success 手动关闭回归。

2026-07-16 当前源码实际执行完整 `npm run check`：9/9 Vitest 文件、51/51 前端测试和 53/53 Rust 测试，并通过 TypeScript 类型检查、`cargo check`、`cargo fmt --check` 与 Vite production build；随后单独执行严格 `cargo clippy --all-targets --all-features -- -D warnings`，并由 `npm audit --audit-level=moderate` 确认 0 个漏洞。还完整重建并通过 `smoke:windows:native` 与 `smoke:windows:installer`，且 npm 发布版 `furry-companion-mcp 0.2.0` 的初始化、`set_state` 与 runtime→Named Pipe 烟测通过。

这些测试存在于代码库中；应以当前分支实际执行结果为准，不能仅凭测试文件存在宣称通过。

## 尚未完成

- Windows 原生文件对话框对路径穿越、超限或损坏包的拒绝场景仍缺少逐项 UI 手工冒烟；相应 Rust/TypeScript 边界已有自动化测试。
- Windows 真实多显示器拔插、负坐标布局和 100%/150%/200% DPI 切换；隐藏退出/重启和第二实例唤醒已有当前机器证据。
- 2026-07-16 源码基线的 Windows 安装器正式安装/卸载与隔离安装后全量原生桌面集成已经复跑；当前交互动作与 reduced-motion 更新尚未重建安装后 Release。签名、升级/降级、自动更新、快捷方式生命周期、Windows 10/ARM64，以及正式身份安装后的全量交互仍未完成。
- 安装后的桌宠 UI、发布版 `furry-companion-mcp` 与真实 Agent 客户端三者的完整端到端验收。
- 选择气泡文本暂停和 file-only 详情已有前端自动化覆盖，但尚未在原生 WebView 中逐项交互验收。
- Windows Debug 当前源码完整重建复跑测得 140 样本状态文本/DOM 标记 p50 `1.35 ms`、p95 `5.70 ms`、max `6.68 ms`；2026-07-16 安装后 Release 为 p50 `1.22 ms`、p95 `5.11 ms`、max `6.07 ms`。两者的原生 1001 条 burst 都对应 2 次 DOM marker 更新；尚未覆盖 GIF 首帧像素时间，也未形成覆盖目标 Windows 版本与架构的 CPU、内存、启动耗时、状态延迟与 Runtime 重启性能脚本。
- 当前自动化已在 Debug 与安装后 Release 都验证透明合成像素、实际 Z-order、无边框 client geometry、真实鼠标拖动和真实托盘六项菜单；普通任务栏图标缺失仍未明确验证，connecting/disabled 状态仍只有单测映射，tooltip 只验证绑定托盘图标的 UIA accessible name，不是像素级检查。
- 系统 `prefers-reduced-motion` 与用户手动开关的 GIF→内置静态角色→GIF 恢复、手动设置落盘和跨重启恢复已有原生证据；包内按动画静态映射已有前端/Rust/受管快照自动化，仍缺初始角色的实际授权 poster、切换前后 CPU/内存量化和 GIF 首帧像素时间。
- 角色包导出、导入版本管理和可见的坏快照诊断；当前坏快照会安全跳过，但不会在 UI 中逐包解释原因。
- Windows 代码签名、正式发布元数据和美术再分发授权；内置资源许可仍为 placeholder。
- PRD 80 MB 完整应用稳态内存与 idle 单核 1% CPU 目标；当前 Windows WebView2 进程树与 animated GIF 路径均高于目标。
- 当前 Debug 完整重建的链接阶段出现 MSVC runtime PDB 缺失的 `LNK4099` 警告；EXE 已成功构建并通过全量运行冒烟，暂列非阻断构建警告。

## 建议验证命令与手工场景

```bash
npm run check
npm audit --audit-level=moderate
npm run tauri -- build --debug --no-bundle --config scripts/tauri.smoke.windows.conf.json
npm run smoke:windows:native -- --skip-build
npm run smoke:windows:installer
npm run tauri:dev
npm run tauri:build:windows -- --no-sign --ci
npm run smoke:mcp:published -- --runtime <furry-companion-mcp-dist-index.js>
```

隔离 Windows Debug runtime 已走完有效本地包导入、源目录失效后重启、GIF 播放、UI 删除、完全离屏位置恢复，以及当前源码的状态 UI、交互动作、reduced-motion 静态降级、异常协议、向导/Store v1、自动重连、窗口、单实例、透明合成、实际 Z-order、无边框 client geometry、真实鼠标拖动、真实 60 秒 sleeping 和托盘六项菜单冒烟。2026-07-16 安装器基线已完成当时源码的正式安装/卸载及隔离 Release 全量套件，但需要针对当前交互层和静态降级重新构建。后续仍需补坏包 UI 拒绝、正式身份安装后全量交互、普通任务栏图标缺失、快捷方式、物理显示器拔插/负坐标/混合 DPI、升级/降级、Windows 10/ARM64 与真实外部 Agent UI。
