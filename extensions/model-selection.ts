import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { shorten, type FinderRunDetails, type SubagentSelectionInfo } from "./finder-core";

export const VALID_OVERRIDE_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

const MODEL_TEMP_UNAVAILABLE_TTL_QUOTA_MS = 30 * 60 * 1000;
const MODEL_TEMP_UNAVAILABLE_TTL_ERROR_MS = 10 * 60 * 1000;

type FinderModelOverrideEntry = {
  provider: string;
  modelId: string;
  thinkingLevel: FinderOverrideThinkingLevel;
  tokenIndex: number;
};

export type FinderModelSelectionPlan = {
  overrides: FinderModelOverrideEntry[];
  nextOverrideIndex: number;
  fallbackModel: FinderSubagentModel | undefined;
  fallbackConsumed: boolean;
  envConfigured: boolean;
};

export type FinderOverrideThinkingLevel = (typeof VALID_OVERRIDE_THINKING_LEVELS)[number];
export type FinderSubagentModel = NonNullable<ExtensionContext["model"]>;
export type FinderModelUnavailableReason = "quota" | "error";

export type FinderSubagentModelSelection = {
  model: FinderSubagentModel;
  thinkingLevel?: FinderOverrideThinkingLevel;
} & SubagentSelectionInfo;

export type FinderAttemptFailure = {
  modelLabel: string;
  reason: FinderModelUnavailableReason;
  message: string;
};

const temporarilyUnavailableModels = new Map<string, { untilMs: number; reason: FinderModelUnavailableReason }>();

function normalizeModelKey(provider: string, modelId: string): string {
  return `${provider.trim().toLowerCase()}/${modelId.trim().toLowerCase()}`;
}

function getTemporarilyUnavailableState(provider: string, modelId: string) {
  const key = normalizeModelKey(provider, modelId);
  const state = temporarilyUnavailableModels.get(key);
  if (!state) return undefined;
  if (state.untilMs > Date.now()) return state;

  temporarilyUnavailableModels.delete(key);
  return undefined;
}

export function markModelTemporarilyUnavailable(model: FinderSubagentModel, reason: FinderModelUnavailableReason): void {
  const ttlMs = reason === "quota" ? MODEL_TEMP_UNAVAILABLE_TTL_QUOTA_MS : MODEL_TEMP_UNAVAILABLE_TTL_ERROR_MS;
  temporarilyUnavailableModels.set(normalizeModelKey(model.provider, model.id), {
    reason,
    untilMs: Date.now() + ttlMs,
  });
}

function parseFinderModelToken(
  rawValue: string,
  tokenIndex: number,
):
  | { value: { provider: string; modelId: string; thinkingLevel: FinderOverrideThinkingLevel } }
  | { error: string } {
  const value = rawValue.trim();
  if (!value) {
    return {
      error: `Invalid PI_FINDER_MODELS token #${tokenIndex}: empty token. Remove it or provide "provider/model:thinking".`,
    };
  }

  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return {
      error:
        `Invalid PI_FINDER_MODELS token #${tokenIndex} "${rawValue}". Expected format "provider/model:thinking" ` +
        `where thinking is one of: ${VALID_OVERRIDE_THINKING_LEVELS.join(", ")}.`,
    };
  }

  const provider = value.slice(0, slashIndex).trim();
  const modelWithThinking = value.slice(slashIndex + 1).trim();
  const thinkingSeparator = modelWithThinking.lastIndexOf(":");

  if (thinkingSeparator <= 0 || thinkingSeparator === modelWithThinking.length - 1) {
    return {
      error:
        `Invalid PI_FINDER_MODELS token #${tokenIndex} "${rawValue}". Expected format "provider/model:thinking" ` +
        `where thinking is one of: ${VALID_OVERRIDE_THINKING_LEVELS.join(", ")}.`,
    };
  }

  const modelId = modelWithThinking.slice(0, thinkingSeparator).trim();
  const thinking = modelWithThinking.slice(thinkingSeparator + 1).trim().toLowerCase();

  if (!provider || !modelId) {
    return {
      error:
        `Invalid PI_FINDER_MODELS token #${tokenIndex} "${rawValue}". Provider/model must be non-empty and use ` +
        `"provider/model:thinking" format.`,
    };
  }

  if (!VALID_OVERRIDE_THINKING_LEVELS.includes(thinking as FinderOverrideThinkingLevel)) {
    return {
      error:
        `Invalid PI_FINDER_MODELS token #${tokenIndex} "${rawValue}": unsupported thinking level "${thinking}". ` +
        `Valid values: ${VALID_OVERRIDE_THINKING_LEVELS.join(", ")}.`,
    };
  }

  return {
    value: {
      provider,
      modelId,
      thinkingLevel: thinking as FinderOverrideThinkingLevel,
    },
  };
}

