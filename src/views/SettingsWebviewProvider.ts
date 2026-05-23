import * as vscode from 'vscode';
import { SETTING_KEYS } from '../settings/settingKeys';

export class SettingsWebviewProvider {
    private static panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async show(): Promise<void> {
        if (SettingsWebviewProvider.panel) {
            SettingsWebviewProvider.panel.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'zideSettings', 'ZIDE Settings', vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        SettingsWebviewProvider.panel = panel;

        panel.onDidDispose(() => { SettingsWebviewProvider.panel = undefined; });

        const values = await this.loadAllValues();
        panel.webview.html = this.getHtml(values);

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'save') {
                await this.saveAllValues(msg.values);
                vscode.window.showInformationMessage('ZIDE: Settings saved.');
            } else if (msg.type === 'detectGit') {
                try {
                    const { execSync } = require('child_process');
                    const gitPath = execSync('which git', { encoding: 'utf-8' }).trim();
                    panel.webview.postMessage({ type: 'gitDetected', path: gitPath });
                } catch {
                    vscode.window.showErrorMessage('Could not detect git.');
                }
            }
        }, undefined, this.context.subscriptions);
    }

    private async loadAllValues(): Promise<Record<string, string>> {
        const secrets = this.context.secrets;
        const state = this.context.globalState;
        return {
            cmToolAuthToken: await secrets.get(SETTING_KEYS.cmToolAuthToken) || '',
            gitPath: state.get<string>(SETTING_KEYS.gitPath, ''),
            gitUsername: state.get<string>(SETTING_KEYS.gitUsername, ''),
            gitPassword: await secrets.get(SETTING_KEYS.gitPassword) || '',
            wgetUsername: state.get<string>(SETTING_KEYS.wgetUsername, ''),
            wgetPassword: await secrets.get(SETTING_KEYS.wgetPassword) || '',
            zohoRepoUsername: state.get<string>(SETTING_KEYS.zohoRepoUsername, ''),
            zohoRepoPassword: await secrets.get(SETTING_KEYS.zohoRepoPassword) || ''
        };
    }

    private async saveAllValues(values: Record<string, string>): Promise<void> {
        const secrets = this.context.secrets;
        const state = this.context.globalState;

        await secrets.store(SETTING_KEYS.cmToolAuthToken, values.cmToolAuthToken || '');
        await state.update(SETTING_KEYS.gitPath, values.gitPath || '');
        await state.update(SETTING_KEYS.gitUsername, values.gitUsername || '');
        await secrets.store(SETTING_KEYS.gitPassword, values.gitPassword || '');
        await state.update(SETTING_KEYS.wgetUsername, values.wgetUsername || '');
        await secrets.store(SETTING_KEYS.wgetPassword, values.wgetPassword || '');
        await state.update(SETTING_KEYS.zohoRepoUsername, values.zohoRepoUsername || '');
        await secrets.store(SETTING_KEYS.zohoRepoPassword, values.zohoRepoPassword || '');
    }

    private getHtml(values: Record<string, string>): string {
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; max-width: 600px; margin: 0 auto; }
  h1 { font-size: 1.4em; margin-bottom: 24px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 8px; }
  h2 { font-size: 1.1em; margin: 24px 0 12px; color: var(--vscode-descriptionForeground); }
  .field { margin-bottom: 14px; }
  label { display: block; font-size: 0.85em; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
  .input-wrap { display: flex; gap: 4px; }
  input[type="text"], input[type="password"] {
    flex: 1; padding: 6px 8px; border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border-radius: 3px; font-size: 0.9em; outline: none;
  }
  input:focus { border-color: var(--vscode-focusBorder); }
  .toggle-btn, .detect-btn {
    padding: 6px 10px; border: 1px solid var(--vscode-button-border, var(--vscode-input-border));
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    border-radius: 3px; cursor: pointer; font-size: 0.85em; white-space: nowrap;
  }
  .toggle-btn:hover, .detect-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .save-btn {
    margin-top: 24px; padding: 8px 24px; border: none; border-radius: 3px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    cursor: pointer; font-size: 0.95em;
  }
  .save-btn:hover { background: var(--vscode-button-hoverBackground); }
  hr { border: none; border-top: 1px solid var(--vscode-widget-border); margin: 20px 0; }
</style>
</head>
<body>
<h1>ZIDE Settings</h1>

<h2>CMTool</h2>
<div class="field">
  <label>Auth Token</label>
  <div class="input-wrap">
    <input type="password" id="cmToolAuthToken" value="${esc(values.cmToolAuthToken)}" />
    <button class="toggle-btn" onclick="toggleVis('cmToolAuthToken', this)">Show</button>
  </div>
</div>

<hr/>
<h2>Git</h2>
<div class="field">
  <label>Git Path</label>
  <div class="input-wrap">
    <input type="text" id="gitPath" value="${esc(values.gitPath)}" placeholder="/usr/bin/git" />
    <button class="detect-btn" onclick="detectGit()">Auto Detect</button>
  </div>
</div>
<div class="field">
  <label>Username</label>
  <input type="text" id="gitUsername" value="${esc(values.gitUsername)}" />
</div>
<div class="field">
  <label>Password</label>
  <div class="input-wrap">
    <input type="password" id="gitPassword" value="${esc(values.gitPassword)}" />
    <button class="toggle-btn" onclick="toggleVis('gitPassword', this)">Show</button>
  </div>
</div>

<hr/>
<h2>Wget</h2>
<div class="field">
  <label>Username</label>
  <input type="text" id="wgetUsername" value="${esc(values.wgetUsername)}" />
</div>
<div class="field">
  <label>Password</label>
  <div class="input-wrap">
    <input type="password" id="wgetPassword" value="${esc(values.wgetPassword)}" />
    <button class="toggle-btn" onclick="toggleVis('wgetPassword', this)">Show</button>
  </div>
</div>

<hr/>
<h2>Zoho Repository</h2>
<div class="field">
  <label>Username</label>
  <input type="text" id="zohoRepoUsername" value="${esc(values.zohoRepoUsername)}" />
</div>
<div class="field">
  <label>Password</label>
  <div class="input-wrap">
    <input type="password" id="zohoRepoPassword" value="${esc(values.zohoRepoPassword)}" />
    <button class="toggle-btn" onclick="toggleVis('zohoRepoPassword', this)">Show</button>
  </div>
</div>

<button class="save-btn" onclick="save()">Save</button>

<script>
  const vscode = acquireVsCodeApi();

  function toggleVis(id, btn) {
    const input = document.getElementById(id);
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = 'Hide';
    } else {
      input.type = 'password';
      btn.textContent = 'Show';
    }
  }

  function detectGit() {
    vscode.postMessage({ type: 'detectGit' });
  }

  function save() {
    const ids = ['cmToolAuthToken','gitPath','gitUsername','gitPassword','wgetUsername','wgetPassword','zohoRepoUsername','zohoRepoPassword'];
    const values = {};
    ids.forEach(id => { values[id] = document.getElementById(id).value; });
    vscode.postMessage({ type: 'save', values });
  }

  window.addEventListener('message', event => {
    if (event.data.type === 'gitDetected') {
      document.getElementById('gitPath').value = event.data.path;
    }
  });
</script>
</body>
</html>`;
    }
}
