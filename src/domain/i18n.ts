import type { AgentState } from "./agent-state";

export const APP_LANGUAGES = ["zh-CN", "en"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

const zh = {
  appDescription: "用桌宠动作和文字气泡呈现 MCP Agent 的实时状态",
  agentStatus: "Agent 状态",
  closeMessage: "关闭消息",
  petArea: "Agent 桌宠",
  dragPet: "拖动桌宠",
  fallbackPet: "桌宠备用静态图标",
  waitingMcp: "等待 MCP",
  connecting: "正在连接",
  connected: "已连接",
  disconnected: "未连接",
  disabled: "已停用",
  mcpOnline: "MCP 在线",
  openSettings: "打开设置",
  petSettings: "桌宠设置",
  dragSettings: "拖动设置窗口",
  settings: "设置",
  closeSettings: "关闭设置",
  language: "界面语言",
  chinese: "中文",
  english: "English",
  petScale: "桌宠缩放",
  opacity: "透明度",
  petPackage: "宠物资源包",
  petPackageDescription: "内置包登记 manifest 即可；本地包会先验证并复制到应用数据目录。",
  importPet: "导入 pet.json",
  removePet: "删除当前本地包",
  stateActions: "状态动作",
  stateActionsDescription: "每个状态占一行。点击状态后，在下方展开并选择其他动作。",
  actionPreview: "动作预览",
  alwaysOnTop: "总在最前",
  launchAtStartup: "开机自启",
  showBubble: "显示气泡",
  reconnect: "重新连接",
  reset: "恢复默认",
  onboarding: "接入向导",
  projectIntro: "项目介绍",
  quit: "退出应用",
  connectAgent: "连接你的 Agent",
  later: "稍后设置",
  method1: "方法 1：发送指令给代理",
  promptInstruction: "将下面这句话发送给 Codex 或其他能够编辑自身 MCP 配置的代理：",
  copyInstruction: "复制指令",
  installPromptLead: "请为当前环境安装 Furry Companion MCP：",
  addMcpConfig: "在 MCP 配置中加入：",
  restartAndVerify: "安装后请重启 Agent 会话，并验证 MCP tools 中是否出现 set_state。",
  ifFailed: "如果失败：",
  checkNode: "先确认 Node.js 和 npm 可用：",
  testPackage: "测试包能运行：",
  verifyCache: "若提示权限或网络错误，清理 npm 缓存后重试：",
  replaceOldConfig: "若 MCP 已存在，先移除旧配置再重新添加。",
  copy: "复制",
  copyHelp: "可复制完整指令，也可以单独复制每段命令或配置。",
  method2: "方法 2：手动配置 MCP",
  addServerEntry: "将 MCP 服务器条目添加到客户端配置中。",
  restartAfterConfig: "更改 MCP 配置后，请重启代理。当前代理会话通常无法热加载新添加的 MCP 工具。",
  detectingConnection: "正在检测连接",
  detectAgain: "重新检测",
  doneClose: "完成并关闭",
  taskComplete: "任务已完成",
  agentError: "Agent 遇到问题，等待下一状态或确认。",
  acknowledgeError: "确认错误并返回空闲状态",
  connectionDetails: "连接详情：{error}",
  followPackage: "跟随资源包",
  localPackage: "本地 · {name} · v{version}",
  chooseStateAction: "选择{state}状态动作，当前为{animation}",
  setStateAction: "将{state}状态设置为{action}",
  actionPreviewAlt: "{state}动作预览",
  copied: "已复制",
  copyFailed: "复制失败",
  copiedStatus: "已复制{label}。",
  copyFailedStatus: "复制失败：{error}。请手动选择对应内容复制。",
  fullInstruction: "完整指令",
  content: "内容",
  importedInvalidPackages: "已跳过 {count} 个无效资源包：{ids}",
  removeImportedTitle: "删除当前本地资源包",
  bundledCannotRemove: "内置资源包不能删除",
  importDesktopOnly: "请在桌面应用中导入本地资源包",
  importTitle: "选择并安全导入 pet.json",
  validatingPackage: "正在验证并复制资源包…",
  importCancelled: "已取消导入。",
  importedPackage: "已导入“{name}”，原始目录现在可以移动或删除。",
  deletingPackage: "正在删除“{name}”…",
  deletedPackage: "已删除“{name}”。",
  copyCodexCommand: "Codex 命令",
  copyMcpConfig: "MCP 配置",
  copyNodeCheck: "Node.js 检查命令",
  copyMcpTest: "MCP 测试命令",
  copyNpmCache: "npm 缓存命令",
  copyManualConfig: "手动 MCP 配置",
  saveTopmostFailed: "无法保存置顶设置",
  dragSettingsFailed: "无法拖动设置窗口",
  startupFailed: "无法更改开机自启",
  reconnectFailed: "无法重新连接",
  resetFailed: "无法恢复默认设置",
  openProjectFailed: "无法打开项目介绍",
  closeGuideFailed: "无法关闭接入向导",
  saveGuideFailed: "无法保存接入向导状态",
  detectFailed: "无法重新检测连接",
  dragPetFailed: "无法拖动桌宠",
  quitFailed: "无法退出应用",
  switchPackageFailed: "无法切换资源包",
  importPackageFailed: "无法导入资源包",
  removePackageFailed: "无法删除资源包",
  applySettingsFailed: "无法应用设置",
  resizePanelFailed: "无法调整侧栏窗口",
  initializeFailed: "应用初始化失败",
  startPetFailed: "无法启动桌宠",
  unknownError: "未知错误",
  pointerRegionsFailed: "无法更新鼠标捕获范围",
} as const;

export type TranslationKey = keyof typeof zh;
type Dictionary = Record<TranslationKey, string>;

const en: Dictionary = {
  appDescription: "Show live MCP Agent states through a desktop pet, animations, and speech bubbles",
  agentStatus: "Agent status",
  closeMessage: "Close message",
  petArea: "Agent desktop pet",
  dragPet: "Drag desktop pet",
  fallbackPet: "Fallback desktop pet image",
  waitingMcp: "Waiting for MCP",
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Disconnected",
  disabled: "Disabled",
  mcpOnline: "MCP online",
  openSettings: "Open settings",
  petSettings: "Desktop pet settings",
  dragSettings: "Drag settings window",
  settings: "Settings",
  closeSettings: "Close settings",
  language: "Language",
  chinese: "中文",
  english: "English",
  petScale: "Pet scale",
  opacity: "Opacity",
  petPackage: "Pet package",
  petPackageDescription: "Bundled packages use registered manifests. Local packages are validated and copied into app data.",
  importPet: "Import pet.json",
  removePet: "Remove local package",
  stateActions: "State actions",
  stateActionsDescription: "Each state fills one row. Select a state to expand its available actions below.",
  actionPreview: "Action preview",
  alwaysOnTop: "Always on top",
  launchAtStartup: "Launch at startup",
  showBubble: "Show bubbles",
  reconnect: "Reconnect",
  reset: "Reset defaults",
  onboarding: "Connection guide",
  projectIntro: "About this project",
  quit: "Quit app",
  connectAgent: "Connect your Agent",
  later: "Set up later",
  method1: "Method 1: Send instructions to your Agent",
  promptInstruction: "Send the following prompt to Codex or another Agent that can edit its own MCP configuration:",
  copyInstruction: "Copy prompt",
  installPromptLead: "Install Furry Companion MCP in the current environment:",
  addMcpConfig: "Add this to the MCP configuration:",
  restartAndVerify: "After installation, restart the Agent session and verify that set_state appears in the MCP tools.",
  ifFailed: "If it fails:",
  checkNode: "Confirm that Node.js and npm are available:",
  testPackage: "Test that the package runs:",
  verifyCache: "For permission or network errors, verify the npm cache and retry:",
  replaceOldConfig: "If the MCP entry already exists, remove the old configuration before adding it again.",
  copy: "Copy",
  copyHelp: "Copy the full prompt, or copy any command or configuration block separately.",
  method2: "Method 2: Configure MCP manually",
  addServerEntry: "Add the MCP server entry to your client configuration.",
  restartAfterConfig: "Restart the Agent after changing MCP configuration. The current session usually cannot hot-load newly added MCP tools.",
  detectingConnection: "Detecting connection",
  detectAgain: "Check again",
  doneClose: "Done and close",
  taskComplete: "Task completed",
  agentError: "The Agent encountered a problem. Waiting for the next state or acknowledgement.",
  acknowledgeError: "Acknowledge error and return to idle",
  connectionDetails: "Connection details: {error}",
  followPackage: "Use package default",
  localPackage: "Local · {name} · v{version}",
  chooseStateAction: "Choose the action for {state}; current action: {animation}",
  setStateAction: "Set {state} to {action}",
  actionPreviewAlt: "{state} action preview",
  copied: "Copied",
  copyFailed: "Copy failed",
  copiedStatus: "Copied {label}.",
  copyFailedStatus: "Copy failed: {error}. Select the corresponding content and copy it manually.",
  fullInstruction: "the full prompt",
  content: "content",
  importedInvalidPackages: "Skipped {count} invalid pet package(s): {ids}",
  removeImportedTitle: "Remove the current local package",
  bundledCannotRemove: "Bundled packages cannot be removed",
  importDesktopOnly: "Local packages can only be imported in the desktop app",
  importTitle: "Select and safely import pet.json",
  validatingPackage: "Validating and copying the pet package…",
  importCancelled: "Import cancelled.",
  importedPackage: "Imported “{name}”. The source folder can now be moved or deleted.",
  deletingPackage: "Removing “{name}”…",
  deletedPackage: "Removed “{name}”.",
  copyCodexCommand: "Codex command",
  copyMcpConfig: "MCP configuration",
  copyNodeCheck: "Node.js check command",
  copyMcpTest: "MCP test command",
  copyNpmCache: "npm cache command",
  copyManualConfig: "manual MCP configuration",
  saveTopmostFailed: "Could not save the always-on-top setting",
  dragSettingsFailed: "Could not drag the settings window",
  startupFailed: "Could not change launch at startup",
  reconnectFailed: "Could not reconnect",
  resetFailed: "Could not reset settings",
  openProjectFailed: "Could not open the project page",
  closeGuideFailed: "Could not close the connection guide",
  saveGuideFailed: "Could not save the connection guide state",
  detectFailed: "Could not check the connection again",
  dragPetFailed: "Could not drag the desktop pet",
  quitFailed: "Could not quit the app",
  switchPackageFailed: "Could not switch pet packages",
  importPackageFailed: "Could not import the pet package",
  removePackageFailed: "Could not remove the pet package",
  applySettingsFailed: "Could not apply settings",
  resizePanelFailed: "Could not resize the side panel",
  initializeFailed: "App initialization failed",
  startPetFailed: "Could not start the desktop pet",
  unknownError: "Unknown error",
  pointerRegionsFailed: "Could not update the pointer capture area",
};

const dictionaries: Record<AppLanguage, Dictionary> = { "zh-CN": zh, en };

export function normalizeLanguage(value: unknown): AppLanguage {
  return value === "en" ? "en" : "zh-CN";
}

export function translate(
  language: AppLanguage,
  key: TranslationKey,
  parameters: Record<string, string | number> = {},
): string {
  return Object.entries(parameters).reduce(
    (message, [name, value]) => message.split(`{${name}}`).join(String(value)),
    dictionaries[language][key],
  );
}

const stateLabels: Record<AppLanguage, Record<AgentState, string>> = {
  "zh-CN": {
    idle: "空闲",
    thinking: "思考中",
    planning: "规划中",
    coding: "编码中",
    testing: "测试中",
    success: "任务完成",
    error: "遇到问题",
  },
  en: {
    idle: "Idle",
    thinking: "Thinking",
    planning: "Planning",
    coding: "Coding",
    testing: "Testing",
    success: "Completed",
    error: "Problem",
  },
};

export function stateLabel(language: AppLanguage, state: AgentState): string {
  return stateLabels[language][state];
}

export function agentConnectionPrompt(language: AppLanguage): string {
  const config = `{
  "mcpServers": {
    "furry_companion": {
      "command": "npx",
      "args": ["-y", "furry-companion-mcp"]
    }
  }
}`;
  if (language === "en") {
    return `Install Furry Companion MCP in the current environment:

Codex:
codex mcp add furry_companion -- npx -y furry-companion-mcp

Cursor / Claude Desktop:
Add this to the MCP configuration:
${config}

After installation, restart the Agent session and verify that set_state appears in the MCP tools.

If it fails:
1. Confirm that Node.js and npm are available: node -v && npm -v
2. Test that the package runs: npx -y furry-companion-mcp
3. For permission or network errors, verify the npm cache and retry: npm cache verify
4. If the MCP entry already exists, remove the old configuration before adding it again.`;
  }
  return `请为当前环境安装 Furry Companion MCP：

Codex:
codex mcp add furry_companion -- npx -y furry-companion-mcp

Cursor / Claude Desktop:
在 MCP 配置中加入：
${config}

安装后请重启 Agent 会话，并验证 MCP tools 中是否出现 set_state。

如果失败：
1. 先确认 Node.js 和 npm 可用：node -v && npm -v
2. 测试包能运行：npx -y furry-companion-mcp
3. 若提示权限或网络错误，清理 npm 缓存后重试：npm cache verify
4. 若 MCP 已存在，先移除旧配置再重新添加。`;
}
