import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createBashTool,
  createReadTool,
  getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { getSmallModelFromProvider } from "pi-subagent-model-selection";

import {
  DEFAULT_MAX_TURNS,
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
} from "./finder-core";
import { buildFinderSystemPrompt, buildFinderUserPrompt } from "./finder-prompts.md.ts";

function createTurnBudgetExtension(maxTurns: number): ExtensionFactory {
  return (pi) => {
    let turnIndex = 0;

    pi.on("turn_start", async (event) => {
      turnIndex = event.turnIndex;
    });

    pi.on("tool_call", async () => {
      if (turnIndex < maxTurns - 1) return undefined;

      const humanTurn = Math.min(turnIndex + 1, maxTurns);
      return {
        block: true,
        reason: `Tool use is disabled on the final turn (turn ${humanTurn}/${maxTurns}). Provide your final answer now without calling tools.`,
      };
    });

    pi.on("tool_result", async (event) => {
      const remainingAfter = Math.max(0, maxTurns - (turnIndex + 1));
      const humanTurn = Math.min(turnIndex + 1, maxTurns);
      const budgetLine = `[turn budget] turn ${humanTurn}/${maxTurns}; remaining after this turn: ${remainingAfter}`;

      return {
        content: [...(event.content ?? []), { type: "text", text: `\n\n${budgetLine}` }],
      };
    });
  };
}

export default function finderExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "finder",
    label: "Finder",
    description:
      "Read-only workspace scout: searches local files/folders with rg/fd/ls/read and returns structured Markdown with Summary, Locations (path:lineStart-lineEnd), Evidence, and Searched sections.",
    parameters: FinderParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const restoreMaxListeners = bumpDefaultEventTargetMaxListeners();
      let abortListenerAdded = false;
      let onAbort: (() => void) | undefined;
      try {
        const maxTurns = DEFAULT_MAX_TURNS;
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

        const runs: FinderRunDetails[] = [
          {
            status: "running",
            query,
            turns: 0,
            toolCalls: [],
            startedAt: Date.now(),
          },
        ];

        const modelRegistry = ctx.modelRegistry;
        const subModelSelection = getSmallModelFromProvider(modelRegistry, ctx.model);

        if (!subModelSelection) {
          const error = "No models available. Configure credentials (e.g. /login or auth.json) and try again.";
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

        const subModel = subModelSelection.model;
        const subagentThinkingLevel = subModelSelection.thinkingLevel;
        const subagentSelection = {
          authMode: subModelSelection.authMode,
          authSource: subModelSelection.authSource,
          reason: subModelSelection.reason,
        } as const;

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

        const systemPrompt = buildFinderSystemPrompt(maxTurns);

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

        let session: any;
        let unsubscribe: (() => void) | undefined;

        try {
          const resourceLoader = new DefaultResourceLoader({
            noExtensions: true,
            additionalExtensionPaths: ["npm:pi-subdir-context"],
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            extensionFactories: [createTurnBudgetExtension(maxTurns)],
            systemPromptOverride: () => systemPrompt,
            skillsOverride: () => ({ skills: [], diagnostics: [] }),
          });
          await resourceLoader.reload();

          run.status = "running";
          run.turns = 0;
          run.toolCalls = [];
          run.startedAt = Date.now();
          run.endedAt = undefined;
          run.error = undefined;
          run.summaryText = undefined;

          const { session: createdSession } = await createAgentSession({
            cwd: ctx.cwd,
            modelRegistry,
            resourceLoader,
            sessionManager: SessionManager.inMemory(ctx.cwd),
            model: subModel,
            thinkingLevel: subagentThinkingLevel,
            tools: [createReadTool(ctx.cwd), createBashTool(ctx.cwd)],
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
        } catch (error) {
          const message = wasAborted() ? "Aborted" : error instanceof Error ? error.message : String(error);
          run.status = wasAborted() ? "aborted" : "error";
          run.error = wasAborted() ? undefined : message;
          run.summaryText = message;
          run.endedAt = Date.now();
          emitAll(true);
        } finally {
          if (session) activeSessions.delete(session as any);
          unsubscribe?.();
          session?.dispose();
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

      const title = theme.fg("toolTitle", theme.bold("finder"));
      const text = title + (preview ? `\n${theme.fg("muted", preview)}` : "");
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

      const selectionSummary = details.subagentSelection
        ? `${details.subagentSelection.authMode}/${details.subagentSelection.authSource}`
        : "?/?";

      const header =
        icon +
        " " +
        theme.fg("toolTitle", theme.bold("finder ")) +
        theme.fg(
          "dim",
          `${details.subagentProvider ?? "?"}/${details.subagentModelId ?? "?"} • ${selectionSummary} • ${totalTurns} turns • ${totalToolCalls} tool call${totalToolCalls === 1 ? "" : "s"}`,
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
