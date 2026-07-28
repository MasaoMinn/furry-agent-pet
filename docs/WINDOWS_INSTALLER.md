# Windows 安装包验证

更新日期：2026-07-28
验证环境：Windows 11 x64  
应用版本：0.2.0
完整测试记录：[`SMOKE_TEST_REPORT.md`](SMOKE_TEST_REPORT.md)

## 当前源码安装器验证结论

2026-07-28 已从当前 v0.2.0 源码生成正式 NSIS：`furry-agent-pet_0.2.0_x64-setup.exe`，15,653,888 bytes，SHA-256 `DAE08F6F2911FB0124622D43BE57E14DA1D33ED0C40B95011D09A87BFECEA7CD`，Authenticode `NotSigned`。对应 portable EXE 为 24,446,976 bytes，SHA-256 `83186F88E402C6E3F0AD0A3315A3EBC85D958D6ADB7A7F1FC41A720D36C29FCC`，同样未签名。正式产品继续使用 `perMachine` 与 `RequestExecutionLevel admin`，并保留安装目录选择页。

本轮 `npm run check` 通过 24/24 Vitest 文件、109/109 前端测试、57/57 Rust 测试、TypeScript、`cargo check`、`cargo fmt --check` 和 production build；随后 `npm run tauri:build:windows -- --no-sign --ci` 完成 Release 与 NSIS 构建。安装器 preflight 检测到本机已有 `D:\Apifox\furry-agent-pet` 的 v0.1.0 安装记录，按安全策略停止，因此没有覆盖现有安装，也没有把安装/卸载生命周期标记为通过。Release 链接阶段继续出现缺少 MSVC runtime PDB 的非阻断 `LNK4099`。

以下为 2026-07-16 旧名称、旧 current-user 模式的历史完整生命周期基线：

2026-07-16 在同一个受控 run 中从当时源码构建正式身份与隔离身份两个 NSIS，完成正式包安装/卸载，并对隔离包安装后的 Release 执行全量原生冒烟后卸载。报告记录 `currentSourceBuild=true`、`success=true`，但该发布基线早于当前交互动作层与 reduced-motion 静态降级；发布前需要重新构建并复验。最终原始报告位于：

```text
.cache/windows-installer-smoke/1784201848768-33384/installer-smoke-report.json
```

| 产物 | 大小 | SHA-256 | Authenticode |
| --- | ---: | --- | --- |
| `Agent Desktop Pet_0.1.0_x64-setup.exe` | 5,664,565 bytes | `EA181EFE9A93B153570AA92D893F351049492E821BED7C5064559163E79DF5DF` | `NotSigned` |
| `Agent Desktop Pet Smoke_0.1.0_x64-setup.exe` | 5,665,555 bytes | `E629E932BEB152191A46C98EC73A8F102D49FD5FD98488C1F8B343119F39E7AF` | `NotSigned` |

正式产物位于：

```text
src-tauri/target/release/bundle/nsis/Agent Desktop Pet_0.1.0_x64-setup.exe
```

这两个历史安装器都使用 NSIS `currentUser` 模式。当前正式安装器已改用 `perMachine`；隔离 smoke 身份仍保留 `currentUser`，以继续支持非管理员自动化。WebView2 配置为下载 bootstrapper；目标机器没有 WebView2 Runtime 时，安装过程需要联网。

## 可重复命令

首选命令会先执行安全预检，再从当前源码构建两个安装器并验证完整生命周期：

```bash
npm run smoke:windows:installer
```

只运行安全预检：

```bash
npm run smoke:windows:installer -- --preflight-only
```

复验磁盘上已有的安装器：

```bash
npm run smoke:windows:installer -- --skip-build
```

`--skip-build` 只能证明指定已有产物的生命周期，不能单独作为“当前源码构建”证据。正式包也可单独重新构建：

```bash
npm run tauri:build:windows -- --no-sign --ci
```

## 测试隔离与安全边界

