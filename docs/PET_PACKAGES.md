# 桌宠资源包格式

资源包把“动画文件”与“Agent 状态”分开。新增动作通常只需要放入媒体文件并修改 `pet.json`，不需要修改渲染器或 Rust IPC 代码。

## 目录结构

```text
my-pet/
  pet.json
  animations/
    idle.gif
    coding.gif
    testing.gif
    success.gif
```

应用当前接受 GIF、PNG 和 WebP。GIF 可以包含动画；本地导入的 PNG/WebP 暂按静态图片处理，检测到 APNG 或动画 WebP 时会拒绝。PNG/WebP 不只检查文件头或容器元数据，还必须在 32 MiB 解码内存边界内完成一次真实解码；GIF 元数据解析有 16 MiB 内存边界。文件扩展名、`mediaType` 和实际文件内容三者必须一致。

## 最小 manifest

```json
{
  "schemaVersion": 1,
  "id": "my-pet",
  "name": "My Pet",
  "version": "1.0.0",
  "author": "Your name",
  "license": "Your asset license",
  "canvas": {
    "width": 610,
    "height": 600,
    "fit": "contain",
    "anchor": { "x": 0.5, "y": 1 }
  },
  "animations": {
    "idle": {
      "source": "animations/idle.gif",
      "mediaType": "image/gif",
      "loop": true,
      "alt": "桌宠待机"
    },
    "coding": {
      "source": "animations/coding.gif",
      "mediaType": "image/gif",
      "loop": true,
      "alt": "桌宠正在编码"
    }
  },
  "states": {
    "idle": "idle",
    "thinking": "idle",
    "planning": "idle",
    "coding": "coding",
    "testing": "coding",
    "success": "idle",
    "error": "idle"
  },
  "fallbackAnimation": "idle"
}
```

七个状态键必须全部存在，但多个状态可以复用同一动作。动画 ID 只引用 `animations` 中的条目，不直接保存绝对文件路径。

manifest 的其他结构边界：

- `schemaVersion` 当前只能是 `1`。
- 包 ID 和动画 ID 最多 64 个字符，首字符为 ASCII 字母或数字，其余只能使用字母、数字、点、下划线和连字符。
- `name`、`author`、`license` 最多 128 个字符，`version` 最多 64 个字符，`description` 最多 1024 个字符，动画 `alt` 最多 256 个字符；这些必填文本不得为空。
- manifest 画布宽高各为 1–2048，`fit` 只能是 `contain` 或 `cover`，锚点 `x` / `y` 必须位于 0–1。
- `animations` 必须有 1–64 个条目；`fallbackAnimation` 和每个状态/延迟变体都必须引用已声明的动画。
- GIF 的 `loop` 必须与文件内嵌 repeat extension 一致：`loop: true` 要求无限重复，`loop: false` 要求文件不是无限重复。浏览器 `<img>` 按 GIF 自带时序与重复次数播放，应用不另建 JavaScript 循环计时器。静态 PNG/WebP 的该字段不改变静态呈现。

## 延迟动作

`stateVariants` 可以在一个状态持续一段时间后切换动作。例如空闲一分钟后睡觉：

```json
{
  "stateVariants": {
    "idle": [
      { "animation": "sleeping", "activateAfterMs": 60000 }
    ]
  }
}
```

如果用户在设置页为该状态固定选择了动作，延迟动作不会覆盖用户选择。

## 交互动作

`interactions` 把窗口交互与动画 ID 分开，避免把拖拽、悬停、点击等 UI 行为硬编码成新的 Agent 状态。例如角色包提供专用交互动画时，只需声明：

```json
{
  "interactions": {
    "hovering": { "animation": "curious" },
    "dragging": { "animation": "carried" },
    "clicked": { "animation": "surprised", "durationMs": 1250 }
  }
}
```

交互动作 ID 与动画 ID 使用相同的安全标识符规则，一个包最多声明 32 个交互动作；每一项必须引用 `animations` 中已有的动画。可选 `durationMs` 是 100–60,000 ms 的整数，供 `clicked`、未来的 `petting` 等一次性触发器决定何时恢复此前动作；省略时由应用为该触发器提供默认值。悬停和拖拽由真实指针生命周期结束，不使用这个时长。当前运行时会触发 `hovering`、`dragging` 和 `clicked`，未来增加动作时无需扩充 MCP 的七状态协议。尚未提供专用交互动画的包可以省略该字段或使用空对象；应用仍会分别通过有界的 `hovering-bob`、`dragging-float` 和 `clicked-pop` CSS 反馈动作，并在 reduced-motion 生效时关闭这些动效。

