# OpenCode Agent Tmux Plugin - Master Plan

## Project Overview

**Name:** opentmux
**Purpose:** OpenCode plugin that provides tmux integration for viewing agent execution in real-time
**Compatibility:** Works with ANY OpenCode agents (Sisyphus, Oracle, Explorer, Librarian, etc.)
**Version:** 1.5.7

## Key Features

1. **Automatic Tmux Pane Spawning**: When any agent starts, automatically spawn a tmux pane
2. **Live Streaming**: Each pane runs `opencode attach` to show real-time agent output
3. **Auto-Cleanup**: Panes automatically close when agents complete
4. **Configurable Layout**: Support multiple tmux layouts (main-vertical, main-horizontal, tiled)
5. **Agent-Agnostic**: Works with oh-my-opencode, omoc-slim, or vanilla OpenCode

## Technical Architecture

### Core Components

1. **TmuxSessionManager** (TypeScript class)
   - Subscribes to OpenCode's `session.created` event
   - Detects child sessions (agents) by checking for `parentID`
   - Spawns tmux pane for each agent
   - Polls session status and closes pane when complete

2. **SpawnQueue** (`src/spawn-queue.ts`)
   - Sequential processing with `spawnDelayMs` (default 300ms) between items
   - Coalesces duplicate session IDs
   - Exponential backoff retry via `maxRetries`
   - `staleThresholdMs` (default 30s) - items older than this are skipped
   - `onQueueDrained()` callback triggers tmux layout refresh when queue empties

3. **ZombieReaper** (`src/zombie-reaper.ts`)
   - Background scanner for orphaned `opencode attach` processes
   - Tracks zombie candidates with detection count + `firstDetectedAt`
   - Kills only after `minZombieChecks` and `gracePeriodMs` - avoids
     false positives
   - Verifies session status with the OpenCode server before killing
   - `autoSelfDestruct` after `selfDestructTimeoutMs` (1h default)
   - Self destruction happens when server is abandoned

4. **Tmux Utilities** (Helper functions)
   - `spawnTmuxPane(sessionId, title, config, serverUrl)`: Create new pane
   - `closeTmuxPane(paneId, layout)`: Clean up pane when done
   - `isInsideTmux()`: Check if running inside tmux
   - `checkServerHealth(serverUrl)`: Verify OpenCode server is reachable

5. **Plugin Entry Point** (`src/index.ts`)
   - Default export async function (`const OpencodeAgentTmux: Plugin`)
   - Loads config via `loadConfig(ctx.directory)` — validates with Zod
   - `detectServerUrl()` reads `OPENCODE_PORT` env or defaults to 4096
   - Guards against duplicate initialization via `isInitialized` boolean
   - Returns hooks with `name: 'opentmux'` + `event` handler delegating
     to `TmuxSessionManager.onSessionCreated()`
   - Re-exports types: `PluginConfig`, `TmuxConfig`, `TmuxLayout`

6. **Binary wrapper:** (`src/bin/opentmux.ts`)
   - Smart CLI that replaces `opencode` via shell alias
   - Launches OpenCode as a server, smartly choosing an available port

7. **Configuration Schema**
   - Zod-validated
   - Loaded from `{project}/opentmux.json` or `~/.config/opencode/opentmux.json`

   JSON Schema
   ```json
   {
     "enabled": true,
     "port": 4096,
     "layout": "main-vertical",
     "paneTitle": "🤖 {agentType}",
     "paneOptions": "-h -d"
   }
   ```

## Project Structure

```
opentmux/
├── package.json              # NPM metadata, scripts, dependencies
├── tsconfig.json             # TypeScript config (strict mode, ESNext)
├── tsup.config.ts            # Build config (ESM output, multi-entry)
├── opencode.json             # Local OpenCode plugin config
├── AGENTS.md                 # Agent instructions for this project
├── PLAN.md                   # Master plan
├── JOURNAL.md                # Master journal
├── TODOS.md                  # Task tracking
├── CODEBASE_REFERENCE.md     # Code reference
├── src/
│   ├── index.ts              # Plugin entry point (default export)
│   ├── bin/
│   │   └── opentmux.ts       # CLI binary wrapper
│   ├── tmux-session-manager.ts
│   ├── spawn-queue.ts
│   ├── zombie-reaper.ts
│   ├── config.ts
│   ├── layout.ts
│   ├── utils/
│   │   ├── tmux.ts
│   │   ├── logger.ts
│   │   ├── process.ts
│   │   ├── config-loader.ts
│   │   └── index.ts
│   ├── scripts/
│   │   ├── install.ts        # Postinstall: shell alias setup
│   │   └── update-plugins.ts # Background plugin updater
│   └── __tests__/
│       ├── config.test.ts
│       ├── example.test.ts
│       ├── layout.test.ts
│       ├── process.test.ts
│       ├── spawn-queue.test.ts
│       ├── tmux-close.test.ts
│       ├── tmux-session-manager.test.ts
│       ├── tmux.test.ts
│       └── zombie-reaper.test.ts
├── dist/                     # Build output
├── scripts/
│   ├── dev-setup.sh          # Local dev setup
│   ├── test-plugin.sh        # Manual integration test
│   └── test-multiport.sh     # Manual multi-port test
└── docs/
    ├── api.md
    ├── architecture.md
    ├── guide.md
    ├── installation.md
    ├── LOCAL_DEVELOPMENT.md
    └── tests.md
```

