# Windows 性能基线

记录日期：2026-07-15（资源占用基线）；2026-07-16（安装后 Release）；2026-07-22（当前 Debug 动作层）  
应用版本：0.1.0  
资源占用测量对象：2026-07-15 的 Windows x64、Tauri 2.11.5、系统 WebView2 131、当日 release 可执行文件、MCP 未连接。完整进程树包含主进程及其 WebView2 后代进程；这些 CPU/内存数字尚未对 2026-07-16 当前 Release 重测。

## 当前结果

| 构建 | 可执行文件 | 主进程 working set | 完整进程树 working set | 完整进程树 private memory |
| --- | ---: | ---: | ---: | ---: |
| debug | 13.45 MB | 约 37 MB | 约 470 MB | 约 266 MB |
| 2026-07-15 release，稳定采样 | 13,074,432 bytes | 约 27.3 MB | 约 426.6–437.8 MB | 约 217.6–218.8 MB |

release 稳态完整进程树进行了两段采样：12 秒内累计约 0.6876 CPU 秒，折算约单核 5.73%；20 秒内累计约 0.7969 CPU 秒，折算约单核 3.98%。当前动画 idle/sleeping 路径不能声称达到 PRD 的单核 1% 目标；仍需用 ETW 做更长时间和分进程归因。

## 2026-07-16 当前源码 Debug 与安装后 Release 状态延迟

| 指标 | 隔离 Debug | 安装后隔离 Release | 判定 |
| --- | ---: | ---: | --- |
| 七状态样本数 | 140 | 140 | 1 轮预热后，20 轮 × 7 状态 |
| p50 | 1.53 ms | 1.22 ms | 记录值 |
| p95 | 6.08 ms | 5.11 ms | PASS，均低于 200 ms 目标 |
| 最大值 | 8.25 ms | 6.07 ms | 记录值 |
| 1001 条同状态 burst | 2 次 DOM marker 更新 | 2 次 DOM marker 更新 | PASS，上限为 4；最终完整事件清除了省略的 `file` |
| `idle → sleeping` | 60018.8381 ms | 60028.4089 ms | PASS，均未早于 60,000 ms；576 × 530、完整解码且无 image error |

延迟脚本使用同进程受控 Named Pipe server，在每次 JSON Lines 写入前记录 Node `performance.now()`；WebView 中的 MutationObserver 捕获气泡消息 DOM 更新，并经 CDP Runtime binding 回报 Node。该口径覆盖 Pipe 写入、Rust 消费、Tauri 事件、前端状态/文本更新和 CDP 回传，因此可视为状态文本/DOM 标记可见延迟的保守上界。Debug 证据目录 `.cache/native-windows-smoke/1784201511453-9204`，生命周期 `188.820 s`；20,196,864-byte Debug EXE 的 SHA-256 为 `33D052E6D24DB481F364AAC23BF6582784F3911377F5676ED725A42BC17836F4`。安装后 Release 证据目录 `.cache/native-windows-smoke/1784202165728-19428`。这些数据不测量 GIF 首帧像素呈现，且仅来自一台 Windows 11 x64 机器，不能外推为 macOS/Linux 性能结论。

## 2026-07-22 当前 Debug 动作与静态映射复测

当前 Debug run `.cache/native-windows-smoke/1784697111517-1268` 对 140 个七状态样本测得 p50 `1.35 ms`、p95 `5.70 ms`、max `6.68 ms`；1001 条同状态 burst 为 2 次 DOM marker 更新。`idle → sleeping` 在 `60,020.66 ms` 完整呈现为 `576 × 530`，无 image error。该 run 同时记录真实 `(96,64)` 窗口拖拽、拖拽不误触点击、独立默认时长 `clicked` 进入/恢复、悬停/拖拽动作生命周期，系统与手动 reduced-motion 下的 `idle.gif → fallback-idle.svg → idle.gif`，以及手动设置跨重启恢复。被测 Debug EXE 由当前源码完整重建，为 20,264,448 bytes，SHA-256 `BE0C7AD5499978751AC0BEA81CDA641DEA3F01C88FFCC731EF4E2B78F8AB5382`；包内交互时长/动画与静态动作映射由自动化验证，本轮仍未重测 CPU/内存，也未构建新的安装后 Release。

## 结论

- 2026-07-15 的资源采样对象为 13,074,432 bytes（约 12.47 MiB）。2026-07-16 最新当前源码的正式 Windows x64 NSIS 为 5,664,565 bytes（约 5.402 MiB），SHA-256 `EA181EFE9A93B153570AA92D893F351049492E821BED7C5064559163E79DF5DF`；隔离 NSIS 为 5,665,555 bytes（约 5.403 MiB），SHA-256 `E629E932BEB152191A46C98EC73A8F102D49FD5FD98488C1F8B343119F39E7AF`。两者满足 PRD 的“安装包不高于 20 MB”目标，Authenticode 均为 `NotSigned`。机器可读报告 `.cache/windows-installer-smoke/1784201848768-33384/installer-smoke-report.json` 记录 `currentSourceBuild=true`、`success=true`，报告生命周期 `518.730 s`，两把锁均已释放；此前 `D4B0…` / `B5F8…`、`2D4A…` / `5E93…`、`FCD4…` / `FB79…`、`BE55…` / `267D…` 与 `0291…` / `5829…` 只保留为历史。安装生命周期边界见 [`SMOKE_TEST_REPORT.md`](SMOKE_TEST_REPORT.md)。
- 主进程低于 80 MB，但不能用主进程数字代表整套应用。
- WebView2 会创建 browser、renderer、GPU 和 utility 等多个子进程。逐进程 working set 求和会重复计算共享页面，因此不是唯一内存口径；不过 private memory 同样明显高于 80 MB，当前实现不能声称达到 PRD 的完整应用内存目标。
- 前端只保留一个活动 `<img>`，没有隐藏预加载四个 GIF。当前内存差距主要来自 WebView2 基线与活动 GIF 解码，而不是四套动画同时驻留。
- 当前 animated GIF idle 的完整进程树 CPU 也高于目标；现在系统偏好或手动开关会移除活动 GIF 并显示静态资源，但尚未重新量化该模式的 CPU/内存收益。
- 当前 Windows Debug 与安装后 Release 的状态文本/DOM 标记 p95 均达到 `< 200 ms` 目标，原生 burst 合并和 60 秒睡眠切换也通过；包内按动作静态映射能力已具备，但初始角色 poster、美术授权、三平台统一性能验收与 GIF 首帧像素测量仍未完成。

## 后续优化实验

1. 为初始角色制作或取得可再分发的透明 poster，再对比内置静态 SVG、包内 poster、GIF 和 animated WebP，量化减少动态效果前后的解码成本。
2. 用 ETW/VMMap 区分共享页面、GPU 分配和私有提交，形成可重复的 release 测试脚本。
3. 在 Windows、macOS、Linux 分别记录冷启动、IPC 延迟、CPU 和内存，避免用单平台数字外推。
4. 如果完整应用 80 MB 是硬约束，单独验证 `winit/tao + softbuffer + tray-icon` 等纯原生渲染方案；这是架构变更，需与 Tauri 的开发效率、设置 UI 和跨平台维护成本一起决策。
