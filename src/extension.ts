import * as fs from 'fs';
import * as vscode from 'vscode';
import { execFile, execFileSync } from 'child_process';
import {
    LanguageClient,
    State,
} from 'vscode-languageclient/node';
import { discoverBinaryPath, BinaryLookupResult } from './binary-discovery';
import { createLspWiring } from './lsp-wiring';
import { HewDebugSession } from './debug/hew-debug-session';
import { checkBackendAvailability, DebuggerBackendPreference } from './debug/mi-backend';
import { HewActorsProvider, ActorTreeItem } from './debug/actors-tree-view';

let client: LanguageClient | undefined;
const ALLOW_UNTRUSTED_WORKSPACE_BINARIES_SETTING = 'hew.allowUntrustedWorkspaceBinaries';
const blockedWorkspaceBinaryWarnings = new Set<string>();

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

    const serverPathResult = findBinaryPath(
        'lsp.serverPath',
        'hew-lsp',
        context.extensionPath,
        outputChannel
    );
    const serverPath = serverPathResult.path;

    if (serverPath) {
        const config = vscode.workspace.getConfiguration('hew');
        const pkgPath = config.get<string>('pkgPath', '').trim() || undefined;
        const { serverOptions, clientOptions } = createLspWiring(serverPath, outputChannel, { pkgPath });

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
            getMissingBinaryMessage('hew-lsp', 'hew.lsp.serverPath', serverPathResult)
        );
    }

    statusBar.show();

    // Register debug adapter
    const hewPath = findBinaryPath('debugger.hewPath', 'hew', context.extensionPath, outputChannel).path
        ?? findBinaryPath('formatterPath', 'hew', context.extensionPath, outputChannel).path;

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

    // Register Hew Actors tree view for debug panel
    const actorsProvider = new HewActorsProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('hewActors', actorsProvider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hew.debug.breakOnReceive', (item: ActorTreeItem) => {
            const session = vscode.debug.activeDebugSession;
            if (session) {
                session.customRequest('hew/breakOnReceive', { actor: item.actorName });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hew.debug.toggleRuntimeFrames', () => {
            const session = vscode.debug.activeDebugSession;
            if (session) {
                session.customRequest('hew/toggleRuntimeFrames');
            }
        })
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
    const hewPathResult = findBinaryPath('formatterPath', 'hew', extensionPath, outputChannel);
    const hewPath = hewPathResult.path;
    if (!hewPath) {
        vscode.window.showWarningMessage(
            getMissingBinaryMessage('hew', 'hew.formatterPath', hewPathResult)
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
 * Find a binary by checking: config setting → trusted workspace target/ dirs
 * (or explicit opt-in) → PATH → bundled extension server/.
 */
function findBinaryPath(
    configKey: string,
    binaryName: string,
    extensionPath: string,
    outputChannel: vscode.OutputChannel
): BinaryLookupResult {
    const config = vscode.workspace.getConfiguration('hew');
    const result = discoverBinaryPath({
        configPath: config.get<string>(configKey),
        binaryName,
        extensionPath,
        workspaceFolders: vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath),
        isWorkspaceTrusted: vscode.workspace.isTrusted,
        allowUntrustedWorkspaceBinaries: config.get<boolean>('allowUntrustedWorkspaceBinaries', false),
        fileExists: candidatePath => fs.existsSync(candidatePath),
        findOnPath: candidateName => {
            const whichCmd = process.platform === 'win32' ? 'where' : 'which';
            try {
                execFileSync(whichCmd, [candidateName], { stdio: 'pipe' });
                return candidateName;
            } catch {
                return undefined;
            }
        },
    });

    reportBlockedWorkspaceBinaries(binaryName, result, outputChannel);
    return result;
}

function reportBlockedWorkspaceBinaries(
    binaryName: string,
    result: BinaryLookupResult,
    outputChannel: vscode.OutputChannel
): void {
    if (result.blockedWorkspaceCandidates.length === 0) {
        return;
    }

    const warningKey = `${binaryName}:${result.blockedWorkspaceCandidates.join('|')}`;
    if (blockedWorkspaceBinaryWarnings.has(warningKey)) {
        return;
    }

    blockedWorkspaceBinaryWarnings.add(warningKey);

    const message =
        `Skipping workspace-built ${binaryName} binaries because the workspace is untrusted. ` +
        `Trust the workspace or enable ${ALLOW_UNTRUSTED_WORKSPACE_BINARIES_SETTING} in user settings ` +
        'to allow binaries from target/release or target/debug.';

    outputChannel.appendLine(
        `${message} Skipped candidates: ${result.blockedWorkspaceCandidates.join(', ')}`
    );
    if (result.path) {
        vscode.window.showWarningMessage(message);
    }
}

function getMissingBinaryMessage(
    binaryName: string,
    configSetting: string,
    result: BinaryLookupResult
): string {
    if (result.blockedWorkspaceCandidates.length > 0) {
        return `${binaryName} not found. Workspace-built ${binaryName} binaries were ignored because the ` +
            `workspace is untrusted. Trust the workspace or enable ${ALLOW_UNTRUSTED_WORKSPACE_BINARIES_SETTING} ` +
            `in user settings, or set ${configSetting} to a trusted binary.`;
    }

    const buildPackage = binaryName === 'hew-lsp' ? 'hew-lsp' : 'hew-cli';
    return `${binaryName} not found. Build it with: cd <hew-project> && cargo build -p ${buildPackage}`;
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

        const backendCheck = checkBackendAvailability(
            (config.debuggerBackend ?? 'auto') as DebuggerBackendPreference
        );
        if (backendCheck.message) {
            return vscode.window.showErrorMessage(backendCheck.message).then(_ => undefined);
        }

        return config;
    }
}
