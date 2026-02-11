## Invariants

- Keep this package dependency-light. Do not add runtime dependencies unless strictly necessary.
- `extensions/index.ts` is the only extension entrypoint; keep orchestration there.
- Model routing policy comes from `pi-subagent-model-selection`; do not fork behavior locally.
- Selection diagnostics contract lives in `extensions/finder-core.ts` (`subagentSelection`). Keep it tight: `authMode`, `authSource`, `reason`.

## Required validation

Run after changing code (not docs-only):

```bash
npm run test:model-selection
```

## Policy changes

When changing model-selection behavior:

1. Update upstream package tests/docs in `pi-subagent-model-selection` first.
2. Update README section `Model selection policy`.
3. Keep fallback behavior explicit and deterministic.
