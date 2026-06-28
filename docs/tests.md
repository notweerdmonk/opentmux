# Testing

## Test Runner

All tests use **`bun:test`** with the built-in Bun test runner. There is no Jest, Vitest, or other test framework.

```bash
# Run the full test suite
bun test

# Watch mode (re-runs on changes)
bun test --watch
```

## Test Files

Tests are colocated in `src/__tests__/` and mirror the source structure:

| Test file | Source tested | Coverage |
|-----------|---------------|----------|
| `tmux-session-manager.test.ts` | `tmux-session-manager.ts` | Session tracking, pane spawn/close, parent-session dedup (6 scenarios), event filtering, config passthrough, layout refresh |
| `tmux-session-manager.test.ts` | `tmux-session-manager.ts` | Session tracking, pane spawn/close, parent-session dedup (11 scenarios), event filtering, config passthrough, layout refresh, plugin event handler pattern |
| `spawn-queue.test.ts` | `spawn-queue.ts` | Sequential queuing, coalescing, retry logic, stale threshold, drain callback |
| `zombie-reaper.test.ts` | `zombie-reaper.ts` | Orphan detection, grace period, self-destruct, manual reap |
| `tmux.test.ts` | `utils/tmux.ts` | `spawnTmuxPane`, `closeTmuxPane`, `isInsideTmux` |
| `tmux-close.test.ts` | `utils/tmux.ts` (close path) | Pane closing, layout application, error handling |
| `config.test.ts` | `config.ts` | Zod schema validation, defaults, loading order |
| `layout.test.ts` | `layout.ts` | Layout string generation, multi-column distribution |
| `process.test.ts` | `utils/process.ts` | `safeExec`, `getListeningPids`, `findProcessIds`, `safeKill` |
| `example.test.ts` | (smoke test) | Basic project sanity check |

## Testing Patterns

### Mock-Heavy Approach

Tests mock external dependencies to avoid requiring tmux, a real OpenCode server, or actual processes:

```typescript
// Mock tmux utilities
mock.module('../utils/tmux', () => ({
  spawnTmuxPane: mock(() => Promise.resolve('pane1')),
  closeTmuxPane: mock(() => Promise.resolve(true)),
  isInsideTmux: mock(() => true),
}));
```

### Controlled Promises for Async Timing

Since the `SpawnQueue` introduces real delays (`spawn_delay_ms`), tests use controlled promises to simulate async timing:

```typescript
function createControlledPromise<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
```

This allows tests to control exactly when async operations complete, enabling precise testing of race conditions and timing-dependent behavior like parent-session dedup.

### SpyOn for Assertions

Tests use `spyOn` to verify that methods were called with expected arguments:

```typescript
const closeSpy = spyOn(utils, 'closeTmuxPane');
// ... trigger behavior ...
expect(closeSpy).toHaveBeenCalledWith('pane-parent');
```

## Test Coverage Areas

### Session Tracking

- Session is added to tracking after successful spawn
- Session is NOT added to tracking on spawn failure
- `pendingSessions` prevents duplicate processing of in-flight sessions
- `sessions` Map prevents re-processing of completed sessions

### Parent-Session Dedup (11 scenarios, v1.5.8+)

| # | Scenario | Verification |
|---|----------|--------------|
| 1 | Child arrives BEFORE parent's spawn completes (Path A) | Parent pane discarded (never tracked), child pane tracked |
| 2 | Child arrives AFTER parent has a pane (Path B) | Parent pane closed via `closeTmuxPane`, parent removed from sessions |
| 3 | Multiple children of same parent | Parent's pane closed exactly once, both children tracked |
| 4 | Deep nesting (A→B→C) | Grandparent unaffected, intermediate session pane closed |
| 5 | Leaf session (no children) | Normal tracking — no `closeTmuxPane` calls |
| 6 | Unrelated sessions (different parents) | Both tracked independently |
| 7 | Parent spawn fails → child arrives | `closeTmuxPane` never called, child tracked normally |
| 8 | Rapid burst (5 children) same parent | Parent pane closed once, all 5 children tracked |
| 9 | Plugin event handler pattern | Handler delegates events through TmuxSessionManager |
| 10 | Triple concurrency (GP/P/C in-flight) | Intermediate panes discarded, only leaf child tracked |
| 11 | `closeTmuxPane` rejection during dedup | Child event NOT lost despite error, error logged with context |

### Spawn Queue

- Items are processed sequentially in FIFO order
- Duplicate session IDs are coalesced (second enqueue resolves with the first's result)
- Retry on failure with exponential backoff
- Stale items (>30s) are skipped
- `onQueueDrained` fires when queue empties
- `drain()` clears pending items

### Zombie Reaper

- Scans for orphaned `opencode attach` processes
- Requires `minZombieChecks` detections before killing (false-positive protection)
- Respects `gracePeriodMs` before kill
- Verifies session status against server before killing
- `autoSelfDestruct` stops reaper after timeout
- Manual `reapAll` (static) works as CLI command

### Config

- Default values applied when fields are missing
- Schema validation rejects invalid values (e.g., negative port)
- Type inference works correctly (`z.infer<typeof PluginConfigSchema>`)

### Layout

- Correct layout string generation for `main-horizontal` and `main-vertical`
- Multi-column distribution with `max_agents_per_column`
- Agents distributed round-robin across columns

## Pre-existing Flaky Test

One test in `zombie-reaper.test.ts` (`reapAll kills zombies immediately without grace period`) is intermittently flaky due to a 5000ms timeout on external process spawning. This is unrelated to tmux session management and does not affect the core plugin behavior.
