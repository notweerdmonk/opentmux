# AGENTS.md

Instructions for AI agents working on opentmux.

## Project Overview

An OpenCode plugin providing smart tmux integration for viewing agent execution in real-time. Built as a TypeScript Node.js ESM package with Bun tooling (tsup for bundling, Zod for config validation).

**Core Technologies:**
- TypeScript (ESNext, strict mode)
- Node.js runtime with ESM modules
- Bun for development tooling
- tsup for bundling
- Zod for runtime validation

## Build, Lint, and Test Commands

### Build Commands
```bash
# Full build (compile TypeScript to dist/)
bun run build

# Watch mode for development
bun run dev

# Type checking only (no emit)
bun run typecheck
```

### Testing

No `npm test` script exists. All unit tests use `bun:test` with `mock`, `spyOn`.

```bash
# Test suite
bun test             # runs src/__tests__/*.test.ts (uses bun:test)
```

```bash
# Integration test scripts
./test-plugin.sh      # Test plugin integration
./test-multiport.sh   # Test multi-port support

# Manual test after local build
./scripts/dev-setup.sh         # Sets up local development
source ~/.zshrc                # Reload shell config
opencode                       # Run to test integration
```

### Linting
**Note:** No ESLint/Prettier configured. Code quality enforced through TypeScript strict mode.

```bash
# Type checking serves as primary linting
bun run typecheck
```

## Architecture

Two entrypoints serve different roles:

**`src/index.ts`** — The OpenCode plugin (default export). Loaded by OpenCode at runtime via the plugin system. Listens for `session.created` events, spawns tmux panes running `opencode attach <serverUrl> --session <id>`, polls session status, and closes panes when sessions end.

**`src/bin/opentmux.ts`** — The CLI binary (`dist/bin/opentmux.js`, declared in `package.json` `"bin"`). A smart wrapper that replaces the `opencode` command (via shell alias `alias opencode='opentmux'` set by postinstall). It finds an available port (4096–4106), optionally reclaims stuck ports, and spawns `opencode --port <port>`. If not already inside tmux, it creates a new tmux session.

**Key flow:** `opencode` (aliased) → `opentmux` (binary) → finds port → spawns `opencode` (real binary) → OpenCode loads the plugin → plugin receives `session.created` → spawns tmux pane → polls → cleanup.

## Code Style Guidelines

### Import Statements

**Order and Grouping:**
1. Type-only imports first (using `import type`)
2. Node.js built-in modules (with `node:` prefix)
3. External dependencies
4. Relative imports (local modules)
5. Group with blank lines between categories

**Examples:**
```typescript
// ✅ Good
import type { Plugin } from './types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { TmuxSessionManager } from './tmux-session-manager';
import { log, startTmuxCheck } from './utils';

// ❌ Bad - missing node: prefix, wrong order
import { z } from 'zod';
import * as fs from 'fs';
import { log } from './utils';
import type { Plugin } from './types';
```

**Rules:**
- Always use `node:` prefix for built-in modules (`node:fs`, `node:path`, `node:child_process`)
- Omit `.ts` extensions in relative imports
- Use named imports when importing specific exports
- Use `import type` for type-only imports

### Naming Conventions

| Type | Convention | Examples |
|------|------------|----------|
| **Files** | kebab-case | `tmux-session-manager.ts`, `opentmux.ts` |
| **Functions/Variables** | camelCase | `spawnTmuxPane`, `isInsideTmux`, `serverUrl` |
| **Classes** | PascalCase | `TmuxSessionManager` |
| **Types/Interfaces** | PascalCase | `PluginConfig`, `TmuxLayout` |
| **Constants** | UPPER_SNAKE_CASE | `POLL_INTERVAL_MS`, `SESSION_TIMEOUT_MS` |
| **Enums** | PascalCase | `TmuxLayoutSchema` (Zod enum) |

**No Interface Prefix:** Avoid `I` prefix (use `PluginConfig`, not `IPluginConfig`)

### TypeScript Patterns

**Strict Typing (Required):**
```typescript
// ✅ Good - explicit types
function loadConfig(directory: string): PluginConfig {
  const configPaths: string[] = [
    path.join(directory, 'opencode-agent-tmux.json'),
  ];
  // ...
}

// ❌ Bad - implicit any
function loadConfig(directory) {
  const configPaths = [...];
  // ...
}
```

**Zod for Runtime Validation:**
```typescript
// ✅ Good - use Zod schemas for config validation
export const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(4096),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// Parse and validate
const result = PluginConfigSchema.safeParse(parsed);
if (result.success) {
  return result.data;
}
```

**Type Exports:**
```typescript
// ✅ Good - export both value and type
export const TmuxLayoutSchema = z.enum(['main-horizontal', 'main-vertical']);
export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>;

// ✅ Good - re-export types from index
export type { PluginConfig, TmuxConfig, TmuxLayout } from './config';
```

### Error Handling

**Async Error Patterns:**
```typescript
// ✅ Good - try/catch with proper logging
try {
  const content = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(content);
  return PluginConfigSchema.parse(parsed);
} catch (err) {
  log('[plugin] config load error', { configPath, error: String(err) });
  return defaultConfig;
}

// ✅ Good - graceful degradation
const sessions = await fetchSessions().catch(() => []);
```

