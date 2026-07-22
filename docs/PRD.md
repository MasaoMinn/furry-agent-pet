# furry-agent-pet 项目需求文档

> 文档状态：Draft v0.5
> 更新日期：2026-07-22
> 正式名称：furry-agent-pet

## 1. 项目概述

furry-agent-pet 是一款常驻桌面的轻量桌宠应用。它通过 MCP 工具接收 AI Agent 的实时工作状态，并以角色动作、表情、状态文字和气泡消息展示 `thinking`、`planning`、`coding`、`testing`、`success`、`error` 等阶段，让使用 AI Agent 进行开发的过程更直观、更有趣。

应用应运行于 Windows、macOS 和 Linux，优先保证低资源占用、低打扰、本地通信和简单安装。首版复用现有 `furry-ai-state` / `furry-companion-mcp` 的状态协议与本地 IPC 链路，不在桌宠进程内重新实现 MCP stdio transport。

## 2. 已确认需求

1. 桌宠以透明、无边框的小窗口悬浮在电脑桌面上，体验参考 Bongo Cat。
2. 桌宠能表现支持 MCP 的 Agent 模型当前所处的工作状态。
3. 首批状态至少包含思考、编码、测试、成功，并兼容现有 `furry-ai-state` 的完整状态集合。
4. Agent 任务完成后返回一段自然语言结束语，桌宠以文字气泡展示。
5. 支持 Windows、macOS、Linux。
6. 尽可能轻量，避免为简单动画引入重量级运行时。

## 3. 产品目标与非目标

### 3.1 核心目标

- 用户无需打开 IDE 侧边栏，也能快速感知 Agent 是否正在思考、写代码、验证或已完成。
- 状态变化通过本地连接近实时反映到桌宠动作上。
- Agent 完成任务时，桌宠用庆祝动作和一句具体结束语形成清晰反馈。
- 安装和 MCP 接入足够简单，并能明确展示连接是否正常。
- 空闲时资源消耗足够低，不影响日常开发。
- 角色资源和状态动作可替换，为后续角色包预留空间。
- Agent 状态与用户交互动作相互独立；拖拽、悬停等短暂动作不得污染七状态 MCP 协议，并能按角色包扩展。

### 3.2 首版非目标

- 不显示或编辑 Agent 的完整对话内容。
- 不代替 IDE、终端或 Agent 客户端。
- 不解析不同 Agent 厂商的私有日志或内部推理过程。
- 不将状态、文件名或消息上传到云端。
- 不在首版提供复杂养成、物理碰撞、桌面行走、联网社区或角色商店。
- 不承诺所有 Linux 桌面环境和 Wayland compositor 的窗口层级行为完全一致。

## 4. 目标用户与核心场景

### 4.1 目标用户

- 使用 Codex、Claude Code、Cursor 或其他支持 MCP 工具的开发者。
- 同时处理长耗时 Agent 任务，希望减少频繁切换窗口查看进度的用户。
- 喜欢桌宠、角色化反馈和趣味开发体验的用户。

### 4.2 核心用户故事

1. Agent 开始思考时桌宠立即进入思考动作，让用户确认任务已被接收。
2. Agent 编码和测试时显示不同动作，让用户快速判断进度阶段。
3. 任务成功时桌宠庆祝，并用文字气泡告诉用户具体完成了什么。
4. 任务失败或阻塞时给出明显但不过度打扰的反馈。
5. 用户可以拖动、缩放、隐藏桌宠，重启后恢复位置。
6. 用户可以从托盘查看连接状态，断线后应用自动重连。
7. 用户可以为每个 Agent 状态替换自己的图片或动画资源。

## 5. 状态模型与表现规范

| 状态 | 中文含义 | 默认桌宠表现 | 默认持续策略 |
| --- | --- | --- | --- |
| `idle` | 空闲 | 呼吸、眨眼、趴着休息 | 持续，直到收到新状态 |
| `thinking` | 思考 | 观察、挠头、思考泡泡 | 持续，直到收到新状态 |
| `planning` | 规划 | 查看地图、清单或便签 | 持续，直到收到新状态 |
| `coding` | 编码 | 敲键盘、操作终端 | 持续，直到收到新状态 |
| `testing` | 测试/验证 | 检查仪器、放大镜、运行测试 | 持续，直到收到新状态 |
| `success` | 成功 | 庆祝、闪光、开心表情 | 动作默认 8 秒后回到 `idle` |
| `error` | 错误/阻塞 | 沮丧、警示符号、轻微抖动 | 保持到收到新状态或用户确认 |

状态事件还可包含：

- `message`：当前动作的短说明；当 `state` 为 `success` 时，它承载 Agent 返回给用户的任务结束语。
- `file`：Agent 当前处理的文件路径。

普通详情气泡默认仅在状态变化后或悬停桌宠时短暂显示，用户可关闭气泡或隐藏文件路径。当 `message` 为空、允许显示文件路径且 `file` 有值时，仍展示 file-only 详情气泡。

### 5.1 任务结束语气泡

- Agent 成功完成任务时必须调用 `set_state({ state: "success", message: "..." })`，用一段自然语言概括完成结果或对用户说一句结束语。
- 收到带 `message` 的 `success` 事件后，桌宠进入庆祝动作，并以文字气泡展示完整结束语。
- 结束语建议控制在 20–200 个字符，协议继续兼容现有 1000 字符上限。
- 超出气泡可视区域时允许滚动或展开，不得静默截断原文。
- 成功气泡默认展示 15 秒并支持单击关闭；庆祝动作可在 8 秒后独立回到 `idle`。
- 用户与气泡交互、悬停或选择文本时暂停自动关闭倒计时。
- 成功事件没有 `message` 时显示本地默认文案“任务已完成”，并在诊断信息中标记缺少结束语。
- 结束语只在本机内存中展示，默认不写入持久化历史或日志。

### 5.2 状态转换规则

- 新的合法事件立即覆盖当前展示状态。
- 重复状态事件更新 `message` 和 `file`，但不重播入场动画，也不重置 success 返回 idle 或 idle 延迟变体的计时。
- `success` 动作到时后回到 `idle`；期间收到其他事件时以新事件为准。
- `error` 不阻止后续合法状态覆盖。
- IPC 断开不等同于 Agent 错误；桌宠保留最近状态，并显示独立的未连接标识。
- 对高频重复事件进行合并或节流，避免动画闪烁。

## 6. 功能需求

### 6.1 P0：MVP 必须具备

#### F-01 桌宠窗口

- 透明背景、无系统标题栏、无边框。
- 默认置于普通应用窗口之上，并提供“总在最前”开关。
- 不在任务栏或 Dock 中显示普通应用图标，主要入口位于系统托盘/菜单栏。
- 支持鼠标拖动、多显示器和不同 DPI。
- 保存并恢复窗口位置、缩放比例和显示/隐藏状态。
- 屏幕断开后，桌宠不能永久停留在不可见区域。
- 恢复位置时只纠正完全不与任何当前显示器相交的窗口；仍部分可见的位置保持不变。恢复目标优先选择最近显示器，并按目标工作区与 DPI 留出安全边距。
- 默认不抢夺键盘焦点。

#### F-02 状态接收

- 兼容 `furry-companion-mcp` 0.2.x JSON Lines IPC 协议。
- Windows 默认连接 `\\.\pipe\furry-companion-mcp`。
- macOS/Linux 默认连接系统临时目录下的 `furry-companion-mcp.sock`；Linux 通常为 `/tmp/furry-companion-mcp.sock`，macOS 不写死 `/tmp`。
- 桌宠始终使用平台默认 IPC 地址并自动连接；不在设置页提供禁用连接或自定义地址入口。
- 断线后指数退避重连，初始 1 秒、上限 30 秒。
- 连接状态包括 `connecting`、`connected`、`disconnected`、`disabled`。
- 非法 JSON、未知状态、半包、粘包和超长字段不得导致应用退出。

#### F-03 状态与气泡渲染

- 七种逻辑状态都能独立映射动画或静态资源；在专用动作尚未提供时允许多个状态复用同一资源。
- IPC 事件到达后 200 ms 内开始更新画面。
- 支持 `message` 和 `file` 的可选气泡展示。
- `success.message` 作为任务结束语突出展示，并具备自动关闭、暂停计时和手动关闭行为。
- 连接断开时显示不遮挡角色的弱提示。
- 无 MCP Runtime 时仍能启动并展示 `idle`。
- 角色包可用可选 `interactions` 将 `hovering`、`dragging`、`clicked` 等交互 ID 映射到包内动画，并可为一次性动作声明 100–60,000 ms 的 `durationMs`；映射存在时只播放包内动作，未映射时才使用轻量内置反馈。
- 临时交互动作可嵌套，后开始者优先；结束后恢复最新 Agent 状态，不得被过期交互结束事件覆盖。
- 交互期间暂停延迟状态变体，结束后从最新状态重新调度；`prefers-reduced-motion` 下关闭悬停、拖拽等位移/旋转动效。
- 操作系统请求减少动态效果时，GIF 优先切换到角色包为该动作声明的静态 PNG/WebP，未声明时回退内置静态角色；系统偏好关闭后显示当时最新的状态或交互动作。

#### F-04 托盘与基础控制

- 托盘/菜单栏包含显示/隐藏、恢复默认位置、总在最前、设置、重新连接和退出。
- 左键单击显示或隐藏桌宠，右键打开菜单；平台习惯不同时遵循平台规范。
- 设置页提供显式退出作为托盘入口的补充；所有退出操作都必须完全关闭后台进程。

#### F-05 设置

