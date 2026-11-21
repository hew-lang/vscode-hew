import * as path from 'path';
import * as readline from 'readline';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { parseTestEvent, renderTestFailure, type FinishedTestEvent } from './test-protocol';

type FinishedTest = FinishedTestEvent;

interface DiscoveredTest {
    identity: string;
    selector: string;
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    ignored: boolean;
    real_time: boolean;
}

export function registerHewTests(
    context: Pick<vscode.ExtensionContext, 'subscriptions'>,
    client: LanguageClient,
    hewPath: string,
    output: vscode.OutputChannel
): void {
    const controller = vscode.tests.createTestController('hewTests', 'Hew Tests');
    context.subscriptions.push(controller);
    const diagnostics = vscode.languages.createDiagnosticCollection('hew test');
    const lensChanges = new vscode.EventEmitter<void>();
    const failures = new Map<string, Map<string, { diagnostic: vscode.Diagnostic; seed?: string }>>();
    const activeRuns = new Map<string, symbol>();
    let sourceRevision = 0;
    context.subscriptions.push(diagnostics, lensChanges);

    function publish(uri: vscode.Uri): void {
        diagnostics.set(uri, [...(failures.get(uri.toString())?.values() ?? [])].map(entry => entry.diagnostic));
        lensChanges.fire();
    }

    function clear(item: vscode.TestItem): void {
        const uri = item.uri!;
        const entries = failures.get(uri.toString());
        if (!entries?.delete(item.id.slice('test:'.length))) return;
        if (!entries.size) failures.delete(uri.toString());
        publish(uri);
    }

    function record(item: vscode.TestItem, event: FinishedTest, document: vscode.TextDocument): void {
        const failure = renderTestFailure(event, document.uri.fsPath, document.getText());
        if (!failure) return;
        const uri = item.uri!;
        const range = failure.offset !== null
            ? new vscode.Range(
                document.positionAt(failure.offset),
                document.positionAt(failure.offset + 1))
            : item.range ?? new vscode.Range(0, 0, 0, 1);
        const diagnostic = new vscode.Diagnostic(range, failure.message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'hew test';
        const entries = failures.get(uri.toString()) ?? new Map();
        entries.set(event.selector, { diagnostic, seed: failure.seed });
        failures.set(uri.toString(), entries);
        publish(uri);
    }

    function invalidateDiagnostics(): void {
        sourceRevision++;
        if (!failures.size) return;
        failures.clear();
        diagnostics.clear();
        lensChanges.fire();
    }

    function isTestInput(document: vscode.TextDocument): boolean {
        const name = path.basename(document.uri.fsPath);
        return document.languageId === 'hew' || name === 'hew.toml' || name === 'hew.lock';
    }

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(change => {
        if (isTestInput(change.document) && change.contentChanges.length) invalidateDiagnostics();
    }));

    async function runSavedTest(
        item: vscode.TestItem, run: vscode.TestRun, token: vscode.CancellationToken, seed?: string
    ): Promise<void> {
        const document = await vscode.workspace.openTextDocument(item.uri!);
        if (document.isDirty && !await document.save()) {
            run.errored(item, new vscode.TestMessage('Save the Hew file before running its tests.'));
            return;
        }
        if (token.isCancellationRequested) {
            run.skipped(item);
            return;
        }
        clear(item);
        const revision = sourceRevision;
        const saved = !vscode.workspace.textDocuments.some(document => document.isDirty && isTestInput(document));
        const active = Symbol();
        activeRuns.set(item.id, active);
        try {
            await runOne(item, hewPath, run, token, event => {
                if (saved && sourceRevision === revision && activeRuns.get(item.id) === active && !token.isCancellationRequested) {
                    record(item, event, document);
                }
            }, seed);
        } finally {
            if (activeRuns.get(item.id) === active) activeRuns.delete(item.id);
        }
    }

    context.subscriptions.push(vscode.languages.registerCodeLensProvider('hew', {
        onDidChangeCodeLenses: lensChanges.event,
        provideCodeLenses(document) {
            return [...(failures.get(document.uri.toString())?.entries() ?? [])]
                .filter(([, entry]) => entry.seed)
                .map(([selector, entry]) => {
                    const seed = entry.seed!;
                    const title = `▶ Rerun with seed 0x${BigInt(seed).toString(16)}`;
                    return new vscode.CodeLens(entry.diagnostic.range, {
                        title, command: 'hew.rerunTestWithSeed', arguments: [selector, seed]
                    });
                });
        }
    }));

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
                const item = controller.createTestItem(`test:${test.selector}`, test.identity.split('::').pop()!, uri);
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
    const watcher = vscode.workspace.createFileSystemWatcher('**/{*.hew,hew.toml,hew.lock}');
    context.subscriptions.push(
        watcher,
        watcher.onDidCreate(() => { invalidateDiagnostics(); void discover(); }),
        watcher.onDidChange(uri => {
            // Open source edits are already observed by onDidChangeTextDocument.
            // The filesystem watcher also covers closed inputs and manifests.
            const openInput = vscode.workspace.textDocuments.some(
                document => isTestInput(document) && document.uri.toString() === uri.toString()
            );
            if (!openInput) invalidateDiagnostics();
            void discover();
        }),
        watcher.onDidDelete(() => { invalidateDiagnostics(); void discover(); })
    );
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
                await runSavedTest(item, run, token);
            }
        } finally {
            run.end();
        }
    }, true);

    context.subscriptions.push(vscode.commands.registerCommand('hew.rerunTestWithSeed', async (selector: string, seed: string) => {
        if (!vscode.workspace.isTrusted) return;
        let item: vscode.TestItem | undefined;
        controller.items.forEach(file => file.children.forEach(test => {
            if (test.id === `test:${selector}`) item = test;
        }));
        if (!item) return;
        const run = controller.createTestRun(new vscode.TestRunRequest([item]));
        const cancellation = new vscode.CancellationTokenSource();
        try {
            await runSavedTest(item, run, cancellation.token, seed);
        } finally {
            cancellation.dispose();
            run.end();
        }
    }));
}

async function runOne(
    item: vscode.TestItem,
    hewPath: string,
    run: vscode.TestRun,
    token: vscode.CancellationToken,
    onFinished: (event: FinishedTest) => void,
    seed?: string
): Promise<void> {
    const uri = item.uri!;
    const selector = item.id.slice('test:'.length);
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const cwd = folder?.uri.fsPath ?? path.dirname(uri.fsPath);
    run.started(item);
    await new Promise<void>(resolve => {
        const args = ['test', selector, '--format', 'json', '--color', 'never'];
        if (seed) args.push('--seed', seed);
        const child = spawn(hewPath, args, { cwd });
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
                onFinished(event);
                if (event.output) run.appendOutput(event.output.replace(/\n/g, '\r\n'), undefined, item);
                if (event.outcome === 'passed') {
                    run.passed(item, event.duration_ms);
                } else if (event.outcome === 'ignored') {
                    run.skipped(item);
                } else {
                    const seed = event.report?.seed ? `\nSeed: ${event.report.seed}` : '';
                    const message = `${event.message ?? event.kind ?? 'Test failed'}${seed}`;
                    const assertion = event.report?.assertion;
                    const testMessage = assertion
                        ? vscode.TestMessage.diff(message, assertion.right, assertion.left)
                        : new vscode.TestMessage(message);
                    run.failed(item, testMessage, event.duration_ms);
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
