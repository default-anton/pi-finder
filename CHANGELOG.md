# Changelog

All notable changes to `pi-finder-subagent` are documented here.

## Format

- Keep `## [Unreleased]` at the top.
- Use release headers as `## [X.Y.Z] - YYYY-MM-DD`.
- Group entries under `### Added`, `### Changed`, `### Fixed` (optionally `### Removed` / `### Security`).
- Keep entries short and operator/user-facing.

## [Unreleased]

### Added

- None.

### Changed

- None.

### Fixed

- None.

## [1.4.0] - 2026-02-20

### Added

- None.

### Changed

- **BREAKING:** Replaced shared `pi-subagent-model-selection` routing and single-model `PI_FINDER_MODEL` override with local deterministic ordered failover via `PI_FINDER_MODELS`, including availability-filtered `ctx.model` fallback, and temporary-unavailable cache with reason-aware TTLs (quota: 30m, other final failures: 10m). Migration guidance: see `README.md` → **Model selection policy** (switch `PI_FINDER_MODEL` to ordered `PI_FINDER_MODELS="provider/model:thinking,..."`).

### Fixed

- None.

## [1.3.0] - 2026-02-18

### Added

- Added `PI_FINDER_MODEL` override (`provider/model:thinking`) for deterministic subagent model selection; when set and non-empty, Finder bypasses `pi-subagent-model-selection`, uses the requested available model, and reports override diagnostics via explicit selection `reason`.

### Changed

- Simplified Finder selection diagnostics payload to `reason` only and removed `authMode` / `authSource` from Finder tool details and TUI rendering.

### Fixed

- None.

## [1.2.2] - 2026-02-17

### Added

- None.

### Changed

- Updated peer dependencies `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` to `^0.53.0`.

### Fixed

- None.

## [1.2.1] - 2026-02-13

### Added

- None.

### Changed

- Updated peer dependencies `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` to `^0.52.12`.
- Bumped internal dependency `pi-subagent-model-selection` from `^0.1.3` to `^0.1.4`.

### Fixed

- None.

## [1.2.0] - 2026-02-12

### Added

- None.

### Changed

- Reduced Finder's default turn budget from 10 to 6 (`DEFAULT_MAX_TURNS`) to tighten completion time and avoid over-searching.
- Refined Finder system/user prompts to favor direct findings, faster path-first searches, and clearer evidence/citation guidance (including `rg -n` / `nl -ba` line-number sourcing).

### Fixed

- None.

## [1.1.4] - 2026-02-12

### Added

- None.

### Changed

- Bumped `pi-subagent-model-selection` dependency range from `^0.1.2` to `^0.1.3`.

### Fixed

- None.

## [1.1.3] - 2026-02-12

### Added

- Added automated GitHub Actions release workflow (`.github/workflows/release.yml`) triggered by stable `vX.Y.Z` tags.
- Added release validation and notes extraction scripts: `scripts/verify-release-tag.mjs` and `scripts/changelog-release-notes.mjs`.

### Changed

- Updated release process to use trusted publishing (`npm publish --provenance --access public`) from CI instead of manual local publishing.
- Added canonical npm release scripts (`release:verify-tag`, `release:notes`, `release:gate`) to `package.json`.

### Fixed

- None.
