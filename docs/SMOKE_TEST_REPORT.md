# Windows 冒烟测试报告

- **2026-07-31 宠物透明像素命中遮罩完整基线**：宠物命中范围从完整图片矩形改为当前图像 alpha 的 10 px 网格条带，可见像素周围保留一格余量；无法读取像素的自定义资源使用收缩后备区。4/4 定向 Vitest、TypeScript、production build、Rust check/fmt 通过。由于用户普通 Debug 实例正在运行并锁定默认构建产物，本轮在 `.cache/native-mask-target` 完整隔离构建 30,905,856-byte smoke EXE，再复制到未占用的 smoke 路径执行 `--skip-build`；产品源码在构建与运行间未变化。run `.cache/native-windows-smoke/1785483027630-11528` 为 `success=true`、`cleanupSafe=true`，真实点击/拖动/爱心与悬停生命周期通过；七状态延迟 140 样本 p50 `5.08 ms` / p95 `13.92 ms` / max `16.00 ms`，1001 事件收敛为 2 次 DOM mutation，`sleeping.gif` 于 `60,060.59 ms` 激活，透明合成、设置、开机自启、托盘、重启与清理全部通过。

- **2026-07-29 透明区域命中范围与边缘收紧完整基线**：当前源码隔离 Debug run `.cache/native-windows-smoke/1785312588253-35044` 为 `success=true`、`cleanupSafe=true`，使用 30,863,872-byte EXE，SHA-256 `AE860EEF5E0BB18BDC62D384651E41F35822CB5896F39A550F934E2D19B81ECB`。Windows 顶层窗口使用动态物理交互矩形处理 `WM_NCHITTEST`，透明空白返回 `HTTRANSPARENT`；原生拖拽期间临时暂停穿透，`WM_MOUSELEAVE` 负责在指针直接离开窗口时结束前端悬停。设置/向导关闭时只捕获宠物、状态条、可见气泡和错误提示，面板打开时临时捕获整窗以保留面板外点击关闭。真实点击、三颗爱心与 650 ms 恢复通过，真实拖动无误触。完整套件还通过七状态、140 样本延迟 p50 `1.15 ms` / p95 `9.47 ms` / max `10.65 ms`、1001 事件到 2 次 DOM mutation、`sleeping.gif` 于 `60,062.67 ms` 激活、边缘约束、透明合成、设置/中英文切换、开机自启、真实托盘六项、重启持久化和隔离清理。`npm run check` 通过 26/26 Vitest 文件、121/121 前端测试、64/64 Rust 测试、TypeScript/Rust 检查、Rust 格式和 production build。下层第三方窗口实际收到穿透点击尚未由独立原生计数器自动断言，需保留一次人工点击确认。

- **2026-07-29 边缘停靠与中英文切换验证**：全套检查通过 25/25 Vitest 文件、118/118 前端测试、62/62 Rust 测试、TypeScript/Rust 检查、Rust 格式和 production build；随后根据实机反馈把边缘策略收紧为“仅透明留白按 DPI 最多越界 36 个逻辑像素”，宠物可视主体与控制区保持在工作区，11/11 窗口定向测试再次通过。设置与 i18n 单测覆盖语言规范化、Store schema、状态/气泡/接入提示词翻译。当前源码已在 `.cache/native-click-target` 重建隔离 Debug EXE。原生套件 run `.cache/native-windows-smoke/1785306181294-28200`、`1785306234365-24224`、`1785306339048-30308` 以及收紧后的 `1785307254272-2780` 均在进入本次新增边缘/语言断言前，因 Windows 拒绝输入探针恢复鼠标坐标的 `SetCursorPos` 调用而安全停止；均未产生产品断言失败且 `cleanupSafe=true`。因此本轮没有新的真实桌面通过结论，需在允许桌面输入的会话中复跑。

- **2026-07-29 拖拽边界与真实点击爱心定向证据**：窗口约束 10/10 Rust 测试、点击控制器 7/7 定向 Vitest、Rust/TypeScript 检查、production build 和脚本语法检查通过。当前源码在不终止用户普通 Debug 实例的前提下使用 `.cache/native-click-target` 完整重建隔离 Debug EXE；随后 run `.cache/native-windows-smoke/1785304253938-33612/desktop-integration.json` 使用真实 Win32 鼠标输入而非 DOM `.click()`。单击记录 `releasedWithinTimeout=true`、指针位移 `(0,0)`、`recognizedAsClick=true`，进入 `clicked`，三颗爱心的 computed animation name 均为 `click-heart-float`，650 ms 后恢复；真实 `(96,64)` 拖动历史没有 `clicked`。同一 run 把窗口拖向左上外沿后约束为 `0,0–648,762`，完整处于工作区。该 run 之后在托盘 UI Automation 查询遇到 `RPC_E_SERVERFAULT`，最终 `success=false`、`cleanupSafe=true`；因此本条作为本次窗口和真实点击段的有效证据，不替代既有完整成功基线。

最近测试日期：2026-07-29
应用版本：0.2.0
结论：**2026-07-28 Windows 隔离 Debug 已从当前源码完整重建并通过七状态预设资源替换、状态专属候选限制、包内静态 reduced-motion，以及既有窗口、托盘、开机自启、持久化、性能和 60 秒睡眠套件。2026-07-16 的安装后 Release 仍是历史基线，不代表本轮资源与候选限制功能。**

该结论只适用于下述 Windows 11 x64 环境，不包含物理多屏与混合 DPI、Windows 10/ARM64、升级/降级、快捷方式生命周期、代码签名或正式发布验收。

## 证据边界

