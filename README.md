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
- Emits compact selection diagnostics (`authMode`, `authSource`, `reason`) in tool details.

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

Finder delegates model selection to `pi-subagent-model-selection` (shared with pi-librarian).
The policy definition and its test suite live only in that package.

## Development

```bash
npm run pack:check
```

## License

Apache-2.0