## Installation Instructions (for end user)

```bash
# 1. Clone/Navigate to plugin directory
cd <path-to-opentmux>

# 2. Install dependencies
bun install

# 3. Build the plugin
bun run build

# 4. Start OpenCode with tmux support
tmux
opencode --port 4096
```

## Configuration

Edit `~/.config/opencode/opentmux.json`:

or for backward compatibility

Edit `~/.config/opencode/opencode-agent-tmux.json`:

```json
{
  "enabled": true,
  "port": 4096,
  "layout": "main-vertical",
  "paneTitle": "🤖 {agentType}",
  "autoClose": true
}
```

## Current Plan Item: Fix duplicate pane spawning for subagent swarms

**Status:** ✅ Complete

When OpenCode launches a swarm of agents, each subagent spawns TWO `session.created` events (tool-call wrapper + actual agent). Both created panes.

**Fix:** Added parent-child session tracking. When a session ID appears as a `parentID` in a subsequent event, its pane is closed/discarded — it's an intermediate/transient session, not a real subagent.

**Changes:**
- `src/tmux-session-manager.ts`: Added `parentSessions` Set, parent-tracking in `onSessionCreated`, spawn-completion parent check
- `src/__tests__/tmux-session-manager.test.ts`: 6 new test scenarios covering both timing paths
- 74/75 tests pass (1 pre-existing flaky failure), typecheck clean

## Plan Item: Additional test coverage for dedup edge cases

**Status:** ✅ Complete

| Scenario | File | Status |
|----------|------|--------|
| Parent spawn fails → child arrives | `tmux-session-manager.test.ts` | ✅ |
| Rapid burst (5 children) for same parent | `tmux-session-manager.test.ts` | ✅ |
| Plugin event handler pattern delegation | `tmux-session-manager.test.ts` | ✅ |
| Triple concurrency (GP/parent/child in-flight) | `tmux-session-manager.test.ts` | ✅ |

**Gotchas:**
- `mock.module` is process-wide in Bun — integration tests co-located
- `import('../index')` hangs in test context — avoided it
- Event handler async deadlock — store promise, resolve controller, then await

**Results:** 78/79 tests pass (1 pre-existing flaky zombie-reaper timeout), typecheck clean

## Plan Item: Code review follow-up cleanup (N1, N2, W2, W3)

**Status:** ✅ Complete

Addressed code review findings from the review workflow. All non-functional changes — comments and file naming only:

| Item | Severity | File | Change |
|------|----------|------|--------|
| N1 | Nit | `src/tmux-session-manager.ts` | Grouped comment for 3-layer dedup strategy |
| W3 | Warning | `src/tmux-session-manager.ts` | Guard comment explaining intentional skip |
| W2 | Warning | `src/__tests__/tmux-session-manager.test.ts` | Replaced stream-of-consciousness comments |
| N2 | Nit | `src/__tests__/plugin-entry.test.ts` | Renamed to `plugin-entry-empty.test.ts` |

**Results:** 78/79 tests pass (1 pre-existing flaky), typecheck clean.

## Plan Item: Fix unhandled closeTmuxPane errors (C1 + S2)

**Status:** ✅ Complete

Inconsistent error handling for `closeTmuxPane`. Two call sites (Path B, `closeSession`) lack `.catch()` — if `closeTmuxPane` throws, child events are silently dropped or sessions never removed from tracking.

| Item | Severity | File | Change |
|------|----------|------|--------|
| C1 | Critical | `src/tmux-session-manager.ts` | Add `.catch()` with structured logging to Path B and `closeSession` |
| S2 | Suggestion | `src/__tests__/tmux-session-manager.test.ts` | Add test: `closeTmuxPane` rejection during dedup doesn't lose child event |

**Results:** 79/80 tests pass (1 pre-existing flaky), typecheck clean.

## Plan Item: Prune unbounded parentSessions Set (W1)

**Status:** ✅ Complete

`parentSessions: Set<string>` accumulates entries via `add()` but never prunes. Add `delete()` calls after pane close/discard to prevent unbounded growth over long-running sessions.

| Location | Prune |
|----------|-------|
| Path B (~line 123) | `this.parentSessions.delete(parentId)` after pane closed |
| Path A (~line 154) | `this.parentSessions.delete(sessionId)` after pane discarded |

## Plan Item: Extract helper methods (S1 + S4)

**Status:** ✅ Complete

Two mechanical refactoring items from code review suggestions — zero behavioral change:

1. **S4 — `markParentAndCloseExistingPane()`**: Extracted inline parent-detection block into a private async method with early-return guards
2. **S1 — `stopPollingIfEmpty()`**: Extracted `if (sessions.size === 0) { stopPolling(); }` into a named helper, reused across extracted method and `closeSession`

**Changes:** `src/tmux-session-manager.ts` — +2 private methods, -1 inline block, -2 inline conditionals

**Tests:** 79/80 pass (1 pre-existing flaky), typecheck clean