- **2026-07-28 v0.2.0 Release/NSIS 构建证据**：`npm run check` 通过 24/24 Vitest 文件、109/109 前端测试、57/57 Rust 测试、TypeScript、`cargo check`、`cargo fmt --check` 和 production build；最终的面板外点击关闭补丁另通过 7/7 定向测试、前端检查、production build 与 native-smoke 脚本语法检查。`npm run tauri:build:windows -- --no-sign --ci` 生成 24,446,976-byte portable EXE（SHA-256 `83186F88E402C6E3F0AD0A3315A3EBC85D958D6ADB7A7F1FC41A720D36C29FCC`）与 15,653,888-byte NSIS（SHA-256 `DAE08F6F2911FB0124622D43BE57E14DA1D33ED0C40B95011D09A87BFECEA7CD`），两者均为 `NotSigned`。installer preflight 因检测到本机已有 v0.1.0 正式安装记录而失败关闭，没有触碰用户安装；因此这里只声明构建和静态产物校验通过，不声明 v0.2.0 安装/卸载生命周期通过。
- **2026-07-28 七状态预设资源与状态专属选择权威基线**：`npm run check` 通过 19/19 Vitest 文件、94/94 前端测试、57/57 Rust 测试、TypeScript、`cargo check`、`cargo fmt --check` 和 production build。当前源码完整重建 run `.cache/native-windows-smoke/1785220817686-16956` 使用 30,294,016-byte Debug EXE，SHA-256 `0DB8A51193DC3E3CAC8E9835363647D6086B2F4AC83A2C92457A3DC25B759212`；`run-result.json` 为 `success=true`、`cleanupSafe=true`。真实 catalog 包含七状态 22 个逻辑预设和 13 份唯一媒体，整包为 13,036,029 bytes / 89,244,857 解码像素；coding 行恰有 3 个本状态候选，跨状态 `error-2` 不在 DOM，未 hover/聚焦的 `coding-2` 候选生成 132 px 宽 PNG 首帧，选择后实时播放 `coding-2.gif`，恢复后回到默认 `coding.gif`。系统 reduced-motion 把 `idle.gif` 替换为包内 `idle-static.png` 且无动画，恢复后回到 `idle.gif`。完整套件同时通过七状态、140 样本 p50 `1.47 ms` / p95 `10.44 ms` / max `13.04 ms`、1001 条事件到 2 次 DOM marker、`sleeping.gif` 于 `60,045.80 ms` 激活，以及真实窗口、拖拽、托盘、设置、开机自启、重启持久化与隔离清理。
- **2026-07-28 整行与行内展开定向证据**：`npm run check` 通过 19/19 Vitest 文件、93/93 前端测试、56/56 Rust 测试、TypeScript、`cargo check`、`cargo fmt --check` 和 production build。当前源码完整重建 20,403,200-byte Debug EXE（SHA-256 `1B467A6F03CF59013ACBC18FCCD63CCAE0149A9C3AF3D0934C0CF2DA8FB71D76`）；`.cache/native-windows-smoke/1785211873195-29520/tray-integration.json` 记录七个状态项各自占满动作区宽度，coding 点击后在原行下展开 5 张候选卡。未 hover、未聚焦的 `exhausted.gif` 候选已生成完整 130 × 120 PNG 首帧，选中后唯一实时预览切换为 `exhausted.gif`，恢复默认后回到 `coding.gif` 且选择区保持展开。该 run 后续在 60 秒 idle 计时器调度探针超时；两次 `--skip-build` 复跑分别在托盘“重新连接”和“恢复默认位置”阶段发现外部鼠标移动，按安全策略中止。三次均 `cleanupSafe=true`，因此只把前述新 UI 行为列为定向通过，不声明新的全量成功基线。
- **2026-07-28 状态/候选动作卡片与空白关闭权威基线**：当前源码完整重建后，以同一 20,402,688-byte Debug EXE（SHA-256 `DE24572A6D12E309B56D12F138E19C1F28FF5290B61ACCAADD25AE6C939B080A`）成功复跑 `.cache/native-windows-smoke/1785210990332-27432`；产品源码未在重建与 `--skip-build` 成功 run 之间变化，`success=true`、`cleanupSafe=true`。真实 WebView2 显示七张状态卡，coding 候选页有 5 张预览卡；`exhausted.gif` 在候选聚焦与选中后总览均完整加载，恢复默认后显示 `coding.gif`。设置内部和宠物点击保持面板打开，宠物周围空白点击关闭并可重新打开。完整套件同时通过七状态、140 样本 p50 `1.17 ms` / p95 `2.79 ms` / max `3.51 ms`、1001 条事件到 2 次 DOM marker、`sleeping.gif` 于 `60,055.18 ms` 激活、真实托盘、拖动、重启持久化和隔离清理。`npm run check` 通过 18/18 Vitest 文件、90/90 前端测试和 56/56 Rust 测试。
- **2026-07-27 v0.1.1 定向证据**：`npm run check` 通过 17/17 Vitest 文件、84/84 前端测试、56/56 Rust 测试、TypeScript、`cargo check`、`cargo fmt --check` 与 Vite production build。Windows WebView2 原生流程实际通过固定 15 秒 success 气泡关闭及悬停回看、旧时长控件不存在、9 字段 Store，以及动作预览从 coding 默认动作切换到 `exhausted.gif` 后恢复 `coding.gif`；同一流程的后续完整托盘阶段两次检测到外部鼠标移动并按安全策略中止，因此本轮不声明新的全量原生成功 run。v0.1.1 NSIS 为 5,781,877 bytes、SHA-256 `0BCEB9BF192A4A95E53A665E3DA0C0C3823BA0166CFC97E7FD9F3925CA39BFB0`，Authenticode `NotSigned`，尚未执行 UAC 安装/卸载。
- **2026-07-27 当前 Windows Debug 权威基线**：成功 run `.cache/native-windows-smoke/1785137435175-5396` 使用 20,404,224-byte EXE，SHA-256 `CBE158124FABDFDAB948E2BFBAC71CF670FE0F069E11FAD4D5157D7B440D720E`；`run-result.json` 为 `success=true`、`cleanupSafe=true`。该 EXE 由紧邻的完整源码重建生成，成功复跑使用 `--skip-build`；产品源码未在两者之间变化。140 个状态样本 p50 `1.54 ms`、p95 `5.58 ms`、max `6.17 ms`，1001 条 burst 收敛为 2 次 DOM marker 更新，`sleeping.gif` 在 `60,057.38 ms` 激活。
- **2026-07-27 右侧边缘/开机自启/会话标题证据**：原生鼠标把桌宠拖到工作区右缘 48 px 后，从托盘打开设置得到 `panelPlacement=left`；面板区域 `[0,320]`、桌宠区域 `[328,760]` 均完整位于 760 px WebView 内，原生窗口完整位于当前工作区。设置标题栏请求/实际位移均为 `(-72,48)`，关闭左侧面板后窗口由 `1140 × 762` 收回为 `648 × 762`，保持拖动后的桌宠右缘锚点。隔离注册表值 `furry-agent-pet Smoke` 被真实启用到当前 EXE 后再禁用且无残留；Store 为 10 字段 schema。最终 success 气泡显示会话标题“IPC 演示会话”。
- **2026-07-27 当前质量检查**：`npm run check` 通过 17/17 Vitest 文件、84/84 前端测试、57/57 Rust 测试，同时通过 TypeScript、`cargo check`、`cargo fmt --check` 与 Vite production build。Windows 原生套件还通过七状态、错误确认、success 详情回放、透明合成、置顶 Z-order、真实桌宠/设置拖拽、托盘六项操作、隐藏重启、单实例唤醒和隔离清理。
- **2026-07-22 状态栏设置入口定向证据**：当前源码完整重建 run `.cache/native-windows-smoke/1784702542343-32532` 通过真实 WebView 鼠标移动验证：设置按钮位于 `.state-chip` 内，悬停桌宠时 `opacity=1`、`visibility=visible`、可见宽度 `21.04 px`，移出后恢复隐藏；同一 run 还验证系统 reduced-motion 下 `success` 静态后备的 `animationName=none`。桌面、拖拽、点击与合成证据已写入 `desktop-integration.json`。该 run 随后因 Windows 任务栏 UI Automation 未能为 PID 绑定图标恢复唯一身份而停止，`success=false`、`cleanupSafe=true`；这不替代下方完整成功基线，也不把未运行的后续阶段标记为通过。
- **2026-07-22 当前设置/向导权威 Debug 基线**：完整重建 run `.cache/native-windows-smoke/1784700645750-31408` 使用 20,262,400-byte Debug EXE，SHA-256 `32E0E77C241427B61398338C1F50929449EF66EC776F628B36B5F8452D47D548`；`run-result.json` 为 `success=true`、`cleanupSafe=true`。设置原生证据记录桌宠区域 `[0,432]`、设置区域 `[432,752]`，两者边界相接而不重叠；设置内容从 `scrollTop=0` 滚到 `119.33` 后关闭按钮四边坐标完全不变；四个退役控件均不在 DOM。向导证据确认焦点落在复制按钮、复制文本与可见提示词逐字相同、完成后 Store 版本为 2。140 个状态延迟样本 p50 `1.28 ms`、p95 `5.33 ms`、max `6.79 ms`，1001 条 burst 收敛为 2 次 DOM marker 更新，`sleeping.gif` 在 `60,054.87 ms` 激活。
- **2026-07-22 当时质量检查**：实际执行 `npm run check`，15/15 Vitest 文件、75/75 前端测试与 57/57 Rust 测试通过，同时通过 TypeScript、`cargo check`、`cargo fmt --check` 和 Vite production build。当时 Store schema 为 9 个字段；当前 schema 见 2026-07-27 基线。
- **2026-07-22 设置标题栏拖拽定向证据**：当前源码完整重建 run `.cache/native-windows-smoke/1784698822731-25624` 通过真实托盘打开设置和原生鼠标拖拽，标题栏请求/实际位移均为 `(72,48)`，窗口保持 `648 × 762`、面板保持打开且关闭按钮仍可用；该 run 后续因旧的 60 秒探针在状态已自动回到 `idle` 时重复发送 `idle` 而超时，`cleanupSafe=true`。脚本已先切换 `thinking` 再开始延迟验证，避免把“重复状态不重置计时”的产品行为误判为失败。随后复跑分别受到桌面像素采样超时与外部鼠标位移干扰，均安全清理，因此本轮不把完整原生套件标记为新成功基线。
- **2026-07-22 当前 Release 产物**：因用户选择的 `D:\Apifox` 目录仅允许管理员写入，正式产品已统一更名为 `furry-agent-pet`，并从当前源码重新执行 `npm run check` 与 `npm run tauri:build:windows -- --no-sign --ci`。生成的 NSIS 明确记录 `PRODUCTNAME/MAINBINARYNAME=furry-agent-pet`、`INSTALLMODE=perMachine`、`RequestExecutionLevel admin`、FAS `INSTALLERICON`，并包含 `MUI_PAGE_DIRECTORY` 安装目录选择页。Portable EXE 为 14,361,088 bytes、SHA-256 `55987FD890CDDFF6513FD6601F2B3B3FE6DFAB4A92495718998386C557B64EA0`，NSIS 为 5,766,250 bytes、SHA-256 `81D40108AFF885D99DEBF37C7B31C434B322790B1ADFD46CD398FA06E413DDAF`，Authenticode 均为 `NotSigned`。安装器安全预检通过；尚未替用户确认 UAC，也未执行本轮完整安装/卸载与安装后 Release 套件，不替代历史安装后基线。
- **2026-07-22 最新完整成功 Debug 基线**：run `.cache/native-windows-smoke/1784697111517-1268` 从当前源码完整构建 20,264,448-byte Debug EXE，SHA-256 `BE0C7AD5499978751AC0BEA81CDA641DEA3F01C88FFCC731EF4E2B78F8AB5382`；`run-result.json` 为 `success=true`、`cleanupSafe=true`。完整 `npm run check` 为 14/14 Vitest 文件、74/74 前端测试、57/57 Rust 测试。
- **2026-07-22 托盘探针瞬时失败**：紧邻成功 run 之前的 `.cache/native-windows-smoke/1784697035277-13764` 已完整重建同一源码，但 Windows 11 托盘溢出面板的旧矩形没有对应到当前 UIA 按钮而在首次 inspect 失败；`success=false`、`cleanupSafe=true`。未改代码或放宽断言，随后完整重建复跑通过全部真实托盘操作，因此失败 run 只作为环境波动记录，不是产品基线。
- **2026-07-22 早期点击证据**：`.cache/native-windows-smoke/1784695859664-13908` 首次证明点击动作可见，但真实拖拽后由 WebView 合成了一次点击，因此不作为当前产品基线。当前 run 新增严格断言并确认拖拽动作历史没有 `clicked`。
- **2026-07-22 早期交互证据**：`.cache/native-windows-smoke/1784691034202-5652` 是拖拽层首个全量成功基线；`.cache/native-windows-smoke/1784691792829-33228` 提供悬停/拖拽嵌套定向证据但后来在托盘 UIA 阶段停止。两者均已被上一条更完整的当前源码成功 run 取代，仅保留历史追溯。
- **2026-07-16 历史 Debug**：当时的 `npm run smoke:windows:native` 完整重建并验证 20,196,864-byte Debug EXE，SHA-256 `33D052E6D24DB481F364AAC23BF6582784F3911377F5676ED725A42BC17836F4`。权威目录为 `.cache/native-windows-smoke/1784201511453-9204`，证据生命周期 `188.820 s`，`success=true`、`cleanupSafe=true`。
- **2026-07-16 安装器/安装后 Release 基线**：当时的 `npm run smoke:windows:installer` 从同一份源码构建正式/隔离 Release EXE 与 NSIS。权威报告 `.cache/windows-installer-smoke/1784201848768-33384/installer-smoke-report.json` 记录 `currentSourceBuild=true`、`success=true`，生命周期 `518.730 s`，两把锁均释放；安装后的隔离 Release 在 `.cache/native-windows-smoke/1784202165728-19428` 中完整复跑当时套件。该基线早于当前交互层和 reduced-motion 静态降级。
- **2026-07-16 历史安装器基线**：紧邻上一版正式/隔离 NSIS 为 `D4B0…` / `B5F8…`，更早版本包括 `2D4A…` / `5E93…`、`FCD4…` / `FB79…`、`BE55…` / `267D…` 与 `0291…` / `5829…`。它们都不再代表当前源码产物，只保留用于历史追溯。
- **2026-07-15 交互基线**：本地角色包导入/快照/重启/GIF/UI 删除和完全离屏恢复。这些真实 UI 步骤来自隔离 Debug runtime，尚未在当前安装后的 Release 中逐项重复。

