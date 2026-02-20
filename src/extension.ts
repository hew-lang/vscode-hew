import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { execFile, execFileSync } from 'child_process';
import {
    LanguageClient,
    State,
} from 'vscode-languageclient/node';
import { createLspWiring } from './lsp-wiring';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Hew Language Server');
    context.subscriptions.push(outputChannel);

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    statusBar.text = '$(zap) Hew';
    statusBar.tooltip = 'Hew Language Server';
    context.subscriptions.push(statusBar);

    // Register document formatter
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('hew', {
            provideDocumentFormattingEdits(document: vscode.TextDocument): Thenable<vscode.TextEdit[]> {
                return formatDocument(document, outputChannel);
            }
        })
    );

    const serverPath = findBinaryPath('lsp.serverPath', 'hew-lsp');

    if (serverPath) {
        const { serverOptions, clientOptions } = createLspWiring(serverPath, outputChannel);

        client = new LanguageClient(
            'hewLanguageServer',
            'Hew Language Server',
            serverOptions,
            clientOptions
        );

        context.subscriptions.push(client.onDidChangeState(({ newState }) => {
            if (newState === State.Running) {
                statusBar.text = '$(zap) Hew';
                statusBar.tooltip = 'Hew Language Server active';
            } else if (newState === State.Stopped) {
                statusBar.text = '$(warning) Hew';
                statusBar.tooltip = 'Hew Language Server stopped';
            }
        }));

        client.start().catch(err => {
            statusBar.text = '$(error) Hew';
            statusBar.tooltip = `Hew LSP failed: ${err.message}`;
            outputChannel.appendLine(`Failed to start hew-lsp: ${err.message}`);
            vscode.window.showErrorMessage(`Hew LSP failed to start: ${err.message}`);
        });

        context.subscriptions.push(client);
    } else {
        statusBar.text = '$(warning) Hew';
        statusBar.tooltip = 'hew-lsp not found (formatter still available)';
        outputChannel.appendLine('hew-lsp not found. LSP features are disabled until it is installed.');
        vscode.window.showWarningMessage(
            'hew-lsp not found. Build it with: cd <hew-project> && cargo build -p hew-lsp'
        );
    }

    statusBar.show();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

function formatDocument(
    document: vscode.TextDocument,
    outputChannel: vscode.OutputChannel
): Thenable<vscode.TextEdit[]> {
    const hewPath = findBinaryPath('formatterPath', 'hew');
    if (!hewPath) {
        vscode.window.showWarningMessage(
            'hew binary not found. Build it with: cd <hew-project> && cargo build -p hew-cli'
        );
        return Promise.resolve([]);
    }

    return new Promise((resolve) => {
        const child = execFile(hewPath, ['fmt', '-'], { timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine(`hew fmt error: ${stderr || error.message}`);
                vscode.window.showErrorMessage(`hew fmt failed: ${stderr || error.message}`);
                resolve([]);
                return;
            }

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            resolve([vscode.TextEdit.replace(fullRange, stdout)]);
        });
        child.stdin?.write(document.getText());
        child.stdin?.end();
    });
}

/**
 * Find a binary by checking: config setting → workspace target/ dirs → PATH.
 * Consistent search order for both hew-lsp and hew binaries.
 */
function findBinaryPath(configKey: string, binaryName: string): string | undefined {
    const ext = process.platform === 'win32' ? '.exe' : '';

    // Check configuration
    const config = vscode.workspace.getConfiguration('hew');
    const configPath = config.get<string>(configKey);
    if (configPath && fs.existsSync(configPath)) return configPath;

    // Check workspace folders for target/release or target/debug builds
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            const releasePath = path.join(folder.uri.fsPath, 'target', 'release', `${binaryName}${ext}`);
            const debugPath = path.join(folder.uri.fsPath, 'target', 'debug', `${binaryName}${ext}`);
            if (fs.existsSync(releasePath)) return releasePath;
            if (fs.existsSync(debugPath)) return debugPath;
        }
    }

    // Check if binary is on PATH
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
        execFileSync(whichCmd, [binaryName], { stdio: 'pipe' });
        return binaryName;
    } catch {
        return undefined;
    }
}
