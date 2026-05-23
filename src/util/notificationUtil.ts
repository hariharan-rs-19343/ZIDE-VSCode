import * as vscode from 'vscode';

export function showInfo(message: string): void {
    vscode.window.showInformationMessage(`ZIDE: ${message}`);
}

export function showWarning(message: string): void {
    vscode.window.showWarningMessage(`ZIDE: ${message}`);
}

export function showError(message: string): void {
    vscode.window.showErrorMessage(`ZIDE: ${message}`);
}

export async function showErrorWithAction(message: string, action: string): Promise<boolean> {
    const result = await vscode.window.showErrorMessage(`ZIDE: ${message}`, action);
    return result === action;
}

export async function showConfirm(message: string): Promise<boolean> {
    const result = await vscode.window.showWarningMessage(`ZIDE: ${message}`, 'Yes', 'No');
    return result === 'Yes';
}
