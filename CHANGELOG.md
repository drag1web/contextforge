# Changelog

## 0.2.0-alpha

### Added

- Added Markdown Preview for generated Task Packs.
- Added Preview / Raw Markdown switch in the Task Pack modal.
- Added safer Task Pack body labels: Safe Template and Ollama refined.
- Added universal task intent analysis for UI, backend, fullstack, build, docs, and asset tasks.
- Added project inventory based file selection.
- Added semantic validation for selected files.
- Added asset-focused file selection for logo/favicon tasks.
- Added frontend-only warning for fullstack tasks when no backend/server route files are found.
- Added task-aware context scanning and project inventory scanning.

### Changed

- Task Pack type now uses the effective inferred task area instead of the originally selected task type.
- Improved fullstack file coverage for UI + client API + backend tasks.
- Improved build/config, docs, asset-only, and fake-path task handling.
- Improved Task Pack modal layout, spacing, scrolling, and copy behavior.
- Improved Ollama fallback behavior so protected backend-generated sections remain stable.

### Fixed

- Fixed fake or non-existent paths leaking into generated Task Packs.
- Fixed `.env` being included in documentation Task Packs.
- Fixed confusing `Generation: Template` wording.
- Fixed markdown prompt display being shown only as raw text.
- Fixed Task Pack prompt scroll overlapping the modal footer.