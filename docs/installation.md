# Installation Guide

## Prerequisites

- **OpenCode** installed and configured
- **tmux** installed (`brew install tmux` on macOS, `sudo apt install tmux` on Linux, `winget install tmux` on Windows)
- **Node.js** or **Bun** runtime

## Install via npm (Recommended)

The quickest way to install opentmux:

```bash
npm install -g opentmux
```

This command:

1. Installs the package to npm's global `node_modules`
2. Adds the `opentmux` binary to npm's global bin directory
3. Runs the `postinstall` script, which:
   - Detects your shell (bash/zsh/fish/powershell)
   - Adds `alias opencode='opentmux'` to your shell config
   - Sets `export OPENCODE_PORT=4096`

### Enable the Plugin

Add `"opentmux"` to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "opentmux"
  ]
}
```

### Verify

Restart your terminal and run `opencode`. The plugin should automatically create tmux panes when agents spawn.

## Install from Source

For contributors or those who want the latest unreleased changes:

```bash
git clone https://github.com/AnganSamadder/opentmux.git
cd opentmux
bun install
bun run build
```

Then register the local build in your OpenCode config:

```json
{
  "plugin": [
    "/path/to/opentmux"
  ]
}
```

> **Note:** When installed from source, the shell alias (`alias opencode='opentmux'`) is not automatically configured. Run `node dist/scripts/install.js` manually, or set the alias yourself.

## Uninstallation

See the [Uninstallation section](../README.md#-uninstallation) in the README for detailed instructions on removing all layers of opentmux.
