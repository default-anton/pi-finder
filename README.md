# pi-finder

Read-only local workspace scout subagent package for [pi](https://github.com/badlogic/pi-mono).

Finder uses a single interface for both coding agents and personal AI assistants: search files/folders, gather evidence, and return cited locations.

## Installation

From npm (after publish):

```bash
pi install npm:pi-finder-subagent
```

From git:

```bash
pi install git:github.com/default-anton/pi-finder
```

Or run without installing:

```bash
pi -e npm:pi-finder-subagent
# or
pi -e git:github.com/default-anton/pi-finder
```

## What it does

- Registers a `finder` tool.
- Runs a dedicated subagent session with strict turn budget enforcement.
- Uses only `bash` + `read` in the subagent.
- Enforces read-only scouting behavior (`rg`/`fd`/`ls` + targeted reads).
- Works across code and non-code files in local workspaces.
- Returns structured Markdown output (`Summary`, `Locations`, optional `Evidence`/`Searched`/`Next steps`).
- Selects subagent model via ordered `PI_FINDER_MODELS` failover with `ctx.model` fallback.
- Emits compact selection diagnostics (`reason`) in tool details.

## Tool interface

```ts
finder({
  query: string,
})
```

- `query` (required): what to find, how to search, what counts as found, and (if known) scope hints such as directories/roots to prioritize.

## Example queries

Code-oriented:

```txt
Find where user authentication is implemented. Look for login/auth/authenticate and return entrypoint + token handling with line ranges under src/auth and src/api.
```

Personal assistant-oriented:

```txt
Find my latest trip itinerary PDF in Documents or Desktop and list top candidate paths with evidence.
```

## Model selection policy

Finder uses local deterministic model routing with ordered failover.

Configure candidates with `PI_FINDER_MODELS`:

```bash
PI_FINDER_MODELS="provider/model:thinking,provider/model:thinking,..."
```

Concrete example:

```bash
export PI_FINDER_MODELS="openai-codex/gpt-5.3-codex-spark:high,google-antigravity/gemini-3-flash:medium,anthropic/claude-sonnet-4-6:high"
```

Rules:

- `thinking` must be one of: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- Tokens are parsed in order (comma-separated, trimmed, empty tokens ignored).
- Each token is filtered by:
  1. `ctx.modelRegistry.getAvailable()`
  2. Finder's in-memory temporary-unavailable cache (reason-aware TTL)
- Finder picks the first candidate passing both filters.
- If `PI_FINDER_MODELS` is unset/blank, or no candidate passes filters, Finder tries `ctx.model` fallback using the same availability + temporary-unavailable filters.
- On any final non-abort model failure, Finder fails over to the next available candidate.
- Temporary-unavailable TTLs are:
  - quota-like final failures: 30 minutes
  - other final failures: 10 minutes
- Finder does not add its own retry/backoff loop for transient errors; SDK retry behavior remains the first-line retry mechanism.
- Selection diagnostics stay compact and expose only `subagentSelection.reason`.

## Development

```bash
npm run pack:check
```

## License

Apache-2.0
