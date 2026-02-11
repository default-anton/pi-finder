# pi-finder

Read-only codebase scout subagent package for [pi](https://github.com/badlogic/pi-mono).

## Installation

From npm (after publish):

```bash
pi install npm:pi-finder
```

From git:

```bash
pi install git:github.com/default-anton/pi-finder
```

Or run without installing:

```bash
pi -e npm:pi-finder
# or
pi -e git:github.com/default-anton/pi-finder
```

## What it does

- Registers a `finder` tool.
- Runs a dedicated subagent session with strict turn budget enforcement.
- Uses only `bash` + `read` in the subagent.
- Enforces read-only scouting behavior (rg/fd/ls + targeted reads).
- Returns structured Markdown output (`Summary`, `Locations`, optional `Evidence`/`Searched`/`Next steps`).
- Selects subagent model dynamically using shared package `pi-subagent-model-selection`.
- Emits compact selection diagnostics (`authMode`, `authSource`, `reason`) in tool details.

## Tool interface

```ts
finder({
  query: string,
})
```

## Model selection policy

Finder delegates model selection to `pi-subagent-model-selection`, which uses the same policy as pi-librarian:

- OAuth mode:
  1. `google-antigravity/gemini-3-flash`
  2. fallback strategy
- API-key mode:
  1. `google-vertex` Gemini 3 Flash (`gemini-3-flash*`)
  2. `google` Gemini 3 Flash (`gemini-3-flash*`)
  3. fallback strategy

Fallback strategy:
1. Gemini 3 Flash on current provider
2. Claude Haiku 4.5 on current provider
3. Current model with `thinkingLevel: low`

## Development

```bash
npm run test:model-selection
npm run pack:check
```

## License

Apache-2.0
