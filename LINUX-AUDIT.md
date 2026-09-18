# Linux audit

## Architecture

The CLI exports only selected, stable rollout JSONL snapshots into per-device vault heads. It reconciles heads only when one is a byte prefix of another, writes a canonical JSONL, then imports that JSONL into the destination's `sessions/` tree. The destination's local `state_5.sqlite`, `session_index.jsonl`, and optional desktop catalog are updated locally; databases themselves are not transported. Skills and project catalogs use separate flows.

## Findings before this change

- `CODEX_HOME` was read from `--codex-home`, then `CODEX_HOME`, then `~/.codex`.
- Every state lookup and write assumed `CODEX_HOME/state_5.sqlite`; `CODEX_SQLITE_HOME` was not supported.
- Import created its rollout under the portable `sessions/...` relative path and wrote that destination path to the `threads.rollout_path` row.
- `cwd` used `pathMaps`, but an unmapped Windows path on Linux could be normalized into an unintended local path.
- `session_index.jsonl` was regenerated, silently dropping malformed/unknown records.
- `thread_history_1.sqlite` and `logs_2.sqlite` were not directly copied, but exclusion policy should be explicit in tests.
- Linux had no scheduler implementation; Windows Task Scheduler and macOS LaunchAgents were platform-specific. Project registration also remains Windows/macOS-specific.

## Changes made

- Linux is explicitly supported in documentation and `daemon` now optionally emits a `systemd --user` service and timer. Manual synchronization remains independent.
- SQLite discovery supports `--codex-sqlite-home` and `CODEX_SQLITE_HOME`. Without either, it selects only an existing supported `state_5.sqlite` layout (`CODEX_HOME` or `CODEX_HOME/sqlite`) and does not create a guessed database.
- The state database remains local and is only opened for local index updates. No SQLite database, `thread_history_1.sqlite`, `logs_2.sqlite`, credentials, or tokens is part of conversation transport.
- Imported `cwd` is mapped locally; a foreign Windows/POSIX path without a mapping is refused. `rollout_path` is always derived from the local import destination.
- Updating `session_index.jsonl` preserves all original non-superseded lines, including unknown or malformed lines.

## Remaining risks / tests to add

- Real Codex desktop SQLite schemas can evolve; fixtures should cover observed Linux schemas before releases.
- Every `ensureThreadIndex()` caller now routes through centralized local backups; backup names include a hash of the full source path to avoid basename collisions. Fixtures verify backups exist before imported index writes and preserve CRLF, blank, malformed, and unknown index records.
- Test environments set `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, and `CODEX_HOME` to temporary roots. The Linux fixture verifies an absent explicit SQLite database stays absent after `doctor` and dry-run sync, and recursively scans the vault for forbidden SQLite artifacts.
- `localCwd()` now rejects drive-letter, UNC, slash-UNC, and extended-length Windows paths on non-Windows hosts unless path-mapped. The remaining limitation is that Windows execution itself is not simulated on this Linux host; Windows-target semantics require a Windows CI runner.
- `systemd --user` is probed before non-dry-run installation and service `ExecStart` arguments are quoted. A real user-unit install is intentionally not run by fixtures.