- 桌宠缩放建议范围 50%–200%。
- 透明度建议范围 30%–100%。
- 总在最前、状态气泡和文件路径显示开关。
- 手动重新连接；MCP 默认始终启用且地址不可在设置页修改。
- 选择内置角色包或已导入的本地角色包，并为每个状态选择包内动作。
- 从设置页选择 `pet.json` 安全导入本地角色包；导入完成后不依赖源目录，并允许删除应用自己的快照。
- 成功气泡展示时长设置。
- 恢复默认设置。
- 设置面板标题栏可直接拖动原生窗口；关闭按钮和表单控件不得触发窗口拖拽。
- 设置面板在桌宠旁侧展开，不得覆盖桌宠，以便调整缩放、透明度和动作时实时观察效果。
- 关闭按钮固定在设置面板右上角，不随设置内容滚动；设置页不提供恢复窗口位置按钮。
- 设置入口位于桌宠底部状态文字旁；默认隐藏，用户悬停桌宠后显示，移向按钮时不得提前消失，键盘聚焦与设置已打开时保持可用。

#### F-06 首次接入引导

- 提供一段可直接发送给 Agent 的完整提示词，要求 Agent 检查或指导安装 `furry-companion-mcp`，并按真实进度上报状态。
- 提供“复制提示词”按钮和复制结果反馈，明确提示用户复制给 Agent 后按其指引连接。
- 展示连接状态和“重新检测”；界面不显示“最近事件”时间。
- 不自动修改 Agent 配置，除非用户对未来安装功能明确授权。

#### F-07 品牌与 Windows 安装器

- 应用、托盘、可执行文件和安装器统一使用用户提供的 `FAS_logo.png` 派生图标；仓库保留原始 PNG 副本作为生成源。
- Windows 交付一个图形化 NSIS 安装 EXE。用户下载并启动后可以选择安装路径，再执行安装；安装器采用 per-machine 模式并请求管理员权限，以确保用户选择受保护目录时能够写入。

### 6.2 P1：首个正式版建议具备

- 开机自启动开关。
- 鼠标穿透模式，以及从托盘或全局快捷键退出穿透的安全入口。
- 跟随操作系统减少动态效果偏好的静态资源降级。
- 角色包导出、版本升级与冲突管理；本地导入和安全校验已纳入 MVP。
- 状态变化音效与独立静音设置，默认关闭。
- 自动更新能力。
- 诊断页：版本、IPC 路径、最近事件时间、连接错误和日志导出。
- 协议增加 `agent_id`、`session_id`、`workspace`、`timestamp` 等可选字段。

### 6.3 P2：后续探索

- 多只桌宠分别代表多个 Agent。
- 单只桌宠的多 Agent 队列、徽标或聚合状态。
- 桌面行走、边缘吸附、点击互动和物理动画。
- 可选的本地任务历史。
- 角色包市场或社区分享。

## 7. MCP 与本地 IPC 集成

### 7.1 现有链路

```text
支持 MCP 的 Agent
  -> furry-companion-mcp set_state 工具
  -> MCP Runtime EventEmitter
  -> 本机 IPC（Named Pipe / Unix Domain Socket，JSON Lines）
  -> furry-agent-pet
  -> 角色状态、详情与结束语气泡
```

桌宠是 IPC 消费者，不是 Agent 的 MCP Client。MCP Server 继续使用标准 `StdioServerTransport`，桌宠不与各家 Agent 的启动方式强耦合。

### 7.2 MVP 事件格式

工作中事件：

```json
{
  "type": "state",
  "state": "coding",
  "message": "Updating the state renderer.",
  "file": "src/state-renderer.ts"
}
```

成功结束事件：

```json
{
  "type": "state",
  "state": "success",
  "message": "桌宠的状态渲染与连接验证已经完成，现在可以查看运行效果了。"
}
```

协议约束：

- `type` 必须为 `state`。
- `state` 必须属于七种已知状态。
- `message`、`file` 为可选字符串，沿用现有 1000 字符上限。
- 消费端忽略未知字段，保证向前兼容。

### 7.3 建议的兼容扩展

```json
{
  "type": "state",
  "state": "testing",
  "message": "Running unit tests.",
  "file": "src/state-renderer.test.ts",
  "agent_id": "codex",
  "session_id": "session-uuid",
  "workspace": "desktop-pet",
  "timestamp": "2026-07-15T12:00:00.000Z"
}
```

未来版本只增加可选字段，不破坏 0.2.x 消费者。MVP 在事件没有来源标识时采用“最后收到的事件优先”，与当前 bridge 行为一致，但不能可靠区分同时运行的多个 Agent。

## 8. 技术方案

### 8.1 推荐技术栈

- 应用壳：Tauri 2。
- 系统与 IPC 层：Rust。
- UI：Vanilla TypeScript + HTML/CSS，首版不引入 React 等大型 UI 框架。
- 动画资源：透明 PNG/WebP/GIF 或规范化精灵图。
- 配置：Tauri Store；窗口状态使用 Window State 插件。
- 进程：Single Instance 插件保证单实例。
- 构建发布：分平台 GitHub Actions 原生构建。

Tauri 2 复用操作系统 WebView，适合透明小窗口和托盘应用，并提供窗口透明、置顶、跳过任务栏、忽略鼠标事件和保存窗口状态等能力。实际透明窗口、鼠标穿透和桌面层级仍需在三平台及 Linux X11/Wayland 上分别验收。

