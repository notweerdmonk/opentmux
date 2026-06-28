# User Guide

## Overview

OpenTmux enhances OpenCode with automatic tmux pane management. When OpenCode spawns subagents, OpenTmux creates a tmux pane for each agent, streaming their output in real-time. When agents complete, panes are automatically cleaned up.

## Quick Start

### 1. Install

```bash
npm install -g opentmux
```

The postinstall script automatically sets `alias opencode='opentmux'` and `export OPENCODE_PORT=4096` in your shell config.

### 2. Enable the plugin

Add `"opentmux"` to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "opentmux"
  ]
}
```

### 3. Run

Restart your terminal and run:

```bash
opencode
```

If you're not already inside tmux, the wrapper creates a new tmux session for you. When you spawn agents, their output appears in dedicated tmux panes.

## Usage Modes

### Inside an Existing tmux Session

If you're already inside tmux, `opencode` starts normally and the plugin creates panes within your current session. Each subagent gets its own pane with a title showing the agent type.

### Outside tmux

If you run `opencode` outside tmux, the binary wrapper automatically:
1. Creates a new tmux session
2. Starts OpenCode inside it
3. The plugin takes over pane management from there

### Running Multiple OpenCode Instances

When running multiple OpenCode instances (e.g., different projects), each needs a unique port. The wrapper automatically finds available ports in the 4096–4106 range:

```bash
# Terminal 1 — uses port 4096
opencode

# Terminal 2 — uses port 4097 (first available)
opencode

# Terminal 3 — uses port 4098
opencode
```

Stuck ports (orphaned `opencode` processes) are automatically reclaimed.

## Configuration

Create `~/.config/opencode/opentmux.json` to customize behavior:

```json
{
  "enabled": true,
  "port": 4096,
  "layout": "main-vertical",
  "main_pane_size": 60,
  "auto_close": true,
  "spawn_delay_ms": 300,
  "max_agents_per_column": 3
}
```

### Layout Options

| Layout | Description |
|--------|-------------|
| `main-vertical` | Main chat pane on the left, agent panes stacked on the right (default) |
| `main-horizontal` | Main chat pane on top, agent panes in a row below |

Example of a multi-column setup (3 agents per column):

```json
{
  "layout": "main-vertical",
  "max_agents_per_column": 3
}
```

With 6 agents, this creates 2 columns of 3 panes each on the right side.

### Reaper Configuration

The zombie reaper cleans up orphaned `opencode attach` processes. Customize its behavior:

```json
{
  "reaper_enabled": true,
  "reaper_interval_ms": 30000,
  "reaper_min_zombie_checks": 3,
  "reaper_grace_period_ms": 10000,
  "reaper_auto_self_destruct": true,
  "reaper_self_destruct_timeout_ms": 3600000
}
```

| Option | Description |
|--------|-------------|
| `reaper_enabled` | Enable background orphan cleanup |
| `reaper_interval_ms` | How often to scan for orphans (default: 30s) |
| `reaper_min_zombie_checks` | Consecutive detections required before killing (default: 3) |
| `reaper_grace_period_ms` | Grace period before kill (default: 10s) |
| `reaper_auto_self_destruct` | Stop reaper after server is abandoned (default: true) |
| `reaper_self_destruct_timeout_ms` | Self-destruct timeout (default: 1h) |

## Manual Reaping

If you suspect orphaned processes are accumulating, run the reaper manually:

```bash
opentmux --reap
```

This scans for `opencode attach` processes whose parent sessions have ended and kills them.

## How Parent-Session Dedup Works

When OpenCode spawns subagents via the `task`/`delegate` tools, it creates two sessions per subagent:

1. A **tool-call wrapper** session (intermediate/transient)
2. The **actual subagent** session

Without dedup, both get tmux panes, creating one redundant pane per subagent. For a swarm of 3 agents, you'd see 7 panes (main + 3 wrappers + 3 agents) instead of 4.

OpenTmux (v1.5.8+) automatically detects this pattern:

- When a session's `id` appears as a `parentID` in a subsequent event, it's identified as an intermediate session
- The intermediate session's pane is either discarded (before it appears) or closed immediately
- Only the leaf sessions (actual subagents) retain their panes

No configuration is needed — this works automatically.

## Understanding Logs

Logs are written to two files:

### Plugin Logs (`/tmp/opencode-agent-tmux.log`)

```
[plugin] initialized { tmuxConfig: {...}, directory: "/project", serverUrl: "http://localhost:4096" }
[plugin] session.created { sessionId: "ses_abc123", parentId: "ses_root" }
[plugin] spawning pane for session { sessionId: "ses_abc123" }
[plugin] spawned pane %106 for session ses_abc123
```

### Binary Logs (`/tmp/opentmux.log`)

```
[wrapper] port 4096 is available
[wrapper] spawned: opencode --port 4096 (pid: 12345)
```

## Troubleshooting

### No Panes Appearing

1. Verify you're inside tmux: `echo $TMUX`
2. Check the plugin is loaded: `cat /tmp/opencode-agent-tmux.log`
3. Verify the plugin entry in your `opencode.json`
4. Ensure OpenCode port matches: check `OPENCODE_PORT` in your env

### Duplicate Panes

If you're still seeing duplicate panes (one per subagent plus extras):

1. Check the log for two "initialized" messages — this means OpenCode loaded the plugin twice (see [duplicate loading](#duplicate-plugin-loading))
2. Verify you're running the latest version: `npm update -g opentmux`

### Duplicate Plugin Loading

If the log shows two initialization messages for the same plugin, OpenCode is loading it from two different sources. Check your OpenCode config for duplicate entries:

```json
{
  "plugin": [
    "opentmux",           // ← npm package
    "/path/to/opentmux"   // ← local path (duplicate!)
  ]
}
```

Remove one. If you're developing locally, use only the local path.

### Stuck Ports

If you see "port in use" errors:

```bash
# Manually trigger cleanup
opentmux --reap

# Or kill orphaned opencode processes
pkill -f "opencode.*attach"
```

### Config Not Loading

If custom config isn't being applied:

1. Verify the file path: `~/.config/opencode/opentmux.json`
2. Check for JSON syntax errors
3. Check logs — the plugin logs its config on initialization

## Uninstallation

See [Uninstallation](../README.md#-uninstallation) in the README for complete instructions.
