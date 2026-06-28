# API Reference

## Plugin Entry Point (`src/index.ts`)

The default export is a [`Plugin`](https://opencode.ai/docs/plugins) function loaded by OpenCode at runtime.

```typescript
import type { Plugin } from '@opencode-ai/plugin';

const OpencodeAgentTmux: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory);
  const serverUrl = ctx.serverUrl?.toString() || detectServerUrl();
  const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig, serverUrl);

  return {
    name: 'opentmux',
    event: async (input) => {
      await tmuxSessionManager.onSessionCreated(input.event);
    },
  };
};

export default OpencodeAgentTmux;
```

### Plugin Event Hooks

| Hook | Description |
|------|-------------|
| `event` | Receives all OpenCode events; the handler forwards `session.created` events to `TmuxSessionManager.onSessionCreated()` |

### Exported Types

```typescript
export type { PluginConfig, TmuxConfig, TmuxLayout } from './config';
```

---

## TmuxSessionManager (`src/tmux-session-manager.ts`)

The central class that manages session-to-pane mapping.

### Constructor

```typescript
constructor(
  ctx: PluginContext,
  config: TmuxConfig,
  serverUrl: string
)
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `ctx` | `PluginContext` | OpenCode plugin context (provides `directory`, `serverUrl`) |
| `config` | `TmuxConfig` | Validated tmux configuration |
| `serverUrl` | `string` | Base URL of the OpenCode server |

### Methods

#### `onSessionCreated`

```typescript
async onSessionCreated(event: {
  type: string;
  properties?: { info?: { id?: string; parentID?: string; title?: string } };
}): Promise<void>
```

Handles a `session.created` event. The method:

1. Filters out events without a valid `id` and `parentID` (root sessions get no pane)
2. Checks existing dedup layers (`pendingSessions`, `sessions`) to avoid duplicate processing
3. If the event's `parentID` identifies a session that already has a tracked pane, closes the parent's pane (Path B)
4. Enqueues a pane spawn for the session via `SpawnQueue`
5. After spawn completes, checks if the session is in `parentSessions` (Path A) — if so, discards the pane

#### `closeSession`

```typescript
async closeSession(sessionId: string, reason: string): Promise<void>
```

Closes a session's pane and removes it from tracking.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` | Session to close |
| `reason` | `string` | Log reason (e.g. "completed", "orphaned") |

#### `cleanup`

```typescript
async cleanup(): Promise<void>
```

Stops polling, drains the spawn queue, and closes all tracked panes. Called when the plugin is unloaded.

---

## SpawnQueue (`src/spawn-queue.ts`)

Sequential queue for pane creation.

### Interface

```typescript
interface SpawnRequest {
  sessionId: string;
  title: string;
  timestamp: number;
  retryCount: number;
}

interface SpawnResult {
  success: boolean;
  paneId?: string;
}
```

### Options

```typescript
interface SpawnQueueOptions {
  spawnFn: SpawnFn;
  spawnDelayMs?: number;       // default: 300
  maxRetries?: number;          // exponential backoff
  staleThresholdMs?: number;    // default: 30000 (30s)
  onQueueUpdate?: (pendingCount: number) => void;
  onQueueDrained?: () => void;
  logFn?: (message: string, data?: unknown) => void;
}
```

### Methods

#### `enqueue`

```typescript
async enqueue(sessionId: string, title: string): Promise<SpawnResult>
```

Adds a session to the spawn queue. If the same `sessionId` is already queued, it is coalesced (duplicates are skipped). Returns a promise that resolves with the spawn result once the item is processed.

#### `drain`

```typescript
async drain(): Promise<void>
```

Clears all pending items from the queue. Items that are currently being processed are allowed to complete.

#### `getPendingCount`

```typescript
getPendingCount(): number
```

Returns the number of items currently in the queue.

---

## ZombieReaper (`src/zombie-reaper.ts`)

Background process that cleans up orphaned `opencode attach` processes.

### Options

```typescript
interface ReaperOptions {
  enabled: boolean;                  // Enable/disable the reaper
  intervalMs: number;                // Polling interval
  minZombieChecks: number;           // Detections required before killing
  gracePeriodMs: number;             // Grace period before kill
  autoSelfDestruct?: boolean;        // Self-destruct when server abandoned
  selfDestructTimeoutMs?: number;    // Timeout (default: 1h)
  maxPorts?: number;                 // Port range to scan
}
```

### Methods

#### `start`

```typescript
start(serverUrl: string): void
```

Starts the background polling loop. Scans for orphaned `opencode attach` processes at the configured interval.

#### `stop`

```typescript
stop(): void
```

Stops the reaper.

#### `reapAll`

```typescript
static async reapAll(serverUrl: string, options: ReaperOptions): Promise<void>
```

Static method for manual reaping. Used by the `opentmux --reap` CLI command.

---

## Binary CLI (`src/bin/opentmux.ts`)

The smart wrapper CLI that replaces the `opencode` command.

### Usage

```bash
opentmux [options]
opentmux --reap
```

### Flags

| Flag | Description |
|------|-------------|
| `--reap` | Run zombie reaper manually (kills orphaned `opencode attach` processes) |
| `--help` | Show help |

### Behavior

1. Loads config from `{project}/opentmux.json` or `~/.config/opencode/opentmux.json`
2. Finds an available port in the range `config.port` to `config.port + config.maxPorts` (default: 4096–4106)
3. If `rotate_port` is enabled, starts from a pseudo-random offset
4. Attempts to reclaim stuck ports by checking for orphaned `opencode` processes
5. If not already inside tmux, creates a new tmux session
6. Spawns `opencode --port <port>` with the selected port

---

## Config Schema (`src/config.ts`)

Zod-validated configuration loaded from the config chain.

### Schema

```typescript
export const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(4096),
  layout: z.enum(['main-horizontal', 'main-vertical']).default('main-vertical'),
  main_pane_size: z.number().default(60),
  auto_close: z.boolean().default(true),
  spawn_delay_ms: z.number().default(300),
  max_retry_attempts: z.number().default(2),
  layout_debounce_ms: z.number().default(150),
  max_agents_per_column: z.number().default(3),
  rotate_port: z.boolean().default(false),
  max_ports: z.number().default(10),
  reaper_enabled: z.boolean().default(true),
  reaper_interval_ms: z.number().default(30000),
  reaper_min_zombie_checks: z.number().default(3),
  reaper_grace_period_ms: z.number().default(10000),
  reaper_auto_self_destruct: z.boolean().default(true),
  reaper_self_destruct_timeout_ms: z.number().default(3600000),
});
```

### Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `port` | number | `4096` | OpenCode server port |
| `layout` | string | `"main-vertical"` | Tmux layout (`main-horizontal`, `main-vertical`) |
| `main_pane_size` | number | `60` | Size of the main pane (20-80) |
| `auto_close` | boolean | `true` | Auto-close panes when sessions complete |
| `spawn_delay_ms` | number | `300` | Delay between spawns (ms) |
| `max_retry_attempts` | number | `2` | Retry attempts on spawn failure |
| `layout_debounce_ms` | number | `150` | Debounce for layout refresh (ms) |
| `max_agents_per_column` | number | `3` | Max agents per column in multi-column layout |
| `rotate_port` | boolean | `false` | Rotate starting port |
| `max_ports` | number | `10` | Port range size |
| `reaper_enabled` | boolean | `true` | Enable zombie reaper |
| `reaper_interval_ms` | number | `30000` | Reaper polling interval (ms) |
| `reaper_min_zombie_checks` | number | `3` | Detections before killing |
| `reaper_grace_period_ms` | number | `10000` | Grace period before kill (ms) |
| `reaper_auto_self_destruct` | boolean | `true` | Self-destruct on server abandon |
| `reaper_self_destruct_timeout_ms` | number | `3600000` | Self-destruct timeout (1h) |

### Loading Order

1. `{project_dir}/opentmux.json` (local, highest priority)
2. `~/.config/opencode/opentmux.json` (global, fallback)

---

## Tmux Utilities (`src/utils/tmux.ts`)

Helper functions for tmux interaction.

```typescript
async function spawnTmuxPane(
  sessionId: string,
  title: string,
  config: TmuxConfig,
  serverUrl: string
): Promise<string | undefined>

async function closeTmuxPane(
  paneId: string,
  layout?: string
): Promise<boolean>

function isInsideTmux(): boolean

async function checkServerHealth(serverUrl: string): Promise<boolean>
```

---

## Process Utilities (`src/utils/process.ts`)

Low-level process management.

```typescript
async function safeExec(
  command: string,
  args?: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number | null }>

async function getListeningPids(port: number): Promise<number[]>

async function findProcessIds(
  commandMatch: string,
  argsFilter?: string[]
): Promise<number[]>

async function safeKill(pid: number, signal?: string): Promise<boolean>
```
