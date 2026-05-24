# ZIDE for VS Code

Tomcat server management, deploy-sync with hot-swap, deployment config patching, and new project wizard for ZIDE development. Full feature parity with the IntelliJ ZIDE plugin and Eclipse ZIDE compatibility.

## Features

- **Server Management** — Add, edit, remove, start, stop, restart Tomcat servers from the Activity Bar
- **Debug Support** — One-click JPDA debug with automatic Java remote attach and hot-code replace
- **Deploy-Sync** — Automatic deployment on file save (`.java` class copy + hot-swap, resource files via ANT hooks)
- **Config Patching** — Auto-patches `server.xml`, `web.xml`, `configuration.properties`, `persistence-configurations.xml`, and `security-properties.xml` before every server start
- **New Project Wizard** — Create projects from CMTool API (branch selection, git clone, build download, WAR extraction, ANT hooks, deployment properties, auto-configure)
- **Deployment Updates** — 6-step deployment pipeline: stop server, extract build, extract ROOT.war as PARENT_SERVICE, run hooks, patch configs
- **Deployment Properties** — Edit host, IAM, ports, database configuration with IntelliJ-compatible XML format
- **Build Integration** — Run ANT builds from the project `build/` directory
- **Run Hooks** — Run individual or all ANT hooks (precreation, postcreation, zidemodule) with property validation
- **Application Logs** — View application log files from `Sas/logs/`
- **Uninstall Project** — Clean removal of server config, deployment folder, and optionally project directory
- **Auto-Configuration** — Auto-generates `.vscode/settings.json` (Java libraries), `launch.json`, and `tasks.json` on server setup
- **ZIDE Settings Panel** — Webview-based credentials manager with eye-toggle password fields and SecretStorage
- **Plugin Update Checker** — Checks GitHub releases for new versions on startup

## Requirements

- **macOS or Linux** (Windows is not supported)
- **Java JDK 17+** installed and available
- **Apache Tomcat** installation (auto-detected from deployment folder)
- **Apache ANT** (for builds and hooks)
- **Git** (for project creation)

### Recommended Extensions

- [Language Support for Java](https://marketplace.visualstudio.com/items?itemName=redhat.java) — Auto-compilation on save
- [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) — Hot-code replace and debug attach

## Getting Started

1. Install the extension
2. Open the **ZIDE** panel in the Activity Bar
3. Click **+** to add a server (auto-detect from `.zide_resources/` or manual configuration)
4. Use `Ctrl+Shift+I` to run or `Ctrl+Shift+D` to debug
5. Use the native VSCode Run/Debug dropdown (generated `launch.json`) for editor title bar buttons

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

## Settings

Credentials are managed in the **ZIDE Settings** panel (gear icon in Servers view):

- **CMTool** — Auth Token
- **Git** — Path, Username, Password
- **Wget** — Username, Password
- **Zoho Repository** — Username, Password

Passwords are stored securely via VS Code's SecretStorage (OS keychain-backed).

## Commands

All commands are available via the Command Palette (`Cmd+Shift+P`) under the **ZIDE** category:

| Command | Description |
|---------|-------------|
| `ZIDE: Run Server` | Start Tomcat server |
| `ZIDE: Debug Server` | Start in JPDA debug mode + attach debugger |
| `ZIDE: Stop Server` | Stop running server |
| `ZIDE: Restart Server` | Restart (preserves run/debug mode) |
| `ZIDE: Build` | Run ANT build from `build/` directory |
| `ZIDE: Add Server` | Auto-detect or manually configure server |
| `ZIDE: Edit Server` | Edit server name, ports, VM args |
| `ZIDE: Remove Server` | Remove server and mappings |
| `ZIDE: New Project` | Full project creation wizard |
| `ZIDE: Update Deployment` | Choose remote URL or local zip |
| `ZIDE: Custom Build` | Download and deploy from URL |
| `ZIDE: Local Build` | Deploy from local zip file |
| `ZIDE: Deployment Properties` | Edit deployment environment properties |
| `ZIDE: Application Logs` | View application log file |
| `ZIDE: Run Hooks` | Run ANT hooks (all or individual) |
| `ZIDE: Uninstall Project` | Remove project, server, and deployment |
| `ZIDE: Refresh Servers` | Port-probe all servers for actual status |
| `ZIDE: ZIDE Settings` | Open credentials settings panel |
| `ZIDE: Check for Updates` | Check GitHub for new plugin versions |

## Project Structure

The extension expects ZIDE projects to have:

```
project-root/
├── .zide_resources/
│   ├── service.xml              # Service definitions (ZIDE.* properties)
│   ├── zide_properties.xml      # Environment properties (IAM, DB, ports)
│   ├── repository.properties    # Repository path reference
│   ├── zide_build/              # Post-creation ANT hooks + hg_utils
│   │   ├── build.xml
│   │   ├── ant.properties
│   │   └── hg_utils/
│   └── zide_hook/               # Pre-creation + zidemodule ANT hooks
│       ├── build.xml
│       ├── ant.properties
│       └── hg_utils/
├── build/
│   └── build.xml                # ANT build script
├── src/main/java/               # Java source
└── .vscode/                     # Auto-generated on server setup
    ├── settings.json            # Java library references
    ├── launch.json              # Run/Debug configurations
    └── tasks.json               # ZIDE server tasks
```

## IntelliJ Plugin Compatibility

This extension is a full port of the [ZIDE IntelliJ Plugin](https://github.com/hariharan-rs-19343/ZIDE-Server). Both plugins use the same:

- `.zide_resources/` configuration format (`<zide><services><service>` XML)
- Deployment structure (`AdventNet/Sas/tomcat/webapps/`)
- ANT hook pipeline (precreation, postcreation, zidemodule)
- Property key conventions (`ZIDE.*` and `ZIDE_*`)
- Config patching logic (server.xml, web.xml, persistence, security)

Projects created in one IDE can be opened and run in the other.

## License

Proprietary — Zoho Corporation