参考：

- [Tauri 官方简介](https://v2.tauri.app/start/)
- [Tauri 窗口配置](https://v2.tauri.app/reference/config/)
- [Tauri 窗口自定义](https://v2.tauri.app/learn/window-customization/)
- [Tauri Window State 插件](https://v2.tauri.app/plugin/window-state/)

### 8.2 模块划分

```text
src-tauri/
  IPC Client          Named Pipe / Unix Socket 与增量 JSON Lines 解析
  State Normalizer    协议校验、节流、超时和状态转换
  Window Controller   位置、缩放、透明、置顶、鼠标穿透
  Tray Controller     托盘菜单、显示隐藏、退出
  Settings Store      本地配置读写与迁移
  Diagnostics         日志、连接状态、版本信息

src/
  Pet Renderer        角色与动画渲染
  State Bubble        状态、详情与任务结束语气泡
  Settings UI         设置与首次引导
  Asset Loader        内置资源和角色包加载
```

Rust 层负责本地 IPC 和文件访问；前端只接收经过校验的状态事件。Tauri capability 仅开放必要窗口操作和应用命令，不暴露任意文件或 shell 权限。

### 8.3 角色资源方案

首版内置一个默认角色包，当前实现结构：

```text
public/pets/
  index.json
  furry-ai-state/
    pet.json
    animations/
      idle.gif
      coding.gif
      sleeping.gif
      exhausted.gif
```

`pet.json` 至少声明包 ID、名称、版本、作者、许可证、画布尺寸、动画字典、七状态映射、循环方式和锚点，并可选声明交互动作映射、一次性动作时长与 GIF→静态动作映射。GIF 等自带时序的媒体使用其内嵌数据；`durationMs` 只决定一次性交互何时恢复，不重写媒体内部帧时序。必须把动画定义、状态映射、交互映射和 reduced-motion 映射分离，并校验路径，禁止通过 `../` 访问包目录外文件。

现有 `furry-ai-state` 动画可作为行为参考；是否直接复用美术资源，需要确认图片版权、作者授权和再分发许可，不能仅依据代码仓库 MIT License 推定所有插画均可再分发。

M0/M1 开发阶段先使用用户提供的 `idle.gif`、`coding.gif`、`sleeping.gif`、`exhausted.gif`。资源包以“目录索引 + manifest + 动画字典 + 状态映射 + 延迟变体 + 可选交互映射 + 可选静态替代映射”组织：Agent 状态、拖拽等交互和 reduced-motion 只引用动画 ID，不直接写文件路径；新增专用 thinking/planning/testing/success、dragging 或静态动作时只扩展 manifest。四个原文件保持不变，公开分发前仍需补齐作者和美术授权。

当前 M1 已实现随应用打包资源包的选择/切换、七状态包内动作选择，以及从设置页选择本地 `pet.json` 的安全导入和删除。导入由 Rust 完成，前端没有通用文件系统权限；应用复制 manifest 与所有被引用资源形成独立快照，设置只保存内容寻址的本地 catalog ID。源目录在导入后可以移动或删除，坏快照会在启动扫描时跳过，失效选择会回退到内置默认包。角色包导出、导入版本管理和可见的坏包诊断仍属后续范围。

内置包的可扩展性由真实 catalog 回归保证：TypeScript 使用生产 loader 读取 `public/pets/index.json` 的全部条目并解析七状态，同时递归枚举包内 GIF/PNG/WebP，要求媒体集合与 manifest 唯一引用集合完全一致；Rust 则遍历相同 index，让每个条目通过 `validate_package_source()` 的已声明媒体安全校验。四个初始 GIF 的 SHA-256、既有七状态映射和 `idle → sleeping @ 60000 ms` 是必须保留的兼容性子集，但不会阻止在动画字典中加入新动作。

延迟状态变体使用可注入定时器的 scheduler。测试必须覆盖 60 秒精确边界、状态切换取消、用户 override 禁用、过期 state revision 和旧 schedule generation；修改非当前状态的 override 不得重渲染或重新调度当前状态，避免唤醒无关的当前 `idle` 动画。

### 8.4 本地角色包导入边界

当前入口只选择文件名严格为 `pet.json` 的 manifest，不直接选择或长期授权整个目录。Rust 会 canonicalize 包根目录，拒绝符号链接、Windows 重解析点、绝对路径、盘符/UNC、反斜杠、百分号编码、`.`、`..`、查询/片段字符、保留设备名和越过八层的资源路径；每个引用文件的 canonical path 必须仍位于包根目录内。扩展名、声明的 `mediaType` 与文件实际内容必须一致。

验证通过后，导入器只复制 `pet.json` 和 manifest 引用的媒体到应用数据目录中的唯一 `pet-packages/.staging-*`，再以原子重命名完成安装。快照目录 ID 为 `local-` 加内容 SHA-256 的前 24 位十六进制；相同内容复用已有有效快照。列出、导入和删除由进程内互斥锁串行化，避免并发操作同一存储。列表扫描不会删除 staging；只有新导入开始时才清理已满 24 小时且整棵目录树不含链接/重解析点的 stale staging，近期或可能仍活跃的 staging 保留。WebView 只通过受限 asset protocol 读取 `$APPDATA/pet-packages/**/*`，不会直接加载用户原始目录。Rust DTO 必须返回 manifest 中每个唯一 source 对应的快照绝对 `assetPaths`，前端校验映射完整性后逐文件调用 `convertFileSrc`；不得把含 Windows encoded backslash 的 manifest asset URL 当作相对 URL 基址。删除命令只接受导入器生成的本地 ID，在递归删除前重新检查受管目录边界，并遍历拒绝待删树任意层级的符号链接、重解析点和非常规文件。

| 边界 | 当前值 |
| --- | --- |
| 本地快照数量 | 最多 32 个 |
| manifest | `schemaVersion: 1`，文件最多 64 KiB，并计入整包 64 MiB 上限 |
| 动画条目 | 1–64 个；每状态最多 16 个延迟变体，整包最多 64 个 |
| 单个/整包字节 | 单个媒体最多 10 MiB；manifest 与所有唯一引用媒体合计最多 64 MiB |
| 媒体类型与解码 | GIF、静态 PNG、静态 WebP；拒绝 APNG 和动画 WebP。PNG/WebP 必须在 32 MiB 解码内存边界内完成真实解码；GIF 元数据检查使用 16 MiB 内存边界 |
| 图片尺寸 | manifest 画布和实际媒体的宽高都为 1–2048 px |
| 整包解码像素 | 所有唯一媒体累计最多 120,000,000：GIF 按逻辑画布宽 × 高 × 帧数计算，PNG/WebP 按宽 × 高计算 |
| GIF 成本 | 最多 300 帧；动态帧延迟至少 2 cs；单轮累计时长最多 6000 cs（60 秒） |
| WebP 容器 | RIFF 声明长度必须与文件精确闭合；拒绝容器外尾随数据、截断/越界 chunk、重复/错位的 VP8X、重复或冲突的 VP8/VP8L 图像数据，以及 VP8X、图像位流和真实解码结果之间的尺寸不一致 |
| 延迟变体 | `activateAfterMs` 为 1–86,400,000 ms |

完整 manifest 示例和路径字符规则见 [`PET_PACKAGES.md`](PET_PACKAGES.md)。这些数值是本地不可信导入边界；内置资源仍需经过代码审查和授权确认。

### 8.5 当前实现验证记录

隔离 Windows Debug runtime 已从原生文件对话框导入真实 `pet.json`。设置只保存 `local-c6ee…` catalog ID，不含源路径；快照 manifest 与四个 GIF 的哈希逐一等于源文件。把源目录改名后重启，应用仍从快照加载选中包；同一 GIF 间隔 750 ms 的两帧有 45.08% 像素不同，确认动画实际播放。UI 删除后快照目录消失，设置回退到 `furry-ai-state`。

首次 runtime 验证发现 Windows encoded backslash 经 asset URL 编码后不能可靠参与相对 URL 解析；改为 Rust 返回逐资源绝对 `assetPaths`、前端逐文件 `convertFileSrc` 后，重启加载与播放回归通过，并增加相应 TypeScript 回归测试。

窗口左上角从 `(1000000, 1000000)` 的完全离屏位置恢复到边界 `(left, top, right, bottom) = (1996, 916, 2536, 1576)`，位于 `2560 × 1600` 屏幕范围内。Window State 的当前 Debug 回归还覆盖了无状态/`visible=true` 显示、`WM_CLOSE` 隐藏但不退出、隐藏退出写入 `main.visible=false`、重启保持隐藏、第二实例唤醒原实例，以及最终可见退出写入 `main.visible=true`。

2026-07-16 当前源码通过完整 `npm run check`（9/9 Vitest 文件、51/51 前端测试、53/53 Rust 测试）、严格 Clippy、0 漏洞依赖审计，以及发布版 `furry-companion-mcp 0.2.0` MCP→隔离 Named Pipe 复跑。Rust 到主线程的状态 publication queue 现为最多 64 项、队尾合并且按连接 generation 淘汰旧事件，避免旧 reader 在重连后覆盖新状态或让积压无界增长。Windows 隔离 Debug runtime 使用完整重建而非 `--skip-build`，证据生命周期为 `188.820 s`（`2026-07-16T11:32:14.653Z` 到 `2026-07-16T11:35:23.473Z`）；证据目录 `.cache/native-windows-smoke/1784201511453-9204`，20,196,864-byte Debug EXE 的 SHA-256 为 `33D052E6D24DB481F364AAC23BF6582784F3911377F5676ED725A42BC17836F4`。该 run 通过异常协议恢复、七状态与四 GIF 映射、error 确认、success 原文气泡、悬停回看、首次向导“稍后”/重开/重新检测/完成、Store v1 设置落盘与重启恢复、应用内优雅退出、Runtime 有界自动重连、窗口响应、单实例和真实托盘冒烟；idle 后 `60,018.8381 ms` 观察到完整 576 x 530 `sleeping.gif`，无图片错误。140 个样本的状态文本/DOM 标记为 p50 `1.53 ms`、p95 `6.08 ms`、max `8.25 ms`；一次 Pipe 写入 1001 条 `coding` 事件只触发 2 次 DOM marker 更新。Debug 链接阶段的 MSVC runtime PDB `LNK4099` 为非阻断警告。该延迟口径包含 CDP 回传但不测 GIF 首帧像素呈现，也不替代三平台统一性能验收。

2026-07-22 新增正交交互动作层、系统与手动减少动态效果降级：manifest 可选 `interactions`，当前 runtime 触发 `hovering`、`dragging` 与 `clicked`；token 化控制器处理嵌套与过期结束，注入调度器的一次性控制器处理有界动作并允许重复触发只刷新计时。一次性交互可声明 100–60,000 ms 的 `durationMs`，省略时 `clicked` 使用 650 ms；TypeScript/Rust 统一校验，Rust camelCase 序列化和源目录删除后的受管快照重载均有自动化证据。动作语义与 CSS 后备分离，包内专用动画和通用效果互斥；鼠标长按手势阻止真实拖拽结束时 WebView 合成的点击误播，键盘点击保持可用。可选 `reducedMotionAnimations` 把任意 GIF 动作映射到同一动画字典中的非循环 PNG/WebP，并复用 Rust 导入、解码预算、内容寻址快照和逐文件 asset URL 边界。系统请求与手动设置取“或”，都关闭后回到最新状态/交互，静态 PNG/WebP 不受影响。完整 `npm run check` 为 14/14 Vitest 文件、74/74 前端测试和 57/57 Rust 测试。最新完整成功 run `.cache/native-windows-smoke/1784697111517-1268` 从当前源码完整重建 20,264,448-byte Debug EXE（SHA-256 `BE0C7AD5499978751AC0BEA81CDA641DEA3F01C88FFCC731EF4E2B78F8AB5382`），原生分别记录系统和手动路径的 `idle.gif → fallback-idle.svg → idle.gif`、CSS 动画 `hovering-bob → none → hovering-bob`，并验证 `reduceMotion=true` 由 Rust Store 落盘、退出后跨重启恢复；同一 run 记录 `hovering → dragging → hovering → 无交互`、拖拽历史没有 `clicked`、独立默认时长 `clicked/clicked-pop → 无交互`，以及 requested/observed 均为 `(96,64)` 的真实拖拽。该 run 同时通过七状态/四 GIF、140 样本 p50 `1.35 ms` / p95 `5.70 ms` / max `6.68 ms`、1001 事件到 2 次更新、六项托盘和 `sleeping.gif @ 60,020.66 ms`，`success=true`、`cleanupSafe=true`。初始包的 `interactions` 和静态映射为空；安装后 Release 尚未复跑交互层与 reduced-motion 更新。

同一 Debug run 的桌面集成探针以两种原生底色验证透明合成：透明采样精确跟随 `(21,166,227)` 与 `(239,72,92)`，opaque 探针两次均保持 `(246,196,46)`；topmost 开启/关闭时实际 Z-order 分别为 `-1` / `1`；client bounds 与 window bounds 完全相等；真实 Win32 鼠标拖动 requested/observed 均为 `(96,64)`。`tray-integration.json` 记录真实操作六项托盘菜单，并验证 connected/disconnected 状态、左键隐藏/恢复、菜单隐藏/显示、恢复到屏幕中心、窗口隐藏时打开设置并获焦、置顶 native/UI/menu 同步、断线后 client 1→2 重连，以及隐藏窗口通过托盘退出且退出码为 0。connecting/disabled 仅验证了单元测试中的文案映射；tooltip 证据是绑定托盘图标的 UIA accessible name 包含状态，不是像素级可视检查；普通任务栏图标缺失没有被明确验证。无边框证据来自 client/window 几何相等，而不是 `WS_CAPTION` 或 `WS_EX_APPWINDOW` 兼容位。

2026-07-16 安装器基线的正式 NSIS（5,664,565 bytes，SHA-256 `EA181EFE9A93B153570AA92D893F351049492E821BED7C5064559163E79DF5DF`）已通过 current-user 安装/卸载；隔离 NSIS（5,665,555 bytes，SHA-256 `E629E932BEB152191A46C98EC73A8F102D49FD5FD98488C1F8B343119F39E7AF`）完成安装、全量 native smoke 和卸载，两者均为 `NotSigned`。机器可读报告 `.cache/windows-installer-smoke/1784201848768-33384/installer-smoke-report.json` 记录 `currentSourceBuild=true`、`success=true`，生命周期 `518.730 s`。安装后的精确 Release EXE 为 14,349,824 bytes，SHA-256 `E6DF0C4422886688C22202B334944F57912FA749199BBBB687C3E589181BAD34`；它在 `.cache/native-windows-smoke/1784202165728-19428` 重复七状态、四 GIF 映射、首次向导/Store v1 设置、透明合成、topmost、client/window 几何、真实 `(96,64)` 拖动和全部真实托盘操作。该 Release 早于交互层及 reduced-motion 静态降级。安装后 Release 尚未重复本地角色包原生 dialog/import/delete/恶意包 UI；物理多显示器拔插、混合 DPI、负坐标布局、Windows 10/ARM64、macOS、Linux X11/Wayland、真实外部 Agent UI、签名、美术许可、初始角色的授权 poster 和资源目标仍未完成。详见 [`SMOKE_TEST_REPORT.md`](SMOKE_TEST_REPORT.md)。

## 9. 跨平台要求

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 本地 IPC | Named Pipe | Unix Domain Socket | Unix Domain Socket |
| 透明无边框窗口 | 必须 | 必须 | 必须，按桌面环境验收 |
| 总在最前 | 必须 | 必须 | 尽力保证并记录 compositor 限制 |
| 托盘/菜单栏 | 必须 | 必须 | 必须，可能依赖 AppIndicator |
| 多显示器/DPI | 必须 | 必须 | 必须 |
| 安装包 | NSIS/MSI 至少一种 | DMG/App Bundle | AppImage，后续补 deb/rpm |
| CPU 架构 | x64 首发 | Apple Silicon + Intel | x64 首发，ARM64 后续 |

首发开发和验收顺序为 Windows -> macOS -> Linux。跨平台发布必须使用对应平台 CI runner 原生构建和冒烟测试，不能只凭 Windows 构建通过宣称三平台完成。

Linux 当前采用可达性优先的待验证策略：启动时始终显示主窗口，关闭请求直接退出而不是隐藏到可能不可见的托盘。该行为必须分别在 X11 和 Wayland 实机验证后才能宣称完成。

## 10. 非功能需求

### 10.1 性能目标

- `idle` 稳态 CPU 平均占用低于单核 1%。
- 常规动画状态 CPU 平均占用低于单核 5%。
- 稳态内存 RSS 目标不高于 80 MB，分别记录三平台实际值。
- 冷启动到显示桌宠目标小于 2 秒。
- IPC 事件到动画更新 P95 延迟小于 200 ms。
- 应用自身安装包目标不高于 20 MB，不计系统已有 WebView 或平台运行库。
- 断线重连不得忙轮询。

### 10.2 稳定性

- MCP Runtime 未启动、重启或异常退出时桌宠不得崩溃。
- IPC 输入包含半包、粘包、空行、非法 JSON、未知字段时安全处理。
- Unix Socket 残留、Named Pipe 被占用时给出可诊断错误。
- 角色资源缺失或损坏时回退到内置静态 `idle` 资源。
- 应用保持单实例，再次启动时显示已有实例。

### 10.3 隐私与安全

- 默认完全离线，不收集遥测。
- 所有状态事件只通过本机 IPC 传输。
- 日志默认不记录完整 `message` 和 `file`。
- UI 使用纯文本渲染，禁止将 Agent 内容作为 HTML 注入。
- 自定义资源只从用户明确选择的 `pet.json` 及其受控相对引用中读取；验证后复制为应用数据快照，不保存源目录绝对路径。
- 本地媒体必须在 Rust 中完成路径、大小、格式、尺寸、整包解码像素预算与动画成本校验；PNG/WebP 还必须在有界内存内真实解码，才允许 WebView 通过限定到 `pet-packages/` 的只读 asset protocol 显示。
- 自动更新必须校验签名或发布清单签名。

### 10.4 可用性与无障碍

- 自动尊重操作系统减少动态效果偏好，成功闪光不得高频闪烁。
- 状态不能只依赖颜色，应同时使用动作、图标或文字。
- 提供静音、隐藏详情、透明度和缩放控制。
- 桌宠默认不抢夺键盘焦点。

## 11. MVP 验收标准

1. 在 Windows、macOS、至少一个主流 Linux 桌面环境安装并启动，能看到透明背景桌宠。
2. 用户可拖动、缩放、隐藏桌宠，重启后恢复位置和设置。
3. 没有 MCP Runtime 时应用保持可用并显示未连接状态。
4. 启动 `furry-companion-mcp` 后自动连接，无需重启桌宠。
5. 依次发送七种合法状态，桌宠均在 200 ms 目标范围内切换表现。
6. `message` 和 `file` 可按设置显示或隐藏，恶意 HTML 字符串不会执行。
7. 带结束语的 `success` 事件触发庆祝动作和完整文字气泡；气泡可暂停计时、手动关闭和按设置自动关闭。
8. 关闭并重启 MCP Runtime，桌宠不崩溃并自动重连。
9. 发送非法 JSON、未知状态和超长字段，应用不崩溃且诊断可定位问题。
10. 托盘菜单能完成显示/隐藏、重连、恢复位置、设置和退出。
11. 使用统一测试脚本记录三平台 CPU、内存、启动耗时和状态延迟。
12. 导入有效本地包后，移动或删除源目录并重启应用仍能显示快照；路径穿越、媒体伪装和超限资源被拒绝；删除本地包不会影响受管目录之外的文件。
13. 从已断开的显示器恢复位置时，桌宠回到当前显示器工作区；负坐标布局和不同 DPI 下不会永久离屏，仍部分可见的位置不会被擅自移动。
14. `error` 气泡不会自动关闭，可由后续合法状态覆盖或由用户确认；确认只改变本地展示，不向 MCP Runtime 回写事件。
15. 设置入口默认隐藏并位于状态文字旁，悬停桌宠后可见且可稳定点击；打开设置或接入向导时侧栏出现在桌宠旁边，桌宠保持可见；设置关闭按钮在任意滚动位置都保持于右上角。
16. 接入向导可一键复制完整 Agent 提示词，提示词包含 MCP 安装/检查方式、状态上报契约和隐私边界。
17. Windows 安装 EXE 使用 FAS Logo，并在交互式安装流程中展示安装目录选择页。

## 12. 里程碑建议

### M0：技术验证

- 初始化 Tauri 2 最小项目。
- 验证透明、无边框、置顶、拖动和托盘能力。
- 验证 Windows Named Pipe 与 macOS/Linux Unix Socket。
- 使用模拟器发送七种状态和结束语，记录延迟与资源占用。

### M1：Windows MVP

- 完成窗口、托盘、IPC、状态机、完成气泡、默认角色和基础设置。
- 完成应用内首次接入引导。
- 完成本地角色包安全导入、内容寻址快照、选择和删除。
- 完成断开显示器后的窗口位置修复，并在 Windows 多显示器/DPI 场景中验收。
- 与现有 `furry-companion-mcp` 做端到端测试。
- 产出 Windows 安装包。

### M2：macOS/Linux 适配

- 修复窗口层级、托盘、DPI、路径和打包差异。
- 在远程 runner 验证分平台 CI，并补齐原生运行与安装冒烟测试。
- 产出 macOS、Linux 安装包。

### M3：正式版准备

- 完整诊断页、开机自启、角色包导出与管理增强，以及为初始角色补齐获授权的专用静态 poster；系统偏好、手动开关和按动画静态降级能力已完成。
- 完成代码签名、自动更新、隐私说明和发布文档。

## 13. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| Linux Wayland 对置顶、透明或穿透支持不一致 | 平台体验不一致 | X11/Wayland 分别测试；能力检测与降级；维护支持矩阵 |
| 当前协议没有 Agent/Session 标识 | 多 Agent 状态互相覆盖 | MVP 最后事件优先；协议新增可选来源字段 |
| Agent 不主动调用 `set_state` | 桌宠长期不更新 | 提供 Agent skill 和 `AGENTS.md` 契约；诊断最近事件时间 |
| 成功状态后 Runtime 退出 | 新连接可能得到旧状态 | 桌宠展示超时；协议后续加入时间戳和 session 生命周期 |
| 自定义动画过大 | 高内存和 CPU | 限制尺寸、帧数、文件大小和帧率；提供静态降级 |
| 美术授权不清晰 | 无法公开发布 | 维护作者与许可证；首发仅使用明确授权或新制作资源 |
| 安装包未签名 | 系统安全告警 | 正式发布前配置代码签名和 notarization |

## 14. 待确认问题

1. 首个角色复用 `furry-ai-state` 兽设，还是制作全新角色？现有插画是否有明确再分发授权？
2. “悬停在桌面”是始终位于所有窗口最前，还是只位于桌面图标上方、普通应用下方？
3. 多个 Agent 同时运行时，希望最后状态覆盖、单只宠物聚合，还是每个 Agent 一只宠物？
4. 是否接受先完成 Windows MVP，再适配 macOS/Linux？
5. MVP 是否需要点击互动、跟随鼠标、桌面行走，还是仅要求拖动和状态动画？
6. 是否允许在桌面气泡显示 Agent 的普通 `message` 和文件路径？
7. 角色资源偏好 GIF/WebP，还是统一精灵图？
8. 计划开源发布到 GitHub Releases，还是作为内部/个人工具使用？

## 15. 需求冻结前的默认决策

- Tauri 2 + Rust + Vanilla TypeScript。
- Windows 为开发优先平台，macOS/Linux 为正式版必达平台。
- 复用 `furry-companion-mcp` 0.2.x IPC 协议。
- 默认总在最前、可拖动、不抢焦点；鼠标穿透放入 P1。
- 单只桌宠，多 Agent 事件按最后收到者覆盖。
- 内置七种状态，成功动作 8 秒后回到空闲，错误持续到新事件。
- Agent 成功结束时通过 `success.message` 返回一段结束语，气泡默认展示 15 秒。
- 默认短暂显示普通状态说明；文件路径可关闭。
- 首版不联网、不收集遥测、不读取 Agent 对话。
