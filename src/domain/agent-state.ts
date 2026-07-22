export const AGENT_STATES = [
  "idle",
  "thinking",
  "planning",
  "coding",
  "testing",
  "success",
  "error",
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export interface AgentStateEvent {
  type: "state";
  state: AgentState;
  message?: string;
  file?: string;
}

export interface StatePresentation {
  label: string;
  shortLabel: string;
}

export const MAX_EVENT_FIELD_LENGTH = 1_000;

export const STATE_PRESENTATION: Record<AgentState, StatePresentation> = {
  idle: { label: "空闲", shortLabel: "idle" },
  thinking: { label: "思考中", shortLabel: "thinking" },
  planning: { label: "规划中", shortLabel: "planning" },
  coding: { label: "编码中", shortLabel: "coding" },
  testing: { label: "测试中", shortLabel: "testing" },
  success: { label: "任务完成", shortLabel: "success" },
  error: { label: "遇到问题", shortLabel: "error" },
};

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === "string" && AGENT_STATES.includes(value as AgentState);
}

export function parseAgentStateEvent(value: unknown): AgentStateEvent | null {
  if (!isRecord(value) || value.type !== "state" || !isAgentState(value.state)) {
    return null;
  }

  const message = parseOptionalField(value, "message");
  const file = parseOptionalField(value, "file");

  if (message === null || file === null) {
    return null;
  }

  return {
    type: "state",
    state: value.state,
    ...(message === undefined ? {} : { message }),
    ...(file === undefined ? {} : { file }),
  };
}

function parseOptionalField(
  record: Record<string, unknown>,
  field: string,
): string | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    return undefined;
  }

  const value = record[field];
  if (typeof value !== "string" || Array.from(value).length > MAX_EVENT_FIELD_LENGTH) {
    return null;
  }

  return value === "" ? undefined : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