交互控制器使用独立 token 管理可嵌套动作，最后开始的有效动作优先；旧动作结束不会错误覆盖新动作。定时动作复用同一控制器，并通过可注入调度器约束生命周期；当前 `clicked` 未配置时持续 650 ms，配置后使用角色包的受限 `durationMs`，重复点击只刷新结束时间。交互期间暂停状态延迟变体，结束后恢复当时最新的 Agent 状态并重新调度延迟变体。状态与交互因此是两个正交维度：`coding → hovering → dragging → hovering → coding` 只改变临时表现，不会伪造新的 MCP 状态。

前端 loader 与 Rust 导入器使用相同的时长边界。Rust 以 camelCase `durationMs` 读写 manifest，内容寻址安装会保留该元数据；源目录删除后，从受管快照重载仍得到相同值。当前四 GIF 内置包显式使用空 `interactions`，因此保持既有 650 ms CSS 点击后备，不需要修改资源文件。

运行时会分别解析“交互语义”和“CSS 后备”。角色包提供同名交互映射时只播放包内资源，不叠加通用 CSS；没有映射时才保留当前状态资源并使用内置反馈。鼠标长按拖拽后浏览器可能合成 `click`，应用会按手势时长抑制该事件，避免拖拽结束误播 `clicked`；键盘和辅助技术触发的点击仍保留。

## 减少动态效果映射

`reducedMotionAnimations` 可以为任意 GIF 动作指定同一 `animations` 字典中的静态替代动作。例如：

```json
{
  "animations": {
    "coding": {
      "source": "animations/coding.gif",
      "mediaType": "image/gif",
      "loop": true,
      "alt": "桌宠正在编码"
    },
    "coding-static": {
      "source": "animations/coding-static.webp",
      "mediaType": "image/webp",
      "loop": false,
      "alt": "桌宠保持静止并使用电脑"
    }
  },
  "reducedMotionAnimations": {
    "coding": "coding-static"
  }
}
```

映射源必须是已声明的 GIF；目标必须是已声明、`loop: false` 的静态 PNG 或 WebP。目标仍属于普通动画条目，因此自动进入现有路径、格式、大小、尺寸、完整解码、整包像素预算、内容寻址快照和逐文件 `assetPaths` 校验，不存在绕过 Rust 导入器的 poster 路径。一个静态动作可以被多个状态、交互或 GIF 复用。

当操作系统的 `prefers-reduced-motion: reduce` 生效时，应用优先显示包内映射；没有映射的 GIF 才退回内置静态角色。设置页不提供手动开关。PNG/WebP 本来就是静态资源，不会再替换。系统偏好关闭后，渲染器回到当时最新的状态、延迟变体或交互动作，不会恢复已经过期的动作。当前 `furry-ai-state` 初始包只含用户提供的四个 GIF，因而显式声明空映射并继续使用统一静态后备；未来加入获得授权的专用 poster 时无需修改渲染器。

## 加入内置资源包

1. 将整个目录放入 `public/pets/<package-id>/`。
2. 在 `public/pets/index.json` 中登记 ID 和 `pet.json` 相对路径。
3. 运行 `npm test`；生产 loader 回归会加载真实 catalog 的每个条目，manifest 回归会递归枚举每个包的 GIF/PNG/WebP，并要求实际媒体集合与 manifest 唯一引用集合完全一致。
4. 运行 `npm run test:rust`；Rust 会解析真实 catalog，并让每个条目通过 `validate_package_source()` 的已声明媒体安全校验。
5. 启动应用后，设置页会自动列出新包和其中的所有动作。

因此，新增动作必须同时出现在动画字典及包目录中：漏文件、未声明的孤儿媒体，以及 catalog ID 与 manifest 不一致都会由自动化发现。2026-07-22 已再次逐字节确认用户提供的外部源、`public/` 和 `dist/` 三份完全一致；现有四个 GIF 的哈希检查是兼容性子集而非“只能有四个动作”的数量断言：

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `coding.gif` | 812,642 bytes | `47736BEB18B2013983449FA5B1B45768D390B9E8DD85741CA7AC4EEADCFAD795` |
| `exhausted.gif` | 900,194 bytes | `102118E45E01F83531E4FC98EC1243904ACCD0FB4E9ACF34F61563446BACB4D5` |
| `idle.gif` | 734,301 bytes | `9AFFB3C702AFFD8873A361CF871760C1085BA852C36C9E6132CEE60051BB83BB` |
| `sleeping.gif` | 737,547 bytes | `EF57DCB29EFCE92DA8C67B0F4579C5ABEB9FCD652094CCD89D36D8B20AE5DC16` |

