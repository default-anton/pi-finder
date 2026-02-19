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
- Selects subagent model dynamically using shared package `pi-subagent-model-selection`.
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

Default behavior delegates model selection to `pi-subagent-model-selection` (shared with pi-librarian).
The policy definition and its test suite live only in that package.

You can override the subagent model explicitly with `PI_FINDER_MODEL`:

```bash
PI_FINDER_MODEL="provider/model:thinking"
```

Concrete example:

```bash
export PI_FINDER_MODEL=google-antigravity/gemini-3-flash:low
```

- `thinking` must be one of: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- When `PI_FINDER_MODEL` is set to a non-empty value, Finder uses it instead of shared selection policy.
- The requested model must exist in `modelRegistry.getAvailable()` (i.e. credentials are configured for that provider/model).
- In override mode, selection diagnostics report an explicit `reason` including the chosen `provider/model:thinking`.

## Quota fallback

When the primary model fails due to quota exhaustion or rate limits, Finder automatically retries with a fallback model. Two failure modes are handled:

- **Exception-based**: API returns a 429 / quota error that throws — detected via error message patterns.
- **Silent failure**: Model runs but calls no tools and returns no output — detected by inspecting the completed run.

The fallback model defaults to `anthropic/claude-sonnet-4-6:high` and can be overridden:

```bash
export PI_FINDER_FALLBACK_MODEL=anthropic/claude-opus-4-6:low
```

Format is the same as `PI_FINDER_MODEL`: `provider/model:thinking`.

- Set `PI_FINDER_FALLBACK_MODEL=""` to disable fallback entirely.
- The fallback model must be available in `modelRegistry.getAvailable()`.
- If primary and fallback resolve to the same model ID, fallback is skipped.
- Selection diagnostics report `fallback (quota): provider/model:thinking` when fallback is active.

## Development

```bash
npm run pack:check
```

## License

Apache-2.0
