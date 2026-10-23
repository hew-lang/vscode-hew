import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

interface Origin { file: string; span: { start: number; end: number } }
interface Expansion {
    text: string;
    inspectionOnly: boolean;
    origins: { name: string; invocation: Origin; definition: Origin }[];
}
interface View { source: vscode.Uri; position?: vscode.Position; expansion?: Expansion }
const scheme = 'hew-expansion';

/** Inspection documents never enter the language server as authored Hew. */
export function registerMacroExpansion(context: vscode.ExtensionContext, client: LanguageClient): void {
    const views = new Map<string, View>();
    const changed = new vscode.EventEmitter<vscode.Uri>();
    const provider: vscode.TextDocumentContentProvider = {
        onDidChange: changed.event,
        async provideTextDocumentContent(uri, token) {
            const view = views.get(uri.toString());
            if (!view) return '';
            const result = await client.sendRequest<Expansion | null>('hew/expandMacro', {
                textDocument: { uri: view.source.toString() },
                position: view.position,
                includeMetadata: true,
            }, token);
            view.expansion = result ?? undefined;
            return '// Macro expansion inspection: context comments do not preserve hygiene when compiled.\n'
                + (result?.text ?? '// No expansion at this position, or source analysis is unavailable.\n');
        },
    };
    const open = async (selected: boolean) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'hew' || editor.document.uri.scheme === scheme) return;
        const source = editor.document.uri;
        const position = selected ? editor.selection.start : undefined;
        const uri = vscode.Uri.from({ scheme, path: `/${source.path.split('/').pop()}.${selected ? 'macro' : 'expanded'}.hew`,
            query: JSON.stringify({ source: source.toString(), position }) });
        views.set(uri.toString(), { source, position });
        changed.fire(uri);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(document, 'hew');
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    };
    context.subscriptions.push(changed,
        vscode.workspace.registerTextDocumentContentProvider(scheme, provider),
        vscode.commands.registerCommand('hew.expandMacro', () => open(true)),
        vscode.commands.registerCommand('hew.expandDocument', () => open(false)),
        vscode.commands.registerCommand('hew.refreshExpansion', () => {
            const uri = vscode.window.activeTextEditor?.document.uri;
            if (uri?.scheme === scheme) changed.fire(uri);
        }),
        vscode.commands.registerCommand('hew.expansionSource', async () => {
            const uri = vscode.window.activeTextEditor?.document.uri;
            const view = uri && views.get(uri.toString());
            if (!view) return;
            const choices = [{ label: 'Original source', origin: undefined as Origin | undefined }];
            for (const origin of view.expansion?.origins ?? []) {
                choices.push({ label: `${origin.name}: invocation`, origin: origin.invocation },
                    { label: `${origin.name}: rule definition`, origin: origin.definition });
            }
            const choice = await vscode.window.showQuickPick(choices, { placeHolder: 'Open expansion source' });
            if (!choice) return;
            const document = await vscode.workspace.openTextDocument(choice.origin ? vscode.Uri.file(choice.origin.file) : view.source);
            const start = choice.origin
                ? document.positionAt(Buffer.from(document.getText()).subarray(0, choice.origin.span.start).toString().length)
                : view.position ?? new vscode.Position(0, 0);
            await vscode.window.showTextDocument(document, { selection: new vscode.Range(start, start) });
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            // Keep a selected invocation anchored when edits move it. The
            // diagnostics event below refreshes only after server analysis.
            for (const view of views.values()) {
                if (!view.position || view.source.toString() !== event.document.uri.toString()) continue;
                for (const change of [...event.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
                    const position: vscode.Position = view.position;
                    if (position.isBefore(change.range.start)) continue;
                    if (position.isBefore(change.range.end)) {
                        view.position = change.range.start;
                        continue;
                    }
                    const lines = change.text.split('\n');
                    const line = position.line + lines.length - 1 - (change.range.end.line - change.range.start.line);
                    const character = position.line === change.range.end.line
                        ? position.character - change.range.end.character
                            + (lines.length === 1 ? change.range.start.character : 0) + lines[lines.length - 1].length
                        : position.character;
                    view.position = new vscode.Position(line, character);
                }
            }
        }),
        vscode.languages.onDidChangeDiagnostics(event => {
            for (const [key, view] of views) {
                if (event.uris.some(uri => uri.toString() === view.source.toString())) changed.fire(vscode.Uri.parse(key));
            }
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.uri.scheme === scheme) views.delete(document.uri.toString());
        }),
    );
}