- harness 要求非管理员运行，并在 `.cache/windows-installer-smoke/.lock` 原子获取安装器跨运行独占锁；第二个实例会在构建或安装前被拒绝，未知或陈旧锁不会自动删除。
- `smoke:windows:installer` 与 `smoke:windows:native` 还共用 `.cache/windows-desktop-interaction.lock` 原子目录锁，避免两个 run 并发操纵真实桌面、窗口或托盘。两把锁都记录 owner 元数据且不会自动清除陈旧状态；两个命令仍应串行执行。
- 预检要求正式/隔离应用均无运行进程，相关 HKCU/HKLM 注册表项、默认安装目录、快捷方式和隔离 AppData 均不存在。
- 隔离配置使用 `Agent Desktop Pet Smoke`、`io.github.masaominn.agent-desktop-pet-smoke` 和独立主程序名 `agent-desktop-pet-smoke.exe`，避免 NSIS 按进程名检查时影响正式身份。
- 每次构建后，安装器与 Release EXE 都复制为该 run 的只读证据快照；后续安装只执行该快照，避免另一次构建覆盖共享 `target/release` 输出。
- 安装使用 `/S /NS /D=<run 内隔离目录>`。`/NS` 明确抑制快捷方式，因此本轮没有验证桌面或开始菜单快捷方式的创建/删除生命周期。
- 安装后的隔离 Release 通过精确绝对路径和 SHA-256 传给 native smoke 子进程；子进程必须继承并精确验证父 run 的桌面锁 token/run ID。父进程只有在子进程退出、`cleanupSafe=true` 且没有相关 EXE/进程时才释放共享锁。
- 隔离应用只按 PID、精确 EXE 路径和进程创建时间身份终止。递归清理前检查路径 containment、普通文件树和 Windows 重解析点；无法证明安全时保留锁并失败关闭。

## 正式身份生命周期

1. `/S /NS /D=...` 安装退出码为 0；应用 EXE、卸载器、HKCU 卸载项和 manufacturer key 均存在，字段与本次安装目录精确匹配。
2. 源 Release EXE 为 14,349,312 bytes，SHA-256 为 `7F3F2E6B401017D06DAE01AFD6BFED8ABF9E87B0E73CEBE3615AD465CF55AA24`。安装后 EXE 的 SHA-256 为 `4CC8C0804EE7889374FE92467367328EC8B1E04BDFECDBBE4D7456FDFA18982A`。
3. 两个 EXE 长度相同，逐字节比较只允许 Tauri 已记录的 NSIS bundle-type 补丁：offset `11545370` 处 `__TAURI_BUNDLE_TYPE_VAR_UNK` 变为 `__TAURI_BUNDLE_TYPE_VAR_NSS`；除此之外任何差异都会使测试失败。
4. 静默安装没有启动正式应用，因此没有触碰正式身份的 Roaming 设置或 Local WebView2 数据。
5. `uninstall.exe /S` 退出码为 0；安装目录与 HKCU 卸载项消失，且没有关联进程。

## 隔离身份全量原生冒烟与卸载

1. 安装退出码为 0。源 Release EXE 为 14,349,824 bytes，SHA-256 `1ADBAF9A79F20AA393C6C8955E052A8ED48396E03C79EFA5160428A04A4DE514`；安装后大小相同、SHA-256 为 `E6DF0C4422886688C22202B334944F57912FA749199BBBB687C3E589181BAD34`，两者只存在 offset `11545914` 处预期的 Tauri NSIS marker 补丁。
2. 安装后 Release 的完整原生证据位于 `.cache/native-windows-smoke/1784202165728-19428`。七状态、四个 GIF、完成/错误气泡、首次引导和 Rust-owned 设置 v1、隐藏/唤醒、单实例、透明合成、无边框 geometry、真实 `(96,64)` 拖动、置顶 Z-order 与真实托盘命令均通过。
3. 140 个状态延迟样本为 p50 `1.22 ms`、p95 `5.11 ms`、max `6.07 ms`；1001 条 burst 合并为 2 次 DOM marker 更新。`idle` 在 `60028.4089 ms` 切换到 `sleeping.gif`，图片 `complete=true`、natural size `576 × 530` 且无 image error。
4. 隔离卸载器退出码为 0；安装目录、卸载项和相关进程均无残留，隔离 Roaming/Local AppData 与 WebView2 profile 已按受控路径清理。

## 卸载与清理责任边界

NSIS 卸载器负责删除安装目录和标准 HKCU 卸载项。`Software\github\<product>` manufacturer key 在静默卸载后由 harness 再次核验“无卸载项、无子项、默认值仍精确等于本次安装目录”后删除。隔离 AppData 和测试 WebView2 profile 也由 harness 清理；正式身份 AppData 从未进入清理范围。

最终独立复核确认：两个测试安装目录、四个相关 HKCU 注册表路径、相关应用进程、隔离 Roaming/Local AppData、安装器独占锁和共享桌面交互锁均不存在。两个安装均记录 `shortcutsSuppressed=true`。

## 与角色包运行时测试的关系

当前源码 Debug 与安装后的隔离 Release 均通过七状态/四 GIF、60 秒睡眠切换、真实托盘、两色透明合成、无边框 client geometry、真实鼠标拖动和置顶 Z-order。原生文件选择器、本地快照、源目录失效后重启、UI 删除和坏包拒绝则只在隔离 Windows Debug runtime 或自动化测试中覆盖，尚未在安装后的 Release 中重复整套本地包 UI 流程。

## 尚不满足正式发布的项目

