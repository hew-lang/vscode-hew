import * as path from 'path';
import * as readline from 'readline';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { parseTestEvent } from './test-protocol';

interface DiscoveredTest {
    identity: string;
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    ignored: boolean;
    real_time: boolean;
}

export function registerHewTests(
    context: vscode.ExtensionContext,
    client: LanguageClient,
    hewPath: string,
    output: vscode.OutputChannel
): void {
    const controller = vscode.tests.createTestController('hewTests', 'Hew Tests');
    context.subscriptions.push(controller);

    async function discover(): Promise<void> {
        try {
            const tests = await client.sendRequest<DiscoveredTest[]>('hew/tests', {});
            const files = new Map<string, vscode.TestItem>();
            controller.items.replace([]);
            for (const test of tests) {
                const uri = vscode.Uri.parse(test.uri);
                let file = files.get(test.uri);
                if (!file) {
                    file = controller.createTestItem(`file:${test.uri}`, vscode.workspace.asRelativePath(uri), uri);
                    controller.items.add(file);
                    files.set(test.uri, file);
                }
                const item = controller.createTestItem(`test:${test.uri}::${test.identity}`, test.identity.split('::').pop()!, uri);
                item.range = new vscode.Range(test.range.start.line, test.range.start.character,
                    test.range.end.line, test.range.end.character);
                item.description = test.ignored ? 'ignored' : test.real_time ? 'real time' : undefined;
                file.children.add(item);
            }
        } catch (error) {
            output.appendLine(`Test discovery failed: ${String(error)}`);
        }
    }

    controller.resolveHandler = discover;
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.hew');
    context.subscriptions.push(watcher);
    for (const event of [watcher.onDidCreate, watcher.onDidChange, watcher.onDidDelete]) {
        context.subscriptions.push(event(() => { void discover(); }));
    }
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        if (document.languageId === 'hew') void discover();
    }));

    controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, async (request, token) => {
        const run = controller.createTestRun(request);
        if (!vscode.workspace.isTrusted) {
            run.appendOutput('Trust this workspace to run Hew tests.\r\n');
            run.end();
            return;
        }
        const excluded = new Set(request.exclude?.map(item => item.id));
        const selected: vscode.TestItem[] = [];
        function collect(item: vscode.TestItem): void {
            if (excluded.has(item.id)) return;
            if (item.id.startsWith('test:') && item.uri) {
                selected.push(item);
            } else {
                item.children.forEach(collect);
            }
        }
        if (request.include) {
            for (const item of request.include) collect(item);
        } else {
            controller.items.forEach(collect);
        }
        try {
            for (const item of selected) {
                if (token.isCancellationRequested) {
                    run.skipped(item);
                    continue;
                }
                const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === item.uri?.toString());
                if (document?.isDirty && !await document.save()) {
                    run.errored(item, new vscode.TestMessage('Save the Hew file before running its tests.'));
                    continue;
                }
                await runOne(item, hewPath, run, token);
            }
        } finally {
            run.end();
        }
    }, true);
}

async function runOne(
    item: vscode.TestItem,
    hewPath: string,
    run: vscode.TestRun,
    token: vscode.CancellationToken
): Promise<void> {
    const uri = item.uri!;
    const name = item.label;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const cwd = folder?.uri.fsPath ?? path.dirname(uri.fsPath);
    run.started(item);
    await new Promise<void>(resolve => {
        const child = spawn(hewPath, ['test', `${uri.fsPath}::${name}`, '--format', 'json', '--color', 'never'], { cwd });
        let finished = false;
        let compileError = '';
        let stderr = '';
        const cancellation = token.onCancellationRequested(() => child.kill());
        const lines = readline.createInterface({ input: child.stdout });
        lines.on('line', line => {
            const event = parseTestEvent(line);
            if (!event) {
                if (line.trim()) run.appendOutput(`${line}\r\n`, undefined, item);
                return;
            }
            if (event.event === 'file_compiled' && !event.ok) {
                compileError = event.diagnostics || 'Test compilation failed';
            } else if (event.event === 'test_finished') {
                finished = true;
                if (event.output) run.appendOutput(event.output.replace(/\n/g, '\r\n'), undefined, item);
                if (event.outcome === 'passed') {
                    run.passed(item, event.duration_ms);
                } else if (event.outcome === 'ignored') {
                    run.skipped(item);
                } else {
                    const seed = event.report?.seed ? `\nSeed: ${event.report.seed}` : '';
                    run.failed(item, new vscode.TestMessage(`${event.message ?? event.kind ?? 'Test failed'}${seed}`), event.duration_ms);
                }
            }
        });
        child.stderr.on('data', data => { stderr += data.toString(); });
        child.on('error', error => { stderr += error.message; });
        child.on('close', () => {
            cancellation.dispose();
            lines.close();
            if (!finished) {
                if (token.isCancellationRequested) run.skipped(item);
                else run.errored(item, new vscode.TestMessage(compileError || stderr || 'Test runner stopped without a result.'));
            }
            resolve();
        });
    });
}