## 2026-07-22 可扩展交互动作结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| manifest 交互扩展 | PASS | TypeScript 与 Rust 均接受可选 `interactions`，限制为 32 项、安全 ID、动画引用必须存在；空对象保持既有包兼容。 |
| 系统与手动减少动态效果 | PASS | `reduced-motion-integration.json` 分别记录系统和手动请求的 `idle.gif / hovering-bob → fallback-idle.svg / none → idle.gif / hovering-bob`；手动关闭不能覆盖系统请求。 |
| 手动设置持久化 | PASS | 设置页写入 `reduceMotion=true` 后退出，Rust Store 的 12 字段 schema 保留该值；重启后复选框、有效偏好和 `fallback-idle.svg` 同时恢复。 |
| 包内静态动作映射 | PASS（自动化） | TypeScript 渲染器验证映射静态 WebP 与原 GIF 恢复；Rust 验证 GIF 源、非循环 PNG/WebP 目标，并确认目标随内容寻址快照安装、源目录失效后仍可重载。初始四 GIF 包映射为空，因此本轮真实 WebView 使用统一静态后备。 |
| 包内交互与 CSS 后备互斥 | PASS（自动化） | 专用 `dragging` 映射只解析包内动画且 `fallbackEffectId=null`；未映射的 `clicked` 保持状态动画并解析 `clicked` 后备。初始四 GIF 包的 `interactions` 为空，因此真实 WebView 使用 CSS 路径。 |
| 一次性交互时长 | PASS（自动化） | `durationMs` 在 TypeScript/Rust 中都限制为 100–60,000 ms；省略时使用触发器默认值。覆盖上下边界、非整数/越界拒绝、camelCase 序列化、前端时长解析，以及删除源目录后从受管快照重载 1,250 ms 元数据。 |
| 悬停/拖拽嵌套生命周期 | PASS | `desktop-integration.json` 记录 `hovering/hovering-bob → dragging/dragging-float → hovering/hovering-bob → 无交互`；真实拖拽 requested/observed 均为 `(96,64)`，且这段历史没有 `clicked`。 |
| 有界点击动作 | PASS | 独立点击进入 `clicked/clicked-pop`，650 ms 后恢复为无交互；单测覆盖精确结束边界、重复触发只刷新计时、恢复低优先级动作、无效时长，以及 300 ms 手势边界与 `detail=0` 键盘点击。 |
| 七状态/四 GIF 兼容 | PASS | 七状态映射全部渲染，无 image error；外部源、`public/` 与 `dist/` 的四个 GIF 大小和 SHA-256 逐一相同。 |
| 延迟 sleeping | PASS | `idle` 的 60,000ms 定时器注册，`sleeping.gif` 在 `60,020.66 ms` 完整呈现，natural size `576 × 530`。 |
| 原生状态延迟 | PASS | 140 样本 p50 `1.35 ms`、p95 `5.70 ms`、max `6.68 ms`，低于 200ms 目标。 |
| 高频 burst | PASS | 1001 条 `coding` 事件收敛为 2 次 DOM marker 更新，上限为 4。 |
| 桌面与托盘 | PASS | 透明合成、topmost Z-order、无边框 client geometry、六项托盘命令、隐藏/重启/单实例和退出均通过。 |
| 隔离清理 | PASS | 无测试进程、Roaming/Local AppData、native/installer 锁残留。 |

