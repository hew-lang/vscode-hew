import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
    const serverPath = findServerPath();

    if (!serverPath) {
        vscode.window.showWarningMessage(
            'hew-lsp not found. Build it with: cd <hew-project> && cargo build -p hew-lsp'
        );
        return;
    }

    const serverOptions: ServerOptions = {
        command: serverPath,
        args: [],
        transport: TransportKind.stdio,
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'hew' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.hew'),
        },
    };

    client = new LanguageClient(
        'hewLanguageServer',
        'Hew Language Server',
        serverOptions,
        clientOptions
    );

    client.start();

    context.subscriptions.push({
        dispose: () => {
            if (client) {
                client.stop();
            }
        }
    });

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    statusBar.text = '$(zap) Hew';
    statusBar.tooltip = 'Hew Language Server active';
    statusBar.show();
    context.subscriptions.push(statusBar);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

function findServerPath(): string | undefined {
    // Check workspace folders for target/debug/hew-lsp or target/release/hew-lsp
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            const releasePath = path.join(folder.uri.fsPath, 'target', 'release', 'hew-lsp');
            const debugPath = path.join(folder.uri.fsPath, 'target', 'debug', 'hew-lsp');
            if (fs.existsSync(releasePath)) return releasePath;
            if (fs.existsSync(debugPath)) return debugPath;
        }
    }

    // Check configuration
    const config = vscode.workspace.getConfiguration('hew');
    const configPath = config.get<string>('lsp.serverPath');
    if (configPath) return configPath;

    // Fallback: assume it's on PATH
    return 'hew-lsp';
}
