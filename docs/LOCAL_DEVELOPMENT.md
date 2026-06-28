# Local Development Setup

This guide is for contributors who want to develop and test `opentmux` locally.

## Quick Setup

```bash
# Clone the repository (if you haven't already)
git clone https://github.com/AnganSamadder/opentmux.git
cd opentmux

# Install dependencies
bun install

# Build the project
bun run build

# Run the development setup script
./scripts/dev-setup.sh
```

The `dev-setup.sh` script will:

1. Build the project
2. Create a symlink from your npm global bin to the local build
3. Configure your shell to use the local version

## Development Workflow

### Watch Mode

```bash
bun run dev
```

This runs `tsup` in watch mode, automatically rebuilding when you make changes.

### Manual Build

```bash
bun run build
```

### Type Checking

```bash
bun run typecheck
```

TypeScript strict mode is the primary linting tool — no ESLint or Prettier is configured.

### Testing

```bash
# Run the full test suite
bun test
```

All tests are in `src/__tests__/*.test.ts` and use `bun:test` with `mock`, `spyOn`, and controlled promises for async timing. There are 9 test files covering all major components.

## How It Works

### For End Users (Global Install)

When users run `npm install -g opentmux`:

1. The package is installed to npm's global `node_modules`
2. The `opentmux` binary is added to npm's global bin directory
3. The `postinstall` script automatically runs, which:
   - Detects the user's shell (bash/zsh/fish/powershell)
   - Adds `alias opencode='opentmux'` to their shell config
   - Sets `OPENCODE_PORT=4096`
   - Removes old aliases from previous versions
4. Users restart their terminal and run `opencode` to get tmux integration

### For Contributors (Local Development)

When you run `./scripts/dev-setup.sh`:

1. The project is built locally
2. A symlink is created: `npm-global-bin/opentmux` → `local-repo/dist/bin/opentmux.js`
3. Your shell alias (from a previous global install) now points to your local development version
4. Changes you make will be reflected after running `bun run build`

## Testing Changes

### Run Unit Tests

```bash
bun test
```

Tests are organized by component in `src/__tests__/`:

| Test file | Component |
|-----------|-----------|
| `tmux-session-manager.test.ts` | Parent-session dedup, session tracking, spawn queuing |
| `spawn-queue.test.ts` | Sequential queue processing, coalescing, retry |
| `zombie-reaper.test.ts` | Orphan process detection, grace period, self-destruct |
| `tmux.test.ts` | Tmux utility functions |
| `tmux-close.test.ts` | Pane closing and cleanup |
| `config.test.ts` | Config loading and validation |
| `layout.test.ts` | Tmux layout generation |
| `process.test.ts` | Process utilities |
| `example.test.ts` | Basic smoke test |

### Test the Binary

```bash
# Test help
opentmux --help

# Test launching opencode with tmux
opencode
```

### Test the Postinstall Script

```bash
# Run the install script directly
node dist/scripts/install.js
```

### Test the Plugin

1. Make sure the local build path is in your `opencode.json` plugin array
2. Run `opencode` and spawn an agent (like `explore` or `oracle`)
3. Check if tmux panes are created automatically

## Publishing

This project uses automated releases via GitHub Actions (release-please). **Do not run `npm publish` manually.**

### Release Process

1. Commit changes with conventional commits:
   ```bash
   git commit -m "feat: add new feature"  # Minor version bump
   git commit -m "fix: resolve bug"       # Patch version bump
   git commit -m "feat!: breaking change" # Major version bump
   ```

2. Push to `main` — release-please creates a release PR automatically
3. Merge the release PR — GitHub Actions publishes to npm

## Troubleshooting

### Symlink not working

```bash
# Check if symlink exists
ls -la $(npm config get prefix)/bin/opentmux

# Recreate symlink
./scripts/dev-setup.sh
```

### Changes not reflected

```bash
# Rebuild
bun run build

# Verify symlink points to your local version
which opentmux
```

### Alias not found

```bash
# Run install script manually
node dist/scripts/install.js

# Reload shell
source ~/.zshrc  # or ~/.bashrc
```