除明确标注为自动化的包内映射与自定义时长外，表中结果均来自完整重建 run `.cache/native-windows-smoke/1784697111517-1268`，没有使用 `--skip-build`，也没有放宽拖拽、托盘或其他产品断言。

首次拖拽复测分别发现像素级容差和注入手势时序会产生假阴性，因此探针改为方向/距离/轨迹一致性断言、240ms 按下保持、16 段移动和最多三次有界重试；每次尝试都记录起点与实际位移。成功气泡测试也显式结束悬停、焦点和文本选区，避免测试机真实鼠标位置暂停计时。这些改动提高测试确定性，不放宽“窗口必须真实移动”和“动作必须进入再退出”的产品断言。

## 测试环境

- Microsoft Windows 11 家庭中文版，x64，版本 `10.0.26200`（Build 26200）
- AMD64，15.7 GiB 物理内存
- Node.js `v24.15.0`
- npm `11.12.1`
- 当前显示器实测范围 `2560 × 1600`，窗口恢复基线目标缩放系数为 1.5

## 2026-07-16 历史源码结果

| 测试项 | 结果 | 关键证据 |
| --- | --- | --- |
| 当前源码完整质量检查 | PASS | 实际执行完整 `npm run check`：TypeScript 类型检查；9/9 Vitest 文件、51/51 前端测试；53/53 Rust 测试；`cargo check`；`cargo fmt --check`；Vite production build。随后单独通过严格 `cargo clippy --all-targets --all-features -- -D warnings` |
| npm 依赖审计 | PASS | `npm audit --audit-level=moderate` 返回 `found 0 vulnerabilities` |
| 发布版 MCP→IPC | PASS | 本轮运行 `npm run smoke:mcp:published -- --runtime .cache/runtime-e2e/node_modules/furry-companion-mcp/dist/index.js`，耗时约 `5.6 s`；`furry-companion-mcp 0.2.0` 完成 MCP `initialize`、`tools/list`、`set_state`，隔离 Named Pipe 收到 `idle`、`coding` 和带原文结束语的 `success` |
| 当前源码 Tauri Debug | PASS | 本轮运行 `npm run smoke:windows:native` 并完成完整重建；20,196,864-byte 隔离 Debug EXE 的 SHA-256 为 `33D052E6D24DB481F364AAC23BF6582784F3911377F5676ED725A42BC17836F4` |
| Windows NSIS 基线 | PASS | 报告从 `2026-07-16T11:37:28.769Z` 到 `2026-07-16T11:46:07.499Z`，生命周期 `518.730 s`，`success=true` 且两把锁均释放。正式/隔离安装器 SHA-256 分别为 `EA181EFE9A93B153570AA92D893F351049492E821BED7C5064559163E79DF5DF` / `E629E932BEB152191A46C98EC73A8F102D49FD5FD98488C1F8B343119F39E7AF` |
| Debug 原生冒烟 | PASS | 证据生命周期 `188.820 s`；目录 `.cache/native-windows-smoke/1784201511453-9204`，`run-result.json` 记录 `success=true`、`cleanupSafe=true` |
| 安装后 Release 全量原生冒烟 | PASS | 目录 `.cache/native-windows-smoke/1784202165728-19428`；复跑七状态、四 GIF、首次引导/设置 v1、窗口/桌面/托盘、延迟、burst 和 60 秒睡眠切换，并由安装器 harness 完成卸载与零残留检查 |
| 原生协议与 UI | PASS | WebView2 CDP 精确观察 `idle`、`thinking`、`planning`、`coding`、`testing`、`error`、`success`；分片、粘包、空行、CRLF、坏 JSON、未知状态之后仍显示后续合法状态，fatal error 保持隐藏 |
| 原生状态延迟 | PASS | 均为 1 轮预热后 20 轮 × 7 状态、140 个样本。Debug p50 `1.53 ms`、p95 `6.08 ms`、max `8.25 ms`；安装后 Release p50 `1.22 ms`、p95 `5.11 ms`、max `6.07 ms`，均满足 `< 200 ms` 目标 |
| 错误与详情交互 | PASS | `error` 气泡保持可见且使用 `role=alert`，确认后仅在本地回到 `idle`；最终 `success` 原文气泡自动隐藏后，鼠标 `pointerenter` 可重新打开同一详情 |
| success 气泡 | PASS | DOM 精确匹配结束语“桌宠的状态演示已经完成，现在可以查看任务结束气泡了。”，气泡在 `success` 时可见 |
| 气泡交互自动化 | PASS | 覆盖 error 不自动消失及确认、file-only、悬停/焦点/选择文本暂停、交互中替换消息保持暂停，以及手动关闭 success 后同一事件不被重新打开 |
| 高频状态归一化与原生 burst | PASS | Rust 覆盖 50 ms leading/trailing 窗口和 1000 条 burst；原生脚本以一次 Pipe 写入发送 1001 条 `coding`，只出现 2 次 DOM marker 更新，首条完整 `file` 可见，最终完整事件可清空省略的 `file` |
| 60 秒睡眠变体 | PASS | Debug 在 `60018.8381 ms`、安装后 Release 在 `60028.4089 ms` 观察到 `sleeping.gif`；两者均 `complete=true`、natural size `576 × 530`、无 image error，且未早于 60,000 ms 激活 |
| Rust-owned 设置持久化 | PASS | 通过真实 WebView 把缩放改为 125%、透明度改为 80%、success 时长改为 3 秒，并修改文件路径显示、置顶与减少动态效果；退出后校验 Rust-owned Tauri Store 的 12 字段磁盘 schema，重启后控件恢复相同值，前端未建立第二种持久化格式 |
| 真实托盘菜单与动态状态 | PASS | Debug 与安装后 Release 均绑定精确进程托盘图标并验证“连接状态：已连接”及“显示/隐藏桌宠、恢复默认位置、总在最前、设置、重新连接、退出”六项命令；左右键显示/隐藏、位置恢复、隐藏时打开设置、置顶同步、手动重连使客户端计数递增、断线状态及隐藏窗口菜单退出码 0 均通过。图标 UIA accessible name 包含连接状态；机器可读证据为各 run 的 `tray-integration.json` |
| 应用退出与可见性闭环 | PASS | 精确匹配主进程 PID 与窗口标题后发送 `WM_CLOSE`，窗口隐藏但进程继续；退出码 0 并写入 `main.visible=false`，重启后保持隐藏，第二实例退出码 0 且唤醒原实例；最终退出写入 `main.visible=true` |
| Runtime 退出与自动重连 | PASS | Runtime 退出后 UI 转为 `disconnected` 且应用未崩溃；在已累计退避档位的情况下，同一 Pipe 恢复后自动回到 `connected`，未点击手动重连且低于 30 秒上限 |
| 原生窗口响应 | PASS | 按主进程 PID 枚举到标题为 `Agent Desktop Pet` 的窗口；`IsWindowVisible=True`、`IsHungAppWindow=False` |
| 透明合成与无边框 geometry | PASS | 在两个不同纯色原生背景窗口上，透明点逐 RGB 精确等于各自背景色，opaque 探针两次均保持 `(246,196,46)`；client bounds 与 window bounds 完全一致，以几何结果而非兼容 style bit 判定无边框 |
| 真实拖动与置顶 Z-order | PASS | Win32 鼠标事件请求 `(96,64)`，原生窗口 bounds 实测也移动 `(96,64)`；置顶启用时目标在背景探针之上且 Z-order 比较为 `-1`，通过真实设置关闭置顶后变为背景之下且比较为 `1` |
| 单实例 | PASS | 第二实例在 5 秒内以退出码 0 结束；主实例 PID 不变，精确 EXE 路径仍只有一个进程 |
| 隔离清理 | PASS | Win32/托盘探针只接受精确 PID、窗口与菜单项，并回收受控背景窗口；本轮 Debug 测试应用、mock Runtime、CDP 端口、隔离 Roaming/Local AppData 和 WebView2 profile 均无残留，共享桌面交互锁已释放。当前源码 NSIS run 的两个安装目录、相关注册表项、进程、隔离 AppData/Profile、安装器锁和共享桌面交互锁也全部完成受控清理 |