同一回归还锁定七状态映射：`idle/thinking/planning/success → idle`、`coding/testing → coding`、`error → exhausted`，以及 `idle → sleeping @ 60000 ms`。延迟变体 scheduler 使用可注入定时器，测试覆盖 60 秒边界、状态切换取消、用户 override、过期 state revision 和旧 schedule generation；修改非当前状态的 override 不会重渲染或重新调度当前 `idle`。2026-07-16 的真实 Windows 原生冒烟又分别在 Debug `60018.8381 ms` 和安装后 Release `60028.4089 ms` 观察到 `sleeping.gif`；两者均 `complete=true`、natural size `576 × 530` 且无 image error。

内置资源会随安装包分发，因此必须确认作者、许可证和插画再分发授权。当前 `furry-ai-state` 的许可信息仍是 placeholder；上述哈希一致性与运行通过不构成再分发授权，发布前必须替换为可核验的作者和许可证元数据。

## 导入本地资源包

在桌面应用设置页选择“导入 pet.json”，并选择文件名严格为 `pet.json` 的 manifest。当前入口不直接选择目录。应用不会长期授权或直接渲染原始目录，而是由 Rust 完成以下事务：

1. 读取并验证 manifest 和每个引用的媒体文件。
2. 检查相对路径、真实文件格式、尺寸、文件大小和动画成本。
3. 只把 manifest 和其中被引用的媒体复制到应用数据目录 `pet-packages/` 中本次导入独占的唯一 staging 快照。
4. 对 manifest 原始字节以及按路径排序的资源路径/内容计算 SHA-256，以前 24 位十六进制生成 `local-<hash>` 本地包 ID，再通过重命名原子安装快照。
5. Rust DTO 返回快照 manifest 的绝对路径，以及每个唯一媒体 source 对应的快照绝对 `assetPaths`；前端要求键集合与 manifest 精确一致，再逐文件调用 `convertFileSrc`。
6. 仅把本地包 ID 写入设置；不保存用户原始绝对路径。

因此，导入完成后可以移动或删除原始目录；再次导入完全相同的内容会复用已有有效快照。删除设置页中的本地包时，应用会先切回内置默认包，并且只删除应用自己的快照。删除命令会校验 `local-<24 位小写十六进制>` ID 和 canonical 目录边界，并在真正递归删除前遍历整棵待删树；任意层级出现符号链接、Windows 重解析点或非常规文件都会拒绝删除。命令不接受 manifest 自带 ID 或任意路径。

列出、导入和删除共享一个进程内互斥锁，存储操作不会在本进程内并发修改。启动扫描会逐个重新验证本地快照及其内容哈希；损坏、被篡改或格式无效的目录会被跳过，不会阻止其他本地包和内置包加载。如果设置中选中的本地包已经失效，应用会回退到内置默认包并清除不再适用的状态动作覆盖。当前 UI 尚不会逐包展示坏快照的具体诊断。

每个 staging 名称组合本地包 ID、进程 ID、时间戳与进程内单调计数器，避免两个导入使用同一路径。本次导入失败时会立即删除自己的 staging。列表扫描不会删除任何 staging；只有开始新的导入时，才尝试清理修改时间已满 24 小时、且整棵目录树均通过链接/重解析点检查的 stale staging。近期或可能仍活跃的 staging 会保留。

本地资源渲染不能通过“转换 manifest 路径后，再用 `new URL(relativeSource, manifestAssetUrl)`”拼接。Windows 路径的反斜杠会被 asset URL 编码，相对 URL 解析不能可靠得到媒体地址。当前实现以 Rust 提供的逐文件绝对 `assetPaths` 为准，每个路径独立 `convertFileSrc`，并优先用得到的 `assetUrls[source]` 渲染；内置包仍可使用受信任的相对 URL。

## 本地导入安全上限

