import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { execFile, execFileSync } from 'child_process';
import {
    LanguageClient,
    State,
} from 'vscode-languageclient/node';
import { createLspWiring } from './lsp-wiring';
import { HewDebugSession } from './debug/hew-debug-session';

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
                return formatDocument(document, outputChannel, context.extensionPath);
            }
        })
    );

    const serverPath = findBinaryPath('lsp.serverPath', 'hew-lsp', context.extensionPath);

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

    // Register debug adapter
    const hewPath = findBinaryPath('debugger.hewPath', 'hew', context.extensionPath)
        ?? findBinaryPath('formatterPath', 'hew', context.extensionPath);

    // Pass the hew compiler path to the debug session via environment variable
    if (hewPath) {
        process.env['HEW_COMPILER_PATH'] = hewPath;
    }

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(
            'hew',
            new HewDebugAdapterFactory()
        )
    );

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider(
            'hew',
            new HewDebugConfigProvider()
        )
    );
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

function formatDocument(
    document: vscode.TextDocument,
    outputChannel: vscode.OutputChannel,
    extensionPath: string
): Thenable<vscode.TextEdit[]> {
    const hewPath = findBinaryPath('formatterPath', 'hew', extensionPath);
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
 * Find a binary by checking: config setting → workspace target/ dirs → PATH → bundled extension server/.
 * Consistent search order for both hew-lsp and hew binaries.
 */
function findBinaryPath(configKey: string, binaryName: string, extensionPath: string): string | undefined {
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
        // no-op: binary not on PATH
    }

    // Check for bundled server binary in the extension
    const bundledPath = path.join(extensionPath, 'server', `${binaryName}${ext}`);
    if (fs.existsSync(bundledPath)) return bundledPath;

    return undefined;
}

// ---------------------------------------------------------------------------
// Debug Adapter Factory
// ---------------------------------------------------------------------------

class HewDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        _executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(new HewDebugSession() as any);
    }
}

// ---------------------------------------------------------------------------
// Debug Configuration Provider
// ---------------------------------------------------------------------------

class HewDebugConfigProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // If no config provided (e.g. user pressed F5 with no launch.json),
        // provide a default if the active editor is a .hew file.
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'hew') {
                config.type = 'hew';
                config.request = 'launch';
                config.name = 'Debug Hew Program';
                config.program = editor.document.uri.fsPath;
                config.stopOnEntry = false;
                config.debuggerBackend = 'auto';
            }
        }

        if (!config.program) {
            return vscode.window.showInformationMessage(
                'Cannot debug: no program specified'
            ).then(_ => undefined);
        }

        return config;
    }
}
