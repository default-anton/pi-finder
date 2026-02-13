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