function parseFinderModelOverrides(rawEnvValue: string | undefined):
  | { value: FinderModelOverrideEntry[]; envConfigured: boolean }
  | { error: string } {
  if (rawEnvValue === undefined || rawEnvValue.trim() === "") {
    return { value: [], envConfigured: false };
  }

  const entries: FinderModelOverrideEntry[] = [];
  const tokens = rawEnvValue.split(",");

  for (let i = 0; i < tokens.length; i++) {
    const tokenIndex = i + 1;
    const token = tokens[i].trim();
    if (!token) continue;

    const parsed = parseFinderModelToken(token, tokenIndex);
    if ("error" in parsed) return { error: parsed.error };

    entries.push({
      tokenIndex,
      provider: parsed.value.provider,
      modelId: parsed.value.modelId,
      thinkingLevel: parsed.value.thinkingLevel,
    });
  }

  return {
    value: entries,
    envConfigured: true,
  };
}

function matchAvailableModel(
  availableModels: FinderSubagentModel[],
  provider: string,
  modelId: string,
): FinderSubagentModel | undefined {
  const providerNorm = provider.toLowerCase();
  const modelIdNorm = modelId.toLowerCase();
  return availableModels.find(
    (candidate) => candidate.provider.toLowerCase() === providerNorm && candidate.id.toLowerCase() === modelIdNorm,
  );
}

export function createFinderModelSelectionPlan(
  currentModel: ExtensionContext["model"],
): { plan: FinderModelSelectionPlan | null; error?: string } {
  const parsedOverrides = parseFinderModelOverrides(process.env.PI_FINDER_MODELS);
  if ("error" in parsedOverrides) return { plan: null, error: parsedOverrides.error };

  return {
    plan: {
      overrides: parsedOverrides.value,
      nextOverrideIndex: 0,
      fallbackModel: currentModel ?? undefined,
      fallbackConsumed: false,
      envConfigured: parsedOverrides.envConfigured,
    },
  };
}

export function getNextFinderSubagentModel(
  plan: FinderModelSelectionPlan,
  modelRegistry: ExtensionContext["modelRegistry"],
): FinderSubagentModelSelection | null {
  const availableModels = modelRegistry.getAvailable() as FinderSubagentModel[];

  while (plan.nextOverrideIndex < plan.overrides.length) {
    const entry = plan.overrides[plan.nextOverrideIndex++];
    const matched = matchAvailableModel(availableModels, entry.provider, entry.modelId);
    if (!matched) continue;
    if (getTemporarilyUnavailableState(matched.provider, matched.id)) continue;

    return {
      model: matched,
      thinkingLevel: entry.thinkingLevel,
      reason: `PI_FINDER_MODELS token #${entry.tokenIndex}: ${matched.provider}/${matched.id}:${entry.thinkingLevel}`,
    };
  }

  if (plan.fallbackConsumed) return null;
  plan.fallbackConsumed = true;

  if (!plan.fallbackModel) return null;

  const fallbackMatched = matchAvailableModel(availableModels, plan.fallbackModel.provider, plan.fallbackModel.id);
  if (!fallbackMatched) return null;
  if (getTemporarilyUnavailableState(fallbackMatched.provider, fallbackMatched.id)) return null;

  const source = plan.envConfigured
    ? "ctx.model fallback after PI_FINDER_MODELS filtering"
    : "ctx.model fallback (PI_FINDER_MODELS unset/blank)";

  return {
    model: fallbackMatched,
    reason: `${source}: ${fallbackMatched.provider}/${fallbackMatched.id}`,
  };
}

export function buildNoCandidateError(plan: FinderModelSelectionPlan): string {
  if (!plan.fallbackModel && plan.envConfigured) {
    return (
      "No model candidates available after PI_FINDER_MODELS filtering, and ctx.model fallback is undefined. " +
      "Configure at least one available model or set credentials so ctx.model is available."
    );
  }

  if (!plan.fallbackModel) {
    return "No models available: PI_FINDER_MODELS is unset/blank and ctx.model fallback is undefined.";
  }

  return (
    "No model candidates available after PI_FINDER_MODELS filtering. " +
    "ctx.model fallback was unavailable or temporarily unavailable."
  );
}

export function modelLabel(selection: FinderSubagentModelSelection): string {
  const base = `${selection.model.provider}/${selection.model.id}`;
  return selection.thinkingLevel ? `${base}:${selection.thinkingLevel}` : base;
}

export function formatFinalFailureMessage(failures: FinderAttemptFailure[]): string {
  if (failures.length === 0) return "Finder failed: no model attempts were executed.";
  const summary = failures
    .map((failure, index) => `${index + 1}) ${failure.modelLabel} [${failure.reason}] ${shorten(failure.message, 120)}`)
    .join("; ");

  return `Finder failed after ${failures.length} model attempt${failures.length === 1 ? "" : "s"}: ${summary}`;
}

export function isQuotaError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("quota") ||
    msg.includes("429") ||
    msg.includes("insufficient_quota") ||
    msg.includes("exceeded your current quota") ||
    msg.includes("out of credits") ||
    msg.includes("billing")
  );
}

export function looksLikeSilentModelFailure(r: FinderRunDetails): boolean {
  return r.status === "done" && r.toolCalls.length === 0 && (!r.summaryText || r.summaryText === "(no output)");
}

export function isAbortLikeError(error: unknown): boolean {
  if (error && typeof error === "object" && "name" in error && (error as any).name === "AbortError") return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes("aborted") || msg.includes("cancelled") || msg.includes("canceled");
}