功能阶段使用 `mock-agent-ipc.mjs --protocol-test --demo --client-delay 3000` 发送全部七种状态和异常协议片段。性能阶段切换为脚本内受控 Named Pipe server，在每次写入前记录 Node `performance.now()`，由页面 MutationObserver 捕获气泡消息的 DOM 更新，再通过 CDP Runtime binding 回报 Node。这个口径包含 Pipe、Rust、Tauri 事件、前端 DOM 更新与 CDP 回传，是状态文本/标记可见延迟的保守上界；它不等同于 GIF 首帧完成解码或呈现的像素级时间。

非阻塞观察：Windows MSVC 链接阶段报告运行时 PDB 缺失的 `LNK4099` 警告；Debug/Release 产物均成功构建并通过上述运行测试，因此不判为代码或运行失败。正式发布仍应补齐可发布的调试符号策略。

## 执行命令

本轮当前源码实际执行：

```powershell
npm run check
node scripts/native-command.mjs cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm audit --audit-level=moderate
npm run smoke:mcp:published -- --runtime .cache/runtime-e2e/node_modules/furry-companion-mcp/dist/index.js
npm run smoke:windows:native
npm run smoke:windows:installer
```

Debug 原生证据生命周期为 `188.820 s`，目录 `.cache/native-windows-smoke/1784201511453-9204`；安装器报告生命周期为 `518.730 s`，最终报告 `.cache/windows-installer-smoke/1784201848768-33384/installer-smoke-report.json`，其中安装后 Release 子 run 为 `.cache/native-windows-smoke/1784202165728-19428`。以下是可重复的完整仓库命令集合，不表示本轮再次执行了每一条：

