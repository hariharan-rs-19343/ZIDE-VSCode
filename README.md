# ZIDE for VS Code

Tomcat server management, deploy-sync with hot-swap, deployment config patching, and new project wizard for ZIDE development. Full feature parity with the IntelliJ ZIDE plugin.

## Features

- **Server Management** — Add, edit, remove, start, stop, restart Tomcat servers from the Activity Bar
- **Debug Support** — One-click remote debug attach with hot-code replace
- **Deploy-Sync** — Automatic deployment on file save (`.java` class copy + hot-swap, resource files via ANT hooks)
- **Config Patching** — Auto-patches `server.xml`, `web.xml`, `configuration.properties`, `persistence-configurations.xml`, and `security-properties.xml`
- **New Project Wizard** — Create projects from CMTool API (clone, build download, WAR extraction, ANT hooks, auto-configure)
- **Deployment Updates** — Download remote builds or use local zips to update deployments
- **Deployment Properties** — Edit host, IAM, ports, database configuration in one flow
- **Build Integration** — Run ANT builds with project-aware properties
- **Application Logs** — Tail application log files directly in VS Code

## Requirements

- **macOS or Linux** (Windows is not supported)
- **Java JDK** installed and available
- **Apache Tomcat** installation
- **Apache ANT** (for builds and hooks)

### Recommended Extensions

- [Language Support for Java](https://marketplace.visualstudio.com/items?itemName=redhat.java) — Auto-compilation on save
- [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) — Hot-code replace support

## Getting Started

1. Install the extension
2. Open the **ZIDE** panel in the Activity Bar
3. Click **+** to add a server (auto-detect from project or manual configuration)
4. Use `Ctrl+Shift+I` to run or `Ctrl+Shift+D` to debug

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+I` | Run Server |
| `Ctrl+Shift+D` | Debug Server |
| `Ctrl+Shift+.` | Stop Server |
| `Ctrl+Shift+B` | Build |
| `Ctrl+Shift+L` | Application Logs |
| `Ctrl+Shift+U` | Local Build |
| `Ctrl+Shift+Alt+U` | Custom Build |

## Extension Settings

| Setting | Description |
|---------|-------------|
| `zide.cmToolAuthToken` | CMTool API private token for project creation |
| `zide.wgetUsername` | Username for build downloads |
| `zide.gitPath` | Path to git executable (default: `git`) |
| `zide.gitUsername` | Git username for repository operations |
| `zide.zohoRepoUsername` | Zoho repository username |
| `zide.customBuildUrl` | Custom build URL for remote deployment updates |

Passwords are stored securely via VS Code's SecretStorage (OS keychain-backed).

## Commands

All commands are available via the Command Palette (`Cmd+Shift+P`) under the **ZIDE** category:

- `ZIDE: Run Server`
- `ZIDE: Debug Server`
- `ZIDE: Stop Server`
- `ZIDE: Restart Server`
- `ZIDE: Build`
- `ZIDE: Add Server`
- `ZIDE: Edit Server`
- `ZIDE: Remove Server`
- `ZIDE: New Project`
- `ZIDE: Update Deployment`
- `ZIDE: Deployment Properties`
- `ZIDE: Application Logs`

## Project Structure

The extension expects ZIDE projects to have:

```
project-root/
├── .zide_resources/
│   ├── service.xml          # Service definitions
│   └── zide_properties.xml  # Environment properties
├── Zide.properties          # Module-level build/deploy config
└── ...
```

## License

Proprietary — Zoho Corporation
