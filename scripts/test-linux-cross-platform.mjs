#!/usr/bin/env node
// Linux-only fixture: never reads a real Codex home.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { protectedFileFingerprint, safetyPostflight } from "./codexsync.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const cli = path.join(path.dirname(new URL(import.meta.url).pathname), "codexsync.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-sync-linux-"));
const id = "019f0000-0000-7000-8000-000000000099";
const checks = [];
function check(name, condition) { assert.ok(condition, name); checks.push({ name, result: "PASS" }); }
const run = (args, env = {}) => JSON.parse(execFileSync(process.execPath, [cli, ...args, "--json"], { encoding: "utf8", env: { ...process.env, HOME: path.join(root, "isolated-home"), USERPROFILE: path.join(root, "isolated-home"), XDG_CONFIG_HOME: path.join(root, "isolated-home", ".config"), CODEX_HOME: path.join(root, "not-real-codex"), NODE_NO_WARNINGS: "1", ...env } }));
const runFails = (args, env = {}) => { try { run(args, env); } catch (error) { return `${error.stderr ?? ""}${error.stdout ?? ""}${error.message ?? ""}`; } throw new Error(`expected failure: ${args.join(" ")}`); };
function db(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const value = new DatabaseSync(file);
  value.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, sandbox_policy TEXT NOT NULL, approval_mode TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, has_user_event INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, cli_version TEXT NOT NULL DEFAULT '', first_user_message TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', created_at_ms INTEGER, updated_at_ms INTEGER, recency_at INTEGER NOT NULL DEFAULT 0, recency_at_ms INTEGER NOT NULL DEFAULT 0)");
  return value;
}
try {
  const winHome = path.join(root, "win-home"); const linuxHome = path.join(root, "linux-home");
  const winSqlite = path.join(root, "win-sqlite"); const linuxSqlite = path.join(root, "linux-sqlite");
  const rollout = path.join(winHome, "sessions", "2026", "01", "01", `rollout-${id}.jsonl`);
  fs.mkdirSync(path.dirname(rollout), { recursive: true }); fs.mkdirSync(path.join(linuxHome, "sessions"), { recursive: true });
  const sourceCwd = "C:\\Users\\user\\project"; const linuxCwd = path.join(root, "home", "user", "project"); fs.mkdirSync(linuxCwd, { recursive: true });
  fs.writeFileSync(rollout, `${JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", type: "session_meta", payload: { id, cwd: sourceCwd, model_provider: "openai" } })}\n${JSON.stringify({ timestamp: "2026-01-01T00:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "fixture" } })}\n`);
  const sourceDb = db(path.join(winSqlite, "state_5.sqlite"));
  sourceDb.prepare("INSERT INTO threads (id,rollout_path,created_at,updated_at,source,model_provider,cwd,title,sandbox_policy,approval_mode,tokens_used,has_user_event,archived) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, rollout, 1, 2, "cli", "openai", sourceCwd, "Windows to Linux", "{}", "never", 0, 1, 0); sourceDb.close();
  db(path.join(linuxSqlite, "state_5.sqlite")).close();
  fs.writeFileSync(path.join(winHome, "thread_history_1.sqlite"), "never transport"); fs.writeFileSync(path.join(winHome, "logs_2.sqlite"), "never transport");
  const vault = path.join(root, "vault"); const a = path.join(root, "a.json"); const b = path.join(root, "b.json");
  run(["init", "--vault", vault, "--device", "win-fixture", "--codex-home", winHome, "--codex-sqlite-home", winSqlite, "--config", a]);
  run(["init", "--vault", vault, "--device", "linux-fixture", "--codex-home", linuxHome, "--codex-sqlite-home", linuxSqlite, "--config", b]);
  const preservedIndex = `{"id":"other"}\r\n{"future":true}\r\nnot-json\r\n\r\n${JSON.stringify({ id, thread_name: "old" })}\r\n`;
  fs.writeFileSync(path.join(linuxHome, "session_index.jsonl"), preservedIndex);
  run(["project", "map", "--from", sourceCwd, "--to", linuxCwd, "--config", b]); run(["conversation", "select", "current", "--config", a], { CODEX_THREAD_ID: id }); run(["sync", "--config", a]);
  fs.mkdirSync(path.join(linuxHome, "sqlite"), { recursive: true }); const catalogDb = new DatabaseSync(path.join(linuxHome, "sqlite", "codex-dev.db")); catalogDb.exec("CREATE TABLE local_thread_catalog (host_id TEXT NOT NULL, thread_id TEXT NOT NULL, display_title TEXT NOT NULL, source_created_at REAL NOT NULL, source_updated_at REAL NOT NULL, cwd TEXT NOT NULL, source_kind TEXT NOT NULL, source_detail TEXT, model_provider TEXT NOT NULL, git_branch TEXT, observation_sequence INTEGER NOT NULL, missing_candidate INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (host_id,thread_id)); CREATE TABLE local_thread_catalog_hosts (host_id TEXT PRIMARY KEY, host_kind TEXT NOT NULL); CREATE TABLE local_thread_catalog_sync_state (host_id TEXT PRIMARY KEY, watermark_updated_at REAL, initial_build_complete INTEGER NOT NULL DEFAULT 0, observation_sequence INTEGER NOT NULL DEFAULT 0); CREATE TABLE local_thread_catalog_metadata (id INTEGER PRIMARY KEY, catalog_revision INTEGER NOT NULL DEFAULT 0); INSERT INTO local_thread_catalog_hosts VALUES ('local','local'); INSERT INTO local_thread_catalog_sync_state VALUES ('local',NULL,1,1); INSERT INTO local_thread_catalog_metadata VALUES (1,0);"); catalogDb.close();
  const local = path.join(linuxHome, "sessions", "2026", "01", "01", path.basename(rollout)); fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, fs.readFileSync(rollout, "utf8").split("\n")[0] + "\n");
  const trace = path.join(root, "trace.log"); run(["pull", "--config", b], { CODEX_SYNC_TEST_TRACE: trace });
  check("local-rollout-created", fs.existsSync(local)); check("local-cwd-mapped", new DatabaseSync(path.join(linuxSqlite, "state_5.sqlite")).prepare("SELECT cwd FROM threads WHERE id=?").get(id).cwd === linuxCwd);
  check("local-rollout-path", new DatabaseSync(path.join(linuxSqlite, "state_5.sqlite")).prepare("SELECT rollout_path FROM threads WHERE id=?").get(id).rollout_path === local);
  const indexAfter = fs.readFileSync(path.join(linuxHome, "session_index.jsonl"), "utf8"); check("session-index-nontarget-bytes-preserved", indexAfter.startsWith(`{"id":"other"}\r\n{"future":true}\r\nnot-json\r\n\r\n`)); check("session-index-target-replaced-once", (indexAfter.match(new RegExp(`\\"id\\":\\"${id}\\"`, "g")) ?? []).length === 1 && !indexAfter.includes('"thread_name":"old"'));
  const unmappedHome = path.join(root, "unmapped-home"); const unmappedSqlite = path.join(root, "unmapped-sqlite"); const unmappedConfig = path.join(root, "unmapped.json"); db(path.join(unmappedSqlite, "state_5.sqlite")).close();
  run(["init", "--vault", vault, "--device", "unmapped", "--codex-home", unmappedHome, "--codex-sqlite-home", unmappedSqlite, "--config", unmappedConfig]);
  const unmapped = run(["pull", "--config", unmappedConfig]);
  check("unmapped-windows-cwd-rejected", unmapped.warnings.some((item) => item.includes("No local path mapping for Windows cwd")));
  const vaultFiles = fs.readdirSync(vault, { recursive: true });
  check("vault-has-no-sqlite-or-sidecars", !vaultFiles.map((item) => item.replaceAll("\\", "/")).some((item) => /(?:\.sqlite(?:-(?:wal|shm))?|-(?:wal|shm))$/i.test(item)));
  const backupFiles = fs.readdirSync(path.join(root, "backups"), { recursive: true });
  check("backup-files-exist", backupFiles.some((item) => item.endsWith("state_5.sqlite")) && backupFiles.some((item) => item.endsWith("session_index.jsonl")));
  const events = fs.readFileSync(trace, "utf8").trim().split("\n").map((line) => line.split("\t")); const backupBefore = (kind) => events.findIndex(([event]) => event === kind) > events.findIndex(([event]) => event === "backup"); check("backup-precedes-rollout-state-index-and-catalog", ["rollout", "state", "index", "catalog"].every(backupBefore));
  const emptyHome = path.join(root, "empty-home"); const emptySqlite = path.join(root, "empty-sqlite"); const emptyConfig = path.join(root, "empty.json"); fs.mkdirSync(emptySqlite, { recursive: true });
  run(["init", "--vault", path.join(root, "empty-vault"), "--device", "empty", "--codex-home", emptyHome, "--codex-sqlite-home", emptySqlite, "--config", emptyConfig]); run(["doctor", "--config", emptyConfig]); run(["sync", "--dry-run", "--config", emptyConfig]);
  check("absent-sqlite-not-created", !fs.existsSync(path.join(emptySqlite, "state_5.sqlite")));
  // Safety validates operational state, not historical JSONL strings.
  const localHash = fs.readFileSync(local, "utf8"); const verifyB = run(["verify", "--config", b]);
  check("historical-foreign-path-is-allowed", verifyB.status === "pass" && fs.readFileSync(local, "utf8") === localHash);
  const configBBytes = fs.readFileSync(b); const configB = JSON.parse(configBBytes); configB.pathMaps = []; fs.writeFileSync(b, `${JSON.stringify(configB, null, 2)}\n`);
  const linuxDbFile = path.join(linuxSqlite, "state_5.sqlite"); const linuxDb = new DatabaseSync(linuxDbFile);
  const originalCwd = linuxDb.prepare("SELECT cwd FROM threads WHERE id=?").get(id).cwd; const originalRollout = linuxDb.prepare("SELECT rollout_path FROM threads WHERE id=?").get(id).rollout_path;
  for (const [name, foreign] of [["foreign-drive-safety-fails", "C:\\Users\\tester\\projects\\demo"], ["unc-safety-fails", "\\\\server\\share\\project"], ["extended-path-safety-fails", "\\\\?\\C:\\Users\\tester\\projects\\demo"]]) {
    linuxDb.prepare("UPDATE threads SET cwd=? WHERE id=?").run(foreign, id); check(name, /cwd.*(?:unmapped|Windows)/i.test(runFails(["conversation", "verify", id, "--config", b])));
  }
  linuxDb.prepare("UPDATE threads SET cwd=?,rollout_path=? WHERE id=?").run(originalCwd, path.join(root, "foreign-rollout.jsonl"), id); check("invalid-rollout-path-safety-fails", /outside local CODEX_HOME sessions/.test(runFails(["conversation", "verify", id, "--config", b])));
  linuxDb.prepare("UPDATE threads SET rollout_path=? WHERE id=?").run(originalRollout, id); linuxDb.close(); check("valid-rollout-path-safety-passes", run(["verify", "--config", b]).status === "pass"); fs.writeFileSync(b, configBBytes);
  const dryFiles = [local, linuxDbFile, path.join(linuxHome, "session_index.jsonl"), path.join(vault, "conversations", id, "canonical.jsonl"), path.join(vault, "conversations", id, "heads", "win-fixture.jsonl"), b].map((file) => [file, fs.readFileSync(file).toString("hex")]);
  run(["sync", "--dry-run", "--config", b]); check("dry-run-preserves-all-observed-hashes", dryFiles.every(([file, hash]) => fs.readFileSync(file).toString("hex") === hash));
  // The harness, not codexsync, changes the protected file between the real
  // fingerprint and postflight functions.
  const protectedFile = path.join(linuxHome, "thread_history_1.sqlite"); fs.writeFileSync(protectedFile, "protected-before");
  const protectedBefore = protectedFileFingerprint(linuxHome); fs.writeFileSync(protectedFile, "externally-mutated-by-test-harness");
  const protectedPostflight = safetyPostflight({ codexHome: linuxHome, vault, conversations: {}, pathMaps: [] }, protectedBefore, "verify");
  check("protected-file-violation-detected", protectedPostflight.status === "fail" && protectedPostflight.protectedFiles.thread_history_1.unchanged === false);
  // A second extension exercises deterministic failure after backup and rollout write.
  fs.appendFileSync(rollout, `${JSON.stringify({ timestamp: "2026-01-01T00:00:03.000Z", type: "event_msg", payload: { type: "user_message", message: "fault fixture" } })}\n`); run(["sync", "--config", a]);
  const fault = runFails(["pull", "--config", b], { CODEX_SYNC_TEST_FAIL_AT: "state", CODEX_SYNC_TEST_TRACE: trace });
  const backupAfterFault = fs.readdirSync(path.join(root, "backups"), { recursive: true });
  check("fault-after-backup-is-failure", /Injected test failure before state write/.test(fault) && backupAfterFault.some((item) => item.endsWith("state_5.sqlite")) && backupAfterFault.some((item) => item.endsWith("session_index.jsonl")));
  check("fault-does-not-leak-sqlite-to-vault", !fs.readdirSync(vault, { recursive: true }).some((item) => /(?:\.sqlite(?:-(?:wal|shm))?|-(?:wal|shm))$/i.test(String(item))));
  console.log(JSON.stringify({ ok: true, totalChecks: checks.length, checks }, null, 2));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