```powershell
npm run check
npm audit --audit-level=moderate
npm run smoke:mcp:published -- --runtime .cache/runtime-e2e/node_modules/furry-companion-mcp/dist/index.js
npm run smoke:windows:native
npm run smoke:windows:installer
```

`npm run smoke:windows:native` 会先以隔离配置构建 Debug EXE；已有最新构建时可附加 `-- --skip-build`。脚本使用隔离身份 `Agent Desktop Pet Smoke` / `io.github.masaominn.agent-desktop-pet-smoke`、每次唯一 Named Pipe、随机 CDP 端口和工作区内临时 WebView2 profile，并覆盖功能、延迟、burst、隐藏持久化、重启与第二实例唤醒。Win32 探针进一步用精确 PID/标题定位窗口，创建两种受控纯色背景，采样屏幕像素、检查 Z-order 与 client geometry，并注入真实鼠标拖动；结果落到 `desktop-integration.json`。真实托盘探针只在已解锁的 Default input desktop、Explorer 同会话、输入修饰键与鼠标键均释放的前提下，用精确 PID 所属托盘图标、唯一 popup 与精确菜单项执行输入；它验证状态/六项命令、左右键显示隐藏、恢复位置、设置、置顶、重连与退出，结果落到 `tray-integration.json`。脚本只操作本次跟踪的 PID、精确匹配的窗口/菜单和经过绝对路径校验的 smoke 数据；发现歧义、用户移动鼠标、同名未跟踪进程或预先存在的 smoke AppData 时会失败关闭并拒绝越界清理。

`npm run smoke:windows:installer` 要求非管理员运行，原子获取安装器冒烟锁，并与 `smoke:windows:native` 共用 `.cache/windows-desktop-interaction.lock`；任一锁已存在时都会在构建或桌面操作前失败关闭。脚本为正式与隔离构建保存安装器/Release EXE 证据快照，使用 `/S /NS /D=...` 安装到 run 内，并对安装后的隔离 Release 调用全量 native smoke；子进程必须继承并精确验证父 run 的锁 token/run ID，只有成功退出且证明清理安全后父锁才会释放。卸载后再验证进程、注册表、安装目录、AppData/Profile 与两把锁零残留。`--preflight-only` 只做预检，`--skip-build` 只证明已有产物生命周期。

## 2026-07-16 已验证的修复

- Window State 现在保存 `POSITION | VISIBLE`。启动时只恢复位置，再按已保存的 `main.visible` 决定显示或隐藏；没有状态的首次启动显示窗口，托盘不可用时强制显示，避免应用不可达。
- Tauri `Err<String>`、JavaScript `Error` 和安全的 `{ message }` 对象统一转换为单行、最多 512 字符的用户可见错误，不再把原生字符串拒绝降级成“应用初始化失败”。
- IPC 连接成功后立即 EOF 不再无条件把重连退避重置为 1 秒；只有收到合法事件或连接稳定至少 30 秒才重置，短命连接保持 1、2、4、8、16、30 秒的有界退避。
- 高频合并期间，Rust 最多每秒刷新一次连接诊断的最近事件时间；恢复中的协议诊断会立即刷新，避免持续输入时状态页显示陈旧时间，又不会把 50 ms 合并重新放大成事件洪泛。
- Rust 对同一非终态的高频事件采用 50 ms leading/trailing 合并，只保留窗口内最后一个完整事件；状态变化及 `success`/`error` 立即发送。断线前刷新待发送事件，遇到较新的协议错误前也先按线序刷新更早的合法事件。
- IPC→UI 发布路径现在使用最大 64 项的有界队列、尾部合并和 generation 隔离；切换设置或重连后会清除旧 generation 积压，主线程在派发前再次拒绝已退役 generation，并保证锁内不调用 Tauri/UI，从而避免旧 reader 覆盖新连接状态及无界积压。
- 前端收到重复同状态时仍更新 `message`/`file`，但不重置入场动画、idle 延迟变体或 success 返回 idle 的计时。
- 气泡支持鼠标悬停、键盘焦点和文本选择时暂停；仅有 `file` 时也可显示；关闭“显示文件路径”会保留正常消息气泡，并立即关闭只含文件路径的空壳气泡。错误气泡不会自动关闭，确认只清除本地错误展示，不向 MCP Runtime 回写状态。
- 设置页提供显式退出入口，并与托盘共用固定退出码 0 的 Rust 路径。本轮已验证可见退出保存 `main.visible=true`，以及 `WM_CLOSE` 隐藏、隐藏退出保存 `false`、重启保持隐藏、第二实例唤醒、最终保存 `true` 的完整闭环。
- 设置持久化由 Rust command 统一规范化并写入 Tauri Store。本轮从真实 WebView 修改设置，验证磁盘上的 12 字段 schema，并在重启后确认缩放、透明度、success 时长、文件路径显示、置顶和 `reduceMotion=true` 全部恢复。
- 桌宠拖动入口移除了与显式 `startDragging()` 重叠的 HTML drag region，只保留单一路径，消除了同一次鼠标输入触发双重原生拖动的竞态；冒烟同时把拖动判定强化为“请求位移与原生 bounds 位移在容差内一致”，本轮为精确 `(96,64)`。
- 原生冒烟新增透明合成、client geometry 和实际 Z-order 断言；探针与背景窗口清理也覆盖正常/失败路径，避免辅助窗口或进程污染后续 run。
- 托盘菜单首项现在随连接快照显示“正在连接 / 已连接 / 未连接 / 已停用”，同一文本同步进入图标 tooltip；真实托盘探针在 Windows 11 Debug 与安装后 Release 验证了 `已连接` / `未连接`、六项命令及其效果。`正在连接` / `已停用` 映射由 Rust 单元测试覆盖。
- 两个 Windows smoke 现在共用原子目录形式的桌面交互锁；所有者元数据、符号链接/普通文件拒绝和不自动清除陈旧锁的策略避免两个 run 并发注入桌面输入。

