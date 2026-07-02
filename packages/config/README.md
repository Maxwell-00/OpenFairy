# @fairy/config

Fairy configuration is layered and schema-validated at boot:

1. Built-in `defaults.yaml`.
2. User config. An explicit `--config <path>` flag or `FAIRY_CONFIG` env var wins; otherwise use `%APPDATA%\fairy\fairy.yaml` on Windows, or `$XDG_CONFIG_HOME/fairy/fairy.yaml` / `~/.config/fairy/fairy.yaml` on macOS/Linux.
3. Workspace config: first `fairy.workspace.yaml` found while walking up from `cwd`, stopping after the repo root (`.git` or `pnpm-workspace.yaml`) or filesystem root.
4. Session overrides supplied by the caller.

Objects deep-merge in that order. Arrays and scalars replace earlier values.

`secret://name` values are validated as references only. They are never resolved by this package; edge adapters such as the M0 dev gateway may resolve them in a deliberately narrow, dev-only way.

`gateway.data_dir` defaults at the gateway edge to `%LOCALAPPDATA%\fairy` on Windows, or `$XDG_DATA_HOME/fairy` / `~/.local/share/fairy` on macOS/Linux.