- manifest：最多 64 KiB。
- 动画：最多 64 个。
- 已安装本地快照：最多 32 个。
- 单个媒体文件：最多 10 MiB。
- 整包字节：manifest 与所有唯一引用媒体合计最多 64 MiB；64 MiB 是整个快照输入上限，不是仅针对媒体的上限。
- manifest 画布和实际媒体：宽高各 1–2048 像素。
- 整包解码像素：所有唯一媒体累计最多 120,000,000；GIF 按逻辑画布宽 × 高 × 帧数计数，静态 PNG/WebP 按宽 × 高计数。该数值不是每个 GIF 各自独立可用的预算。
- GIF：最多 300 帧；多帧 GIF 的每帧延迟至少 2 centiseconds（上限约 50 FPS）；单轮累计时长最多 6000 centiseconds（60 秒）。元数据检查使用 16 MiB 内存限制，并在不展开帧像素的模式下检查帧一致性、帧数和延迟。
- 延迟动作：每个状态最多 16 个，整个包最多 64 个，延迟不超过 24 小时。
- 交互动作：最多 32 个；动作 ID 必须安全，且只能引用同一 manifest 已声明的动画。
- 路径：最多 256 个字符、最多八层，只允许包目录内的普通 UTF-8 相对文件。绝对路径、盘符/UNC、空段、`.`、`..`、反斜杠、冒号、查询/片段字符、百分号编码、控制字符、`< > " | *`、Windows 保留设备名、尾随点/空格、符号链接和重解析点都会被拒绝；仅大小写不同却指向不同资源的路径也会被拒绝。
- PNG：必须在 32 MiB 解码内存边界内读出完整静态图像并让解码器正常结束；容器、压缩流、像素数据或尾随数据无效都会失败，出现 animation control 的 APNG 会被拒绝。
- WebP：RIFF 声明长度必须与文件长度精确相等，所有 chunk 与 padding 必须完整落在容器内，容器外尾随数据会被拒绝。VP8X 必须位于首个 chunk、只能出现一次且保留位合法；VP8/VP8L 图像数据不能重复或互相冲突。扩展头尺寸、位流尺寸和真实解码器尺寸必须一致，并在 32 MiB 内存边界内完整解码；animation flag、ANIM、ANMF 或解码器报告动画都会被拒绝。

这些限制是本地不可信导入边界，不等同于内置资源的发布授权。内置资源仍需经过代码审查和美术许可确认。未来若开放动画 WebP/APNG，会先为对应解码器增加同等级的帧数、像素和内存限制。

导入后的媒体只通过 Tauri asset protocol 的 `$APPDATA/pet-packages/**/*` scope 展示；前端没有通用文件系统或 shell capability。Windows 原生文件选择器、快照 asset URL、重启播放和 UI 删除已在隔离 Debug runtime 中完成有效包冒烟；macOS、Linux X11 和 Linux Wayland 仍需分别验证，不能从 Windows 结果推定跨平台完成。

## 当前运行时验证边界

隔离 Windows Debug runtime 已完成有效包完整链路：原生文件对话框导入；设置仅保存 `local-c6ee…` 且不含源路径；快照 manifest 与四个 GIF 的哈希逐一等于源文件；源目录改名后重启仍从快照加载；同一 GIF 间隔 750 ms 的两帧有 45.08% 像素不同；UI 删除后快照目录消失且设置回退到 `furry-ai-state`。逐文件 `assetPaths` 修复后的 Windows 加载与播放已回归通过，TypeScript 测试覆盖 encoded backslash 路径转换和 manifest/assetPaths 不匹配拒绝。

上述本地包导入/快照/删除结论来自隔离 Windows Debug runtime。2026-07-16 最新安装器基线的未签名正式/隔离 NSIS 为 `EA181E…` / `E629E9…`，权威报告 `.cache/windows-installer-smoke/1784201848768-33384/installer-smoke-report.json`；安装后的隔离 Release 子 run `.cache/native-windows-smoke/1784202165728-19428` 已复跑七状态、四 GIF、桌面/托盘和 60 秒睡眠变体，但**没有**复跑本地包原生对话框、导入、源目录失效后重启、UI 删除、坏包 UI 拒绝或新的 reduced-motion 静态降级。macOS、Linux X11 和 Linux Wayland 仍未实机验证；Windows 物理多屏/混合 DPI、Windows 10/ARM64、真实外部 Agent UI、初始角色的实际授权 poster 与完整性能目标也不属于本轮资源包验收。详见 [`SMOKE_TEST_REPORT.md`](SMOKE_TEST_REPORT.md)。