## 2026-07-16 角色资源与交互基线

首批四个 GIF 来自用户提供的 `furry-ai-state/animation`。本轮逐字节确认外部源、`public/` 与 `dist/` 三份完全一致：

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `coding.gif` | 812,642 bytes | `47736BEB18B2013983449FA5B1B45768D390B9E8DD85741CA7AC4EEADCFAD795` |
| `exhausted.gif` | 900,194 bytes | `102118E45E01F83531E4FC98EC1243904ACCD0FB4E9ACF34F61563446BACB4D5` |
| `idle.gif` | 734,301 bytes | `9AFFB3C702AFFD8873A361CF871760C1085BA852C36C9E6132CEE60051BB83BB` |
| `sleeping.gif` | 737,547 bytes | `EF57DCB29EFCE92DA8C67B0F4579C5ABEB9FCD652094CCD89D36D8B20AE5DC16` |

当前兼容映射为 `idle/thinking/planning/success → idle.gif`、`coding/testing → coding.gif`、`error → exhausted.gif`，以及 `idle → sleeping.gif @ 60000 ms`。本轮 Debug 与安装后 Release 分别在 `60018.8381 ms` / `60028.4089 ms` 实际观察到 576 × 530、完整解码且无 image error 的睡眠图。此前隔离 Debug 原生对话框导入后，AppData 中的 `pet.json` 与全部唯一媒体逐项存在且哈希相同；源目录改名后重启仍从快照播放 GIF，UI 删除后回退内置包。该导入/删除整套流程本轮未在安装后 Release 重复。资源作者与再分发许可仍为 placeholder，不能据此发布美术资源。

## 2026-07-16 Windows NSIS 基线结果

权威原始报告：

```text
.cache/windows-installer-smoke/1784201848768-33384/installer-smoke-report.json
```

报告从 `2026-07-16T11:37:28.769Z` 运行到 `2026-07-16T11:46:07.499Z`，生命周期 `518.730 s`；记录 `currentSourceBuild=true`、`success=true`，安装器锁与共享桌面交互锁均 `released=true`。

- 正式安装器为 5,664,565 bytes，SHA-256 `EA181EFE9A93B153570AA92D893F351049492E821BED7C5064559163E79DF5DF`，Authenticode `NotSigned`。同次构建的源 Release EXE 为 14,349,312 bytes，SHA-256 `7F3F2E6B401017D06DAE01AFD6BFED8ABF9E87B0E73CEBE3615AD465CF55AA24`；安装后 EXE 的 SHA-256 为 `4CC8C0804EE7889374FE92467367328EC8B1E04BDFECDBBE4D7456FDFA18982A`。逐字节绑定只允许 offset `11545370` 处的 Tauri NSIS bundle-type marker 补丁。
- 正式身份 `/S /NS /D=...` 安装与卸载退出码均为 0。静默安装没有启动正式应用；卸载后安装目录、卸载项与相关进程均无残留。
- 隔离安装器为 5,665,555 bytes，SHA-256 `E629E932BEB152191A46C98EC73A8F102D49FD5FD98488C1F8B343119F39E7AF`，Authenticode `NotSigned`。同次构建的源 Release EXE 为 14,349,824 bytes，SHA-256 `1ADBAF9A79F20AA393C6C8955E052A8ED48396E03C79EFA5160428A04A4DE514`；安装后 EXE 大小相同、SHA-256 为 `E6DF0C4422886688C22202B334944F57912FA749199BBBB687C3E589181BAD34`。逐字节绑定只允许 offset `11545914` 处的同类 marker 补丁。
- 隔离身份安装后执行完整原生子 run `.cache/native-windows-smoke/1784202165728-19428`：七状态、四 GIF、首次引导/设置 v1、窗口/桌面/托盘、140 样本延迟、1001→2 burst 与 `60028.4089 ms` 睡眠切换全部通过。
- 两种身份的安装/卸载退出码均为 0，且 `shortcutsSuppressed=true`；最终没有相关进程、注册表项、安装目录、隔离 AppData/Profile 或锁残留。

## 2026-07-16 历史 Windows NSIS 基线

以下安装器 run 当时通过生命周期验证，**不代表当前源码安装包**；当前源码证据以上一节的新 run 为准。

紧邻上一版当前源码报告：

```text
.cache/windows-installer-smoke/1784195840996-35684/installer-smoke-report.json
```

- 正式/隔离安装器分别为 5,643,536 / 5,644,227 bytes，SHA-256 `D4B0F4CE7314A14D2F34CA4FA6469F79AEA97DD734EAF60C90945806BF45C972` / `B5F84879B9473298AC9D2929C8D02512D1380769F9566AAD6435AD39CE2448C5`，Authenticode 均为 `NotSigned`。
- 该 run 当时通过构建绑定及安装生命周期，但安装后 Release 只验证启动/窗口响应，已由本轮 `EA181E…` / `E629E9…` 的全量原生复跑取代。

再早一版当前源码报告：

```text
.cache/windows-installer-smoke/1784189544322-29404/installer-smoke-report.json
```

- 正式/隔离安装器分别为 5,638,246 / 5,634,468 bytes，SHA-256 `2D4AB49908C876388CCBDC9FCAA440A21EF6AA0256AB54CBBD5AA13282630240` / `5E936D0E03B916C28E0344904B20AC1A0DAD90BF36B76CBF405AEBBF7BD3FE66`，Authenticode 均为 `NotSigned`。
- 该 run 当时完成当前源码构建绑定、正式安装/卸载和隔离安装后启动/窗口响应/卸载，但已被后续产物取代。

更早一版当前源码报告：

```text
.cache/windows-installer-smoke/1784186552152-13632/installer-smoke-report.json
```

- 正式/隔离安装器分别为 5,636,148 / 5,638,292 bytes，SHA-256 `FCD4AAE8AD62066BCA14023B7DB4B27700C1B434A110D4C15C053443F168EB0F` / `FB79F3D04594A994A12CDDEF095D6C9DBE504964FE0F2E17131CFD32B52ED2CF`，Authenticode 均为 `NotSigned`。
- 该 run 当时完成当前源码构建绑定、正式安装/卸载和隔离安装后启动/窗口响应/卸载，但已被后续产物取代。

