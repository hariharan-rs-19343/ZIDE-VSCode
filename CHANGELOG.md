# Changelog

## [1.0.0] - 2026-05-24

### Added

- **Server Management**: Add, edit, remove Tomcat servers via Activity Bar tree view
- **Server Lifecycle**: Start, stop, restart servers with real-time output streaming
- **Debug Mode**: JPDA debug with `*:port` wildcard bind and automatic Java remote attach (2s delay, no debug port probing)
- **Hot-Code Replace**: Automatic hot-swap on `.java` file save when debugging
- **Deploy-Sync on Save**: Automatic file deployment on save
  - `.java` files: compiled class copied to `WEB-INF/classes/`
  - Resource files: matched against ANT hook tasks and auto-copy mappings from `Zide.properties`
- **Configuration Patching**: Pre-start patching of 5 deployment config files
  - `server.xml`: Context element, shutdown port, deployOnStartup
  - `web.xml`: JSP servlet for dynamic compilation
  - `configuration.properties`: DB driver, URL, vendor, credentials
  - `persistence-configurations.xml`: DBName, DSAdapter, StartDBServer
  - `security-properties.xml`: IAM server, service name, logout URL
- **New Project Wizard**: Full project creation with branch selection, CMTool API integration, git clone, build download/extract, WAR extraction, `.zide_resources` scaffolding, `zide_build/` and `zide_hook/` with hg_utils, deployment properties collection, post-creation hooks, and config patching
- **Update Deployment**: 6-step pipeline matching IntelliJ — stop server, copy + extract zip, extract ROOT.war as PARENT_SERVICE, extract other WARs, delete .war files, run 3 ANT hooks, patch configs. Works without a configured server (falls back to service.xml)
- **Custom Build**: Download from remote URL with wget credentials and deploy
- **Local Build**: Select local zip file and deploy with full pipeline
- **Deployment Properties**: Edit ZIDE properties with IntelliJ-compatible key names (`ZIDE.*`, `ZIDE_*`) and XML format (`<zide><services><service><properties>`)
- **Build Command**: Run ANT build in `build/` directory (matching IntelliJ — no explicit flags)
- **Run Hooks**: Run individual or all ANT hooks (precreation, postcreation, zidemodule) with required property validation and auto-insertion
- **Pre-Launch Hook**: Runs `preservicelaunch` ANT target before server start
- **Application Logs**: View `*application0.txt` from `Sas/logs/` with last 5000 lines
- **Uninstall Project**: Stop server, remove config, delete deployment, optionally delete project
- **Refresh Servers**: Port-probe all servers to detect actual running status
- **Plugin Update Checker**: Checks GitHub releases on activation with download notification
- **ZIDE Settings Panel**: Webview with grouped credential fields (CMTool, Git, Wget, Zoho Repo) and eye-toggle password visibility. Passwords stored via SecretStorage
- **Auto-Configuration on Server Setup**: Generates `.vscode/settings.json` (Java referenced libraries), `.vscode/launch.json`, and `.vscode/tasks.json`
- **Server Tree Filtering**: Only shows servers mapped to the current workspace
- **VM Arguments Resolution**: Reads `launch.vmarguments` from `Zide.properties`, substitutes `{PROPERTY_KEY}` placeholders, appends JRE 9+ and proxy args
- **IntelliJ-Compatible XML Format**: `service.xml` and `zide_properties.xml` use `<zide><services><service key="..."><properties>` structure
- **Tomcat Version Detection**: Auto-detects version from `catalina.jar` ServerInfo.properties
- **JRE Detection**: Auto-detects `JAVA_HOME` or `/usr/libexec/java_home` for `ZIDE.PROJECT_JRE_HOME`
- **Repository Properties**: Reads/writes `repositorypath` from `.zide_resources/repository.properties`
- **hg_utils Resolution**: Resolves shared build infrastructure from workspace `.antsetup/`, sibling projects, or generates stubs
- **ant.properties Copy**: Copies service and common ant.properties from sibling projects or `zide/deployment/` paths
- **Keyboard Shortcuts**: 7 keybindings for common operations
- **Toolbar**: Add Server, Refresh, App Logs, Settings buttons in ZIDE Servers view title
- **~/.wgetrc Check**: Warning on startup if credentials file is missing

### IntelliJ Plugin Parity

Feature-complete port of the [ZIDE IntelliJ Plugin](https://github.com/hariharan-rs-19343/ZIDE-Server) v0.0.5:
- Server start/stop/debug lifecycle
- Deploy-sync on save
- Deployment config patching
- New project wizard with CMTool
- Update deployment (local + remote)
- Run hooks
- Deployment properties
- ANT build
- Application logs
- Uninstall project
- Plugin update checker
- Settings management

### Notes

- macOS and Linux only
- Requires Java JDK 17+, Apache Tomcat, Apache ANT, and Git
- Recommended: `redhat.java` and `vscjava.vscode-java-debug` extensions
