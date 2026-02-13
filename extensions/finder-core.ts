import events from "node:events";

import { Type } from "@sinclair/typebox";

export const DEFAULT_MAX_TURNS = 6;
export const MAX_TOOL_CALLS_TO_KEEP = 80;

const DEFAULT_EVENTTARGET_MAX_LISTENERS = 100;
const EVENTTARGET_MAX_LISTENERS_STATE_KEY = Symbol.for("pi.eventTargetMaxListenersState");

type EventTargetMaxListenersState = { depth: number; savedDefault?: number };

export type FinderStatus = "running" | "done" | "error" | "aborted";

export type ToolCall = {
  id: string;
  name: string;
  args: unknown;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
};

export interface FinderRunDetails {
  status: FinderStatus;
  query: string;
  turns: number;
  toolCalls: ToolCall[];
  summaryText?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface SubagentSelectionInfo {
  authMode: "oauth" | "api-key";
  authSource: "runtime" | "api_key" | "oauth" | "env" | "fallback" | "none";
  reason: string;
}

export interface FinderDetails {
  status: FinderStatus;
  workspace?: string;
  subagentProvider?: string;
  subagentModelId?: string;
  subagentSelection?: SubagentSelectionInfo;
  runs: FinderRunDetails[];
}

export const FinderParams = Type.Object({
  query: Type.String({
    description: [
      "Describe what to find in the workspace (code + personal files).",
      "Include: (1) specific goal, (2) optional scope hints if known (paths/directories), (3) search hints (keywords/identifiers/filenames/extensions/metadata clues), (4) desired output type (paths, line ranges, directory structure, metadata), (5) what counts as 'found'.",
      "Finder uses rg/fd/ls and read — do not request grep or find.",
      "Examples:",
      "- Code: 'Find where user authentication is implemented. Search under src/auth and src/api for login/auth/authenticate, and return entrypoint + token handling with line ranges.'",
      "- Personal: 'In ~/Documents and ~/Desktop, find my latest trip itinerary PDF and list the top candidate paths with evidence.'",
    ].join("\n"),
  }),
});

function getEventTargetMaxListenersState(): EventTargetMaxListenersState {
  const g = globalThis as any;
  if (!g[EVENTTARGET_MAX_LISTENERS_STATE_KEY]) g[EVENTTARGET_MAX_LISTENERS_STATE_KEY] = { depth: 0 };
  return g[EVENTTARGET_MAX_LISTENERS_STATE_KEY] as EventTargetMaxListenersState;
}

export function bumpDefaultEventTargetMaxListeners(): () => void {
  const state = getEventTargetMaxListenersState();

  const raw = process.env.PI_EVENTTARGET_MAX_LISTENERS ?? process.env.PI_ABORT_MAX_LISTENERS;
  const desired = raw !== undefined ? Number(raw) : DEFAULT_EVENTTARGET_MAX_LISTENERS;
  if (!Number.isFinite(desired) || desired < 0) return () => { };

  if (state.depth === 0) state.savedDefault = events.defaultMaxListeners;
  state.depth += 1;

  if (events.defaultMaxListeners < desired) events.setMaxListeners(desired);

  return () => {
    state.depth = Math.max(0, state.depth - 1);
    if (state.depth !== 0) return;
    if (state.savedDefault === undefined) return;

    events.setMaxListeners(state.savedDefault);
    state.savedDefault = undefined;
  };
}

export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function getLastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const parts = msg.content;
    if (!Array.isArray(parts)) continue;

    const blocks: string[] = [];
    for (const part of parts) {
      if (part?.type === "text" && typeof part.text === "string") blocks.push(part.text);
    }

    if (blocks.length > 0) return blocks.join("");
  }
  return "";
}

export function computeOverallStatus(runs: FinderRunDetails[]): FinderStatus {
  if (runs.some((r) => r.status === "running")) return "running";
  if (runs.some((r) => r.status === "error")) return "error";
  if (runs.every((r) => r.status === "aborted")) return "aborted";
  return "done";
}

export function renderCombinedMarkdown(runs: FinderRunDetails[]): string {
  const r = runs[0];
  return (r.summaryText ?? (r.status === "running" ? "(searching...)" : "(no output)")).trim();
}

export function formatToolCall(call: ToolCall): string {
  const args = call.args && typeof call.args === "object" ? (call.args as Record<string, any>) : undefined;

  if (call.name === "read") {
    const p = typeof args?.path === "string" ? args.path : "";
    const offset = typeof args?.offset === "number" ? args.offset : undefined;
    const limit = typeof args?.limit === "number" ? args.limit : undefined;
    const range = offset || limit ? `:${offset ?? 1}${limit ? `-${(offset ?? 1) + limit - 1}` : ""}` : "";
    return `read ${p}${range}`;
  }

  if (call.name === "bash") {
    const command = typeof args?.command === "string" ? args.command : "";
    const timeout = typeof args?.timeout === "number" ? args.timeout : undefined;
    const normalized = command.replace(/\s+/g, " ").trim();
    const suffix = timeout ? ` (timeout ${timeout}s)` : "";
    return `bash ${shorten(normalized, 120)}${suffix}`.trimEnd();
  }

  return call.name;
}