**Error Propagation:**
- Let errors bubble up in async functions (throw/rethrow)
- Catch at appropriate boundaries (plugin entry points)
- Log errors with structured context

### Async/Await Guidelines

```typescript
// ✅ Good - proper async/await
async function closePanes(panes: string[]): Promise<void> {
  await Promise.all(panes.map(pane => closePane(pane)));
}

// ✅ Good - sequential when order matters
async function setup(): Promise<void> {
  await initializeConfig();
  await startTmuxManager();
}

// ❌ Bad - unnecessary await in return
async function getData(): Promise<Data> {
  return await fetchData(); // Just use: return fetchData();
}
```

## Configuration Files

**Plugin Config Location:**

1. `{project_dir}/opentmux.json`                    _(Primary)_
2. `~/.config/opencode/opentmux.json`               _(Global)_

**Backward compatible configuration files:**

1. `{project_dir}/opencode-agent-tmux.json`         _(Primary)_
2. `~/.config/opencode/opencode-agent-tmux.json`    _(Global)_

Full schema in `src/config.ts` (`PluginConfigSchema`). Defaults: `enabled: true`, `port: 4096`, `layout: main-vertical`, `main_pane_size: 60`, `auto_close: true`. Additional fields: `spawn_delay_ms` (300), `max_retry_attempts` (2), `layout_debounce_ms` (150), `max_agents_per_column` (3), `rotate_port` (false), `max_ports` (10), and reaper options.

## Build Configuration Files

- **tsconfig.json**: TypeScript compiler (strict mode, ESNext target)
- **tsup.config.ts**: Build configuration (ESM output, multiple entries)
- **package.json**: NPM metadata, scripts, dependencies

## Logs

| Component | Path |
|-----------|------|
| Plugin runtime | `/tmp/opencode-agent-tmux.log` |
| Binary wrapper | `/tmp/opentmux.log` |

Both append-only, silently swallow errors if write fails.

## Testing

- **Unit tests:** `bun test` — all in `src/__tests__/`. Mock-heavy (mocks `spawnAsync`, `fetch`, `setInterval`, etc.).
- **Manual integration:** `scripts/dev-setup.sh` then run `opencode` in a terminal.
- **Test scripts** (`test-plugin.sh`, `test-multiport.sh`) are manual/integration only; not automated.

## Release

GitHub Actions handles releases automatically:
- Push to `main` triggers `release.yml` (release-please → creates PR/Release).
- GitHub Release published triggers `publish.yml` (`npm publish --access public --provenance` via OIDC).
- **Do not** run `npm publish` manually.
- Tags with `release-please`, not manual `git tag`.

## Gotchas

- **`src/utils/layout.ts`** is dead code — never imported by any production file. All imports use `src/layout.ts`.
- **`scripts/dev-setup.sh`** checks for `dist/bin/opencode-tmux.js` but the actual output is `dist/bin/opentmux.js`. The script is stale.
- **`test-multiport.sh`** has hardcoded paths from the author's machine; not runnable as-is.
- The postinstall script (`src/scripts/install.ts`) writes shell aliases to `~/.zshrc`/`~/.bashrc`/`~/.config/fish/config.fish` using marker blocks (`# >>> opentmux >>>`). It also sets `export OPENCODE_PORT=4096`. To disable automated plugin updates, set `OPENCODE_TMUX_DISABLE_UPDATES=1`.
- Port range is `config.port + max_ports` (default: 4096–4106). The binary attempts to reclaim stuck ports by killing orphaned `opencode` processes.
- The plugin guards against duplicate initialization via `isInitialized` boolean and tracks pending sessions via `pendingSessions` Set to avoid race conditions.

## Release Process

This project uses GitHub Actions for automated releases. **Do NOT run `npm publish` manually.**

**Workflow behavior (from `.github/workflows/publish-npm.yml`):**
- Trigger: Push of tag `v*`
- Build: `bun install` + `bun run build`
- Publish: `npm publish --access public` via `NPM_TOKEN` secret

### Steps:
1. **Make changes, commit with conventional commits:**
   ```bash
   git commit -m "feat: add new feature"  # Minor version bump
   git commit -m "fix: resolve bug"       # Patch version bump
   git commit -m "feat!: breaking change" # Major version bump
   ```

2. **Update version in package.json:**
   - Patch (1.1.x): Bug fixes only
   - Minor (1.x.0): New features, backward compatible
   - Major (x.0.0): Breaking changes

3. **Commit, tag, and push:**
   ```bash
   git add package.json
   git commit -m "Bump version to X.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```

4. **Create GitHub release (optional, for documentation):**
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes "Release notes..."
   ```

5. **Verify:**
   - Check https://github.com/AnganSamadder/opentmux/actions
   - Verify npm: `npm view opentmux version`

## Local Development

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for contributor setup.

**Quick Start:**
```bash
./scripts/dev-setup.sh  # Initial setup
source ~/.zshrc         # Reload shell
bun run dev            # Watch mode
opencode               # Test in separate terminal
```