- 当前源码安装包和可执行文件未进行 Authenticode 代码签名。
- 尚未验证升级/降级、自动更新、Windows 10、ARM64，以及安装后 Release 的本地包原生对话框/导入/源失效重启/删除/坏包 UI 拒绝。本轮使用 `/NS`，未验证快捷方式创建/删除生命周期。
- 安装后的隔离 Release 已重复桌面、托盘与七状态；正常任务栏图标不存在仍未被当前自动化单独验证，真实外部 Agent UI 客户端也未参与本轮三方端到端。
- Windows 物理多显示器拔插、负坐标布局和 100%/150%/200% 混合 DPI 仍需实机矩阵。
- 目前只在一台 Windows 11 x64 机器验证；Windows 10、ARM64 和更多硬件环境仍未验收。
- 当前 Debug 已通过系统与手动 reduced-motion 的内置静态角色切换、恢复和手动设置跨重启持久化；本安装后 Release 尚未复跑该行为。实际授权 poster、GIF 首帧像素呈现及完整应用 CPU/内存目标仍未通过；MSVC `LNK4099` 运行时 PDB 警告不阻断基线结果，但发布符号策略待补。
- 美术资源作者与再分发授权仍是 placeholder；发布清单签名和正式发布元数据尚待确认。

## 历史产物

2026-07-16 紧邻上一版 run（`.cache/windows-installer-smoke/1784195840996-35684/installer-smoke-report.json`）的正式/隔离安装器分别为 5,643,536 / 5,644,227 bytes，SHA-256 `D4B0F4CE7314A14D2F34CA4FA6469F79AEA97DD734EAF60C90945806BF45C972` / `B5F84879B9473298AC9D2929C8D02512D1380769F9566AAD6435AD39CE2448C5`。该 run 通过构建绑定与安装生命周期，但安装后 Release 只做启动/响应，已被本页 `EA181E…` / `E629E9…` 全量原生复跑取代。

2026-07-16 再早一版 run（`.cache/windows-installer-smoke/1784189544322-29404/installer-smoke-report.json`）的正式/隔离安装器分别为 5,638,246 / 5,634,468 bytes，SHA-256 `2D4AB49908C876388CCBDC9FCAA440A21EF6AA0256AB54CBBD5AA13282630240` / `5E936D0E03B916C28E0344904B20AC1A0DAD90BF36B76CBF405AEBBF7BD3FE66`。该 run 当时完成构建绑定及基础安装生命周期验证，但已被后续产物取代。

2026-07-16 更早一版 run（`.cache/windows-installer-smoke/1784186552152-13632/installer-smoke-report.json`）的正式/隔离安装器分别为 5,636,148 / 5,638,292 bytes，SHA-256 `FCD4AAE8AD62066BCA14023B7DB4B27700C1B434A110D4C15C053443F168EB0F` / `FB79F3D04594A994A12CDDEF095D6C9DBE504964FE0F2E17131CFD32B52ED2CF`。该 run 当时完成当前源码构建绑定及相同生命周期验证，但已经被后续产物取代。

2026-07-16 更早一版 run（`.cache/windows-installer-smoke/1784184804472-32532/installer-smoke-report.json`）的正式/隔离安装器分别为 5,635,890 / 5,636,072 bytes，SHA-256 `BE55E903FF934C6B4F5ACA18D8382A9C82767687FE29AE78D86EA9F946967EDB` / `267DB17AAF89CCAA1EB82C18730F106B542D2960E9A510AA0A51120F672EEC30`。该 run 当时完成当前源码构建绑定及相同生命周期验证，但已经被后续产物取代。

2026-07-16 更早 run（`.cache/windows-installer-smoke/1784180426178-11804/installer-smoke-report.json`）的正式/隔离安装器分别为 5,630,953 / 5,633,008 bytes，SHA-256 `0291E227B3C96C048A9B41FA1C73C3A0BFC22DD03849E011AACB6573902E5674` / `58290DAE701AFF1D22DE0A5C4C1E3BB86C8CCDD6364971CB50D0E220DF5C14D2`。它们早于 Rust-owned 设置后端、GIF 循环契约与 capability/CSP 收紧，只保留用于追溯。

2026-07-15 正式名安装器为 5,632,844 bytes，SHA-256 `994C2D02FC83C37E98593D602FE373D360748815B70A255720B6B14EC18A3D4C`；当日隔离安装器为 5,631,553 bytes，SHA-256 `A90237F5DE12C50A7296F7D9FC3E59FC97ECC29BD560DDD236798088FC9DC24D`。更早的正式/隔离哈希分别为 `44D21CFB18A866433EBBBF5469FF5DE664B0068EEF251E68351087BA32FFF9FE` 与 `D1926849FDEBB36646A667A1DD831A254A6C259D9D65BFDBEABF9EFC522FB0A3`。这些值只用于历史追溯，不能代表当前产物。
