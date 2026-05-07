import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  getAgentDir,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

import {
  FinderParams,
  MAX_TOOL_CALLS_TO_KEEP,
  bumpDefaultEventTargetMaxListeners,
  computeOverallStatus,
  formatToolCall,
  getLastAssistantText,
  renderCombinedMarkdown,
  shorten,
  type FinderDetails,
  type FinderRunDetails,
  type SubagentSelectionInfo,
} from "./finder-core";
import { buildFinderSystemPrompt, buildFinderUserPrompt } from "./finder-prompts.md.ts";
import {
  buildNoCandidateError,
  createFinderModelSelectionPlan,
  formatFinalFailureMessage,
  getNextFinderSubagentModel,
  isAbortLikeError,
  isQuotaError,
  looksLikeSilentModelFailure,
  markModelTemporarilyUnavailable,
  modelLabel,
  type FinderAttemptFailure,
  type FinderModelUnavailableReason,
  type FinderSubagentModelSelection,
} from "./model-selection";

export default function finderExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "finder",
    label: "Finder",
    description:
      "Read-only workspace scout for coding and personal-assistant tasks. Prefer one broad Finder call per task: give it the end goal, likely scope, and hints, and let it do the reconnaissance you would otherwise do manually with ls/rg/fd/read. Finder returns a compact, evidence-backed map: likely entrypoints, core files, nearby config/tests/docs/examples, and key citations.",
    parameters: FinderParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const restoreMaxListeners = bumpDefaultEventTargetMaxListeners();
      let abortListenerAdded = false;
      let onAbort: (() => void) | undefined;
      try {
        const rawQuery = (params as any).query;
        const query = typeof rawQuery === "string" ? rawQuery.trim() : "";

        if (!query) {
          const error = "Invalid parameters: expected `query` to be a non-empty string.";
          return {
            content: [{ type: "text", text: error }],
            details: { status: "error", runs: [] } satisfies FinderDetails,
            isError: true,
          };
        }

        const runs: FinderRunDetails[] = [{ status: "running", query, turns: 0, toolCalls: [], startedAt: Date.now() }];

        const modelRegistry = ctx.modelRegistry;
        const planResult = createFinderModelSelectionPlan(ctx.model);
        if (!planResult.plan) {
          const error = planResult.error ?? "Failed to parse PI_FINDER_MODELS.";
          runs[0].status = "error";
          runs[0].error = error;
          runs[0].summaryText = error;
          runs[0].endedAt = Date.now();
          return {
            content: [{ type: "text", text: error }],
            details: {
              status: "error",
              workspace: ctx.cwd,
              runs,
            } satisfies FinderDetails,
            isError: true,
          };
        }

        const selectionPlan = planResult.plan;
        let currentSelection = getNextFinderSubagentModel(selectionPlan, modelRegistry);

        if (!currentSelection) {
          const error = buildNoCandidateError(selectionPlan);
          runs[0].status = "error";
          runs[0].error = error;
          runs[0].summaryText = error;
          runs[0].endedAt = Date.now();
          return {
            content: [{ type: "text", text: error }],
            details: {
              status: "error",
              workspace: ctx.cwd,
              runs,
            } satisfies FinderDetails,
            isError: true,
          };
        }

        let subModel = currentSelection.model;
        let subagentSelection: SubagentSelectionInfo = {
          reason: currentSelection.reason,
        };

        let lastUpdate = 0;
        const emitAll = (force = false) => {
          const now = Date.now();
          if (!force && now - lastUpdate < 120) return;
          lastUpdate = now;

          const status = computeOverallStatus(runs);
          const text = renderCombinedMarkdown(runs);

          onUpdate?.({
            content: [{ type: "text", text }],
            details: {
              status,
              workspace: ctx.cwd,
              subagentProvider: subModel.provider,
              subagentModelId: subModel.id,
              subagentSelection,
              runs,
            } satisfies FinderDetails,
          });
        };

        emitAll(true);

        const systemPrompt = buildFinderSystemPrompt();

        let toolAborted = false;
        const activeSessions = new Set<{ abort: () => Promise<void> }>();

        const markAllAborted = () => {
          for (const run of runs) {
            if (run.status !== "running") continue;
            run.status = "aborted";
            run.summaryText = run.summaryText ?? "Aborted";
            run.endedAt = Date.now();
          }
        };

        const abortAll = async () => {
          if (toolAborted) return;
          toolAborted = true;
          markAllAborted();
          emitAll(true);
          await Promise.allSettled([...activeSessions].map((session) => session.abort()));
        };

        onAbort = () => void abortAll();

        if (signal?.aborted) {
          await abortAll();
          const status = computeOverallStatus(runs);
          const text = renderCombinedMarkdown(runs);
          return {
            content: [{ type: "text", text }],
            details: {
              status,
              workspace: ctx.cwd,
              runs,
              subagentProvider: subModel.provider,
              subagentModelId: subModel.id,
              subagentSelection,
            } satisfies FinderDetails,
            isError: status === "error",
          };
        }

        if (signal) {
          signal.addEventListener("abort", onAbort);
          abortListenerAdded = true;
        }

        const wasAborted = () => toolAborted || signal?.aborted;
        const run = runs[0];
        const attemptFailures: FinderAttemptFailure[] = [];

        const resourceLoader = new DefaultResourceLoader({
          cwd: ctx.cwd,
          agentDir: getAgentDir(),
          noExtensions: true,
          additionalExtensionPaths: ["npm:pi-subdir-context"],
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          systemPromptOverride: () => systemPrompt,
          skillsOverride: () => ({ skills: [], diagnostics: [] }),
        });

        const runAttempt = async (
          selection: FinderSubagentModelSelection,
        ): Promise<
          | { status: "success" }
          | { status: "aborted" }
          | { status: "failure"; message: string; error: unknown; reason: FinderModelUnavailableReason }
        > => {
          run.status = "running";
          run.turns = 0;
          run.toolCalls = [];
          run.startedAt = Date.now();
          run.endedAt = undefined;
          run.error = undefined;
          run.summaryText = undefined;

          let session: any;
          let unsubscribe: (() => void) | undefined;

          try {
            const { session: createdSession } = await createAgentSession({
              cwd: ctx.cwd,
              modelRegistry,
              resourceLoader,
              sessionManager: SessionManager.inMemory(ctx.cwd),
              model: selection.model,
              thinkingLevel: selection.thinkingLevel,
              tools: ["read", "bash"],
            });

            session = createdSession;
            activeSessions.add(session as any);

            unsubscribe = session.subscribe((event) => {
              switch (event.type) {
                case "turn_end": {
                  run.turns += 1;
                  emitAll();
                  break;
                }
                case "tool_execution_start": {
                  run.toolCalls.push({
                    id: event.toolCallId,
                    name: event.toolName,
                    args: event.args,
                    startedAt: Date.now(),
                  });
                  if (run.toolCalls.length > MAX_TOOL_CALLS_TO_KEEP) {
                    run.toolCalls.splice(0, run.toolCalls.length - MAX_TOOL_CALLS_TO_KEEP);
                  }
                  emitAll(true);
                  break;
                }
                case "tool_execution_end": {
                  const call = run.toolCalls.find((c) => c.id === event.toolCallId);
                  if (call) {
                    call.endedAt = Date.now();
                    call.isError = event.isError;
                  }
                  emitAll(true);
                  break;
                }
              }
            });

            await session.prompt(buildFinderUserPrompt(query), {
              expandPromptTemplates: false,
            });

            run.summaryText = getLastAssistantText(session.state.messages as any[]).trim();
            if (!run.summaryText) run.summaryText = wasAborted() ? "Aborted" : "(no output)";
            run.status = wasAborted() ? "aborted" : "done";
            run.endedAt = Date.now();
            emitAll(true);

            if (run.status === "aborted") return { status: "aborted" };

            if (looksLikeSilentModelFailure(run)) {
              const message = "Model produced no output and made no tool calls.";
              run.status = "error";
              run.error = message;
              run.summaryText = message;
              run.endedAt = Date.now();
              emitAll(true);
              return { status: "failure", message, error: new Error(message), reason: "error" };
            }

            return { status: "success" };
          } catch (error) {
            const aborted = wasAborted() || isAbortLikeError(error);
            const message = aborted ? "Aborted" : error instanceof Error ? error.message : String(error);
            run.status = aborted ? "aborted" : "error";
            run.error = aborted ? undefined : message;
            run.summaryText = message;
            run.endedAt = Date.now();
            emitAll(true);

            if (aborted) return { status: "aborted" };

            return {
              status: "failure",
              message,
              error,
              reason: isQuotaError(error) ? "quota" : "error",
            };
          } finally {
            if (session) activeSessions.delete(session as any);
            unsubscribe?.();
            session?.dispose();
          }
        };

        try {
          await resourceLoader.reload();

          while (currentSelection) {
            subModel = currentSelection.model;
            subagentSelection = { reason: currentSelection.reason };
            emitAll(true);

            const attemptResult = await runAttempt(currentSelection);

            if (attemptResult.status === "success") break;
            if (attemptResult.status === "aborted") break;

            attemptFailures.push({
              modelLabel: modelLabel(currentSelection),
              reason: attemptResult.reason,
              message: attemptResult.message,
            });

            markModelTemporarilyUnavailable(currentSelection.model, attemptResult.reason);

            const nextSelection = getNextFinderSubagentModel(selectionPlan, modelRegistry);
            if (!nextSelection) {
              const error = formatFinalFailureMessage(attemptFailures);
              run.status = "error";
              run.error = error;
              run.summaryText = error;
              run.endedAt = Date.now();
              emitAll(true);
              break;
            }

            currentSelection = nextSelection;
          }
        } catch (error) {
          const aborted = wasAborted() || isAbortLikeError(error);
          const message = aborted ? "Aborted" : error instanceof Error ? error.message : String(error);
          run.status = aborted ? "aborted" : "error";
          run.error = aborted ? undefined : message;
          run.summaryText = message;
          run.endedAt = Date.now();
          emitAll(true);
        }

        const status = computeOverallStatus(runs);
        const text = renderCombinedMarkdown(runs);

        return {
          content: [{ type: "text", text }],
          details: {
            status,
            workspace: ctx.cwd,
            runs,
            subagentProvider: subModel.provider,
            subagentModelId: subModel.id,
            subagentSelection,
          } satisfies FinderDetails,
          isError: status === "error",
        };
      } finally {
        if (signal && abortListenerAdded && onAbort) signal.removeEventListener("abort", onAbort);
        restoreMaxListeners();
      }
    },

    renderCall(args, theme) {
      const query = typeof (args as any)?.query === "string" ? ((args as any).query as string).trim() : "";
      const preview = shorten(query.replace(/\s+/g, " ").trim(), 70);

      const text = preview ? theme.fg("muted", preview) : "";
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as FinderDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }

      const status = isPartial ? "running" : details.status;
      const icon =
        status === "done"
          ? theme.fg("success", "✓")
          : status === "error"
            ? theme.fg("error", "✗")
            : status === "aborted"
              ? theme.fg("warning", "◼")
              : theme.fg("warning", "⏳");

      const run = details.runs[0];
      const totalToolCalls = run?.toolCalls.length ?? 0;
      const totalTurns = run?.turns ?? 0;

      const header =
        icon +
        " " +
        theme.fg("toolTitle", theme.bold("finder ")) +
        theme.fg(
          "dim",
          `${details.subagentProvider ?? "?"}/${details.subagentModelId ?? "?"} • ${totalTurns} turns • ${totalToolCalls} tool call${totalToolCalls === 1 ? "" : "s"}`,
        );

      const workspaceLine = details.workspace
        ? `${theme.fg("muted", "workspace: ")}${theme.fg("toolOutput", details.workspace)}`
        : theme.fg("muted", "workspace: (none)");

      const selectionReasonLine = details.subagentSelection
        ? `${theme.fg("muted", "selection: ")}${theme.fg("toolOutput", details.subagentSelection.reason)}`
        : undefined;

      let toolsText = "";
      if (run && run.toolCalls.length > 0) {
        const calls = expanded ? run.toolCalls : run.toolCalls.slice(-6);
        const lines: string[] = [theme.fg("muted", "Tools:")];
        for (const call of calls) {
          const callIcon = call.isError ? theme.fg("error", "✗") : theme.fg("dim", "→");
          lines.push(`${callIcon} ${theme.fg("toolOutput", formatToolCall(call))}`);
        }
        if (!expanded && run.toolCalls.length > 6) lines.push(theme.fg("muted", "(Ctrl+O to expand)"));
        toolsText = lines.join("\n");
      }

      if (status === "running") {
        let text = `${header}\n${workspaceLine}`;
        if (expanded && selectionReasonLine) text += `\n${selectionReasonLine}`;
        if (toolsText) text += `\n\n${toolsText}`;
        text += `\n\n${theme.fg("muted", "Searching workspace…")}`;
        return new Text(text, 0, 0);
      }

      const mdTheme = getMarkdownTheme();
      const combined =
        (result.content[0]?.type === "text" ? result.content[0].text : renderCombinedMarkdown(details.runs)).trim() ||
        "(no output)";

      if (!expanded) {
        const previewLines = combined.split("\n").slice(0, 18).join("\n");
        let text = `${header}\n${workspaceLine}`;
        text += `\n\n${theme.fg("toolOutput", previewLines)}`;
        if (combined.split("\n").length > 18) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
        if (toolsText) text += `\n\n${toolsText}`;
        return new Text(text, 0, 0);
      }

      const container = new Container();
      container.addChild(new Text(header, 0, 0));
      container.addChild(new Text(workspaceLine, 0, 0));
      if (selectionReasonLine) container.addChild(new Text(selectionReasonLine, 0, 0));
      if (toolsText) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(toolsText, 0, 0));
      }
      container.addChild(new Spacer(1));
      container.addChild(new Markdown(combined, 0, 0, mdTheme));
      return container;
    },
  });
}
