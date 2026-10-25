import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { LiveConnection, LiveSession } from './live-session';
import type { LiveAnalysis } from './live-analysis';

export function registerLiveExecution(context: vscode.ExtensionContext, analysis: Pick<LiveAnalysis, 'apply' | 'clear'>): void {
    const output = vscode.window.createOutputChannel('Hew Live');
    const indicator = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    indicator.command = 'hew.live.status';
    let connection: LiveConnection | undefined;
    let session: LiveSession | undefined;
    let preparing = false;
    let queued: vscode.TextDocument | undefined;
    let replacing = false;
    let workspace: string | undefined;

    function belongs(document: vscode.TextDocument): boolean {
        return !workspace || vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() === workspace;
    }

    function render(): void {
        if (!session) {
            indicator.hide();
            return;
        }
        const active = session.active;
        indicator.text = preparing ? '$(sync~spin) Hew: preparing'
            : replacing ? '$(sync~spin) Hew: activating'
            : session.prepared ? '$(beaker) Hew: prepared'
            : `$(broadcast) Hew: ${active?.epoch ? `epoch ${active.epoch}` : 'inactive'}`;
        indicator.tooltip = active
            ? `Active epoch ${active.epoch}\n${active.digest}${session.prepared ? `\nPrepared ${session.prepared.digest}` : ''}`
            : 'Hew live session — refresh status';
        indicator.show();
    }

    async function disconnect(): Promise<void> {
        const previous = connection;
        connection = undefined;
        session = undefined;
        queued = undefined;
        workspace = undefined;
        preparing = false;
        replacing = false;
        previous?.dispose();
        render();
        await analysis.clear();
    }

    async function prepare(document: vscode.TextDocument): Promise<void> {
        if (!session || document.uri.scheme !== 'file' || document.languageId !== 'hew') return;
        if (vscode.workspace.textDocuments.some(open => open.languageId === 'hew' && belongs(open) && open.isDirty)) {
            throw new Error('Save the Hew source and its edited imports before preparing.');
        }
        queued = document;
        if (preparing) return;
        preparing = true;
        const current = session;
        render();
        try {
            while (queued && current === session) {
                const next = queued;
                queued = undefined;
                if (vscode.workspace.textDocuments.some(open => open.languageId === 'hew' && belongs(open) && open.isDirty)) {
                    current.invalidate(next.uri.fsPath);
                    continue;
                }
                const attached = connection!;
                const context = await attached.request('context', { source: next.uri.fsPath });
                if (current !== session) break;
                await analysis.apply(next.uri, context);
                if (current !== session) break;
                const prepared = await current.prepare(next.uri.fsPath);
                if (prepared) output.appendLine(`Prepared ${next.uri.fsPath}: ${current.prepared!.digest}`);
            }
        } finally {
            if (current === session) preparing = false;
            render();
        }
    }

    function command(name: string, run: () => Promise<void>): vscode.Disposable {
        return vscode.commands.registerCommand(name, async () => {
            try { await run(); }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                output.appendLine(message);
                void vscode.window.showErrorMessage(`Hew Live: ${message}`);
                render();
            }
        });
    }

    context.subscriptions.push(output, indicator, { dispose: () => { void disconnect(); } },
        command('hew.live.attach', async () => {
            if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before running a live SDK session.');
            const document = vscode.window.activeTextEditor?.document;
            const folder = document && vscode.workspace.getWorkspaceFolder(document.uri)
                || vscode.workspace.workspaceFolders?.[0];
            const config = vscode.workspace.getConfiguration('hew', folder?.uri);
            const endpoint = await vscode.window.showInputBox({ prompt: 'Hew node endpoint',
                value: config.get<string>('live.endpoint', ''), ignoreFocusOut: true });
            if (!endpoint?.trim()) return;
            const node = await vscode.window.showInputBox({ prompt: 'Authenticated Hew NodeId',
                value: config.get<string>('live.node', ''), ignoreFocusOut: true });
            if (!node?.trim()) return;
            await disconnect();
            workspace = folder?.uri.toString();
            const executable = config.get<string>('live.executable', '').trim() || 'hew-live-node';
            const child = spawn(executable, ['attach', '--endpoint', endpoint.trim(), '--node', node.trim()], {
                cwd: folder?.uri.fsPath ?? (document?.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined),
                stdio: 'pipe', windowsHide: true,
            });
            const attached = new LiveConnection(child, text => output.append(text), error => {
                if (connection !== attached) return;
                output.appendLine(error.message);
                void disconnect();
                void vscode.window.showWarningMessage(`Hew Live disconnected: ${error.message}`);
                render();
            });
            connection = attached;
            const current = session = new LiveSession(attached);
            render();
            const status = await current.refresh();
            if (document?.languageId === 'hew' && document.uri.scheme === 'file') {
                try {
                    const context = await attached.request('context', { source: document.uri.fsPath });
                    if (connection !== attached) return;
                    await analysis.apply(document.uri, context);
                } catch (error) {
                    await disconnect();
                    throw error;
                }
            }

            output.appendLine(`Attached ${node.trim()} at ${endpoint.trim()}: epoch ${status.epoch}, ${status.digest}`);
            render();
        }),
        command('hew.live.prepare', async () => {
            if (!session) throw new Error('Attach to a Hew live node first.');
            const document = vscode.window.activeTextEditor?.document;
            if (!document || document.languageId !== 'hew' || document.uri.scheme !== 'file') {
                throw new Error('Open a saved Hew source file to prepare.');
            }
            await prepare(document);
        }),
        command('hew.live.activate', async () => {
            if (!session) throw new Error('Attach to a Hew live node first.');
            if (preparing || replacing) throw new Error('Wait for the current live operation to finish.');
            replacing = true;
            const current = session;
            render();
            try {
                const status = await current.activate(5_000);
                output.appendLine(`Activated epoch ${status.epoch}: ${status.digest}`);
            } finally {
                if (current === session) replacing = false;
                render();
            }
        }),
        command('hew.live.status', async () => {
            if (!session) throw new Error('Attach to a Hew live node first.');
            const status = await session.refresh();
            output.appendLine(`Active epoch ${status.epoch}: ${status.digest}`);
            output.show(true);
            render();
        }),
        command('hew.live.disconnect', disconnect),
        vscode.workspace.onDidChangeTextDocument(event => {
            // Imported source can change the component too. Preparation always
            // goes back through the compiler's ordinary dependency resolver.
            if (event.document.languageId === 'hew' && belongs(event.document) && session?.source) {
                session.invalidate(session.source);
            }
            render();
        }),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId !== 'hew' || !belongs(document) || !session?.source) return;
            const source = vscode.workspace.textDocuments.find(open => open.uri.fsPath === session?.source);
            if (!source) return;
            void prepare(source).catch(error => {
                output.appendLine(error instanceof Error ? error.message : String(error));
                void vscode.window.showErrorMessage('Hew Live preparation failed. The active version is unchanged; see Hew Live output.');
            });
        }),
    );
}
