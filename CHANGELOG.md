# Changelog

## [1.0.0] - 2025-05-23

### Added

- **Server Management**: Add, edit, remove Tomcat servers via Activity Bar tree view
- **Server Lifecycle**: Start, stop, restart servers with real-time output streaming
- **Debug Mode**: One-click debug with automatic Java remote attach (JPDA)
- **Hot-Code Replace**: Automatic hot-swap on `.java` file save when debugging (requires vscjava.vscode-java-debug)
- **Deploy-Sync on Save**: Automatic file deployment on save
  - `.java` files: compiled class copied to `WEB-INF/classes/`
  - Resource files: matched against ANT hook tasks and auto-copy mappings
- **Configuration Patching**: Pre-start patching of `server.xml`, `web.xml`, `configuration.properties`, `persistence-configurations.xml`, and `security-properties.xml`
- **New Project Wizard**: Full 17-step project creation via CMTool API (git clone, build download/extract, WAR extraction, ANT hooks, auto-configure)
- **Update Deployment**: Download remote builds or select local zip files to update deployments
- **Deployment Properties**: Edit host, IAM server, HTTP/HTTPS ports, database type/host/port/user/password/schema
- **Build Command**: Run ANT builds with auto-resolved `ANT_HOME` and project properties
- **Application Logs**: View last 5000 lines of application log file in dedicated output channel
- **ZIDE Config Parsing**: Parse `service.xml`, `zide_properties.xml`, and `Zide.properties` with mtime-based caching
- **Auto-detect Setup**: Automatically configure server from `.zide_resources/` in workspace
- **Port Management**: TCP port probe, wait-for-ready (45s timeout), wait-for-release
- **Process Management**: Graceful shutdown with SIGTERM → SIGKILL fallback, lsof-based port kill
- **Secure Storage**: Passwords stored via VS Code SecretStorage (OS keychain)
- **Keyboard Shortcuts**: 7 keybindings for common operations
- **CI/CD**: GitHub Actions workflows for build/lint on push and release on tag

### Notes

- macOS and Linux only — Windows is not supported
- Requires Java JDK and Apache Tomcat installed locally
- Apache ANT required for build and hook tasks
- Recommended: `redhat.java` and `vscjava.vscode-java-debug` extensions for full hot-swap support