更早一版当前源码报告：

```text
.cache/windows-installer-smoke/1784184804472-32532/installer-smoke-report.json
```

- 正式/隔离安装器分别为 5,635,890 / 5,636,072 bytes，SHA-256 `BE55E903FF934C6B4F5ACA18D8382A9C82767687FE29AE78D86EA9F946967EDB` / `267DB17AAF89CCAA1EB82C18730F106B542D2960E9A510AA0A51120F672EEC30`，Authenticode 均为 `NotSigned`。
- 该 run 当时完成当前源码构建绑定、正式安装/卸载和隔离安装后启动/窗口响应/卸载，但已被后续产物取代。

更早的安装器报告：

```text
.cache/windows-installer-smoke/1784180426178-11804/installer-smoke-report.json
```

- 正式安装器为 5,630,953 bytes（约 5.370 MiB），SHA-256 `0291E227B3C96C048A9B41FA1C73C3A0BFC22DD03849E011AACB6573902E5674`，Authenticode `NotSigned`。`/S /NS /D=...` 安装与卸载退出码均为 0；静默安装没有启动正式身份，也未触碰正式 AppData。
- 隔离安装器为 5,633,008 bytes（约 5.372 MiB），SHA-256 `58290DAE701AFF1D22DE0A5C4C1E3BB86C8CCDD6364971CB50D0E220DF5C14D2`，Authenticode `NotSigned`。安装后 `agent-desktop-pet-smoke.exe` 从精确路径启动，`Responding=true`、窗口可见、非挂起，边界 `(203, 203, 563, 643)`，并响应 `WM_NULL`。
- 两个已安装 EXE 都与同次构建快照逐字节绑定；唯一允许差异是 Tauri 把 `__TAURI_BUNDLE_TYPE_VAR_UNK` 补丁为 `__TAURI_BUNDLE_TYPE_VAR_NSS`。除此之外的差异会使测试失败。
- 两次卸载后，安装目录和标准 HKCU 卸载项由 NSIS 删除；manufacturer key 由 harness 在无卸载项、无子项且路径仍精确匹配后删除。隔离 AppData/Profile 由 harness 清理，正式 AppData 从未进入清理范围。
- 最终独立复核未发现相关进程、安装目录、四个 HKCU 路径、隔离 AppData 或锁。`/NS` 抑制了快捷方式，因此本轮没有验证快捷方式创建/删除。

2026-07-15 的历史正式/隔离安装器哈希分别为 `994C2D02FC83C37E98593D602FE373D360748815B70A255720B6B14EC18A3D4C` 与 `A90237F5DE12C50A7296F7D9FC3E59FC97ECC29BD560DDD236798088FC9DC24D`，只用于追溯，不代表当前产物。

## 尚未覆盖与发布阻塞项

- 当前源码安装包与历史安装包均未签名。升级/降级、自动更新、Windows 10/ARM64，以及安装后 Release 的本地包原生对话框、导入、源目录失效后重启、删除和坏包 UI 拒绝尚未验证；本轮使用 `/NS`，因此也未验证快捷方式创建/删除。
- Windows 物理多显示器拔插、负坐标布局、100%/150%/200% 混合 DPI 仍需实机矩阵。
- `error` 确认和悬停详情已有原生 CDP 证据；选择气泡文本暂停和 file-only 详情目前只有 Vitest 自动化证据，仍缺对应原生逐项交互冒烟。
- 当前源码 Windows 11 x64 Debug 已操作真实托盘图标与六项菜单命令，并真实观察 `已连接` / `未连接`；`正在连接` / `已停用` 仅由 Rust 映射单元测试覆盖。tooltip 证据是绑定图标的 UIA accessible name 包含状态文本，不是视觉像素级 tooltip 断言；正常任务栏图标不存在也未被本轮自动化单独验证。
- 安装后的隔离 Release 已重复真实托盘、透明合成、always-on-top Z-order、无边框 geometry、真实拖动、七状态、设置/首次引导与睡眠变体；尚未重复的主要 UI 范围是本地包导入/删除/坏包拒绝。正式产品身份没有被启动，以避免触碰用户数据。
- Windows Debug 已有状态文本/DOM 标记 P95 与原生 burst 证据，但尚未测量 GIF 首帧像素呈现，也未形成覆盖目标 Windows 版本与架构的 CPU、内存、启动耗时和状态延迟统一脚本。
- 路径穿越、超限、伪装或损坏角色包已有 Rust/TypeScript 自动化覆盖，但尚未通过原生文件对话框逐项做 UI 拒绝冒烟。
- 发布版 `furry-companion-mcp` 到 Named Pipe 已通过，但仍缺安装后桌宠与真实外部 Agent UI 客户端的一次完整三方端到端验收。
- 正式发布还缺 Windows 代码签名、美术再分发授权、自动更新、升级/降级和发布元数据。
- Windows WebView2 完整进程树的稳态内存与 animated GIF idle CPU 仍高于 PRD 性能目标；系统与手动 reduced-motion 的内置静态角色切换、手动设置跨重启恢复和包内按动作映射能力已通过，但切换前后 CPU/内存、初始角色的实际授权 poster、GIF 首帧像素与 Windows 目标矩阵性能脚本仍未验证。
- MSVC 链接报告缺少运行时 PDB 的 `LNK4099`，不影响本轮构建与运行结果，但发布符号策略仍需处理。

## 判定

本轮可以确认“**2026-07-22 当前 Debug 源码在这台 Windows 11 x64 机器上完整通过 MCP/IPC、七状态/四 GIF、可扩展交互动作、`clicked` 有界反馈与拖拽不误触点击、系统与手动 reduced-motion 静态降级/恢复、手动设置跨重启恢复、错误与完成气泡、设置/首次引导、140 样本延迟、1001→2 burst、60 秒睡眠切换、窗口/桌面/托盘与安全清理；包内交互/静态动作映射通过自动化验证**”。2026-07-16 安装后隔离 Release 和 NSIS 生命周期仍是上一发布基线，不包含本轮动作层和静态降级。它不是代码签名、快捷方式/任务栏图标、完整本地包 Release UI、真实外部 Agent UI、初始角色授权 poster、统一性能或 Windows 正式发布完成；发布判断仍必须绑定具体产物与目标 Windows 环境实机结果。
