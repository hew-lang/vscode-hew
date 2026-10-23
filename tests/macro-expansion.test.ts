import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
    commands: new Map<string, (...args: any[]) => any>(),
    provider: undefined as any,
    editor: undefined as any,
    diagnostic: undefined as any,
    change: undefined as any,
    close: undefined as any,
    fired: [] as any[],
    shown: [] as any[],
    choice: 0,
    sourceText: '// é\nmake!()',
}));
vi.mock('vscode', () => {
    class Uri {
        constructor(public scheme: string, public path: string, public query = '') {}
        toString() { return `${this.scheme}:${this.path}?${this.query}`; }
        static from(value: any) { return new Uri(value.scheme, value.path, value.query); }
        static file(path: string) { return new Uri('file', path); }
        static parse(value: string) {
            const colon = value.indexOf(':');
            const question = value.indexOf('?');
            return new Uri(value.slice(0, colon), value.slice(colon + 1, question), value.slice(question + 1));
        }
    }
    class Position {
        constructor(public line: number, public character: number) {}
        isBefore(other: Position) { return this.line < other.line || this.line === other.line && this.character < other.character; }
    }
    return {
        Uri, Position, Range: class { constructor(public start: any, public end: any) {} },
        EventEmitter: class { event = () => {}; fire(uri: any) { host.fired.push(uri); } dispose() {} },
        ViewColumn: { Beside: 2 },
        commands: { registerCommand(name: string, fn: any) { host.commands.set(name, fn); return {}; } },
        window: {
            get activeTextEditor() { return host.editor; },
            showTextDocument: async (document: any, options: any) => { host.shown.push({ document, options }); },
            showQuickPick: async (items: any[]) => items[host.choice],
        },
        workspace: {
            registerTextDocumentContentProvider: (_scheme: string, provider: any) => { host.provider = provider; return {}; },
            openTextDocument: async (uri: any) => ({ uri, languageId: '', getText: () => host.sourceText,
                positionAt: (offset: number) => { const lines = host.sourceText.slice(0, offset).split('\n'); return new Position(lines.length - 1, lines.at(-1)!.length); } }),
            onDidChangeTextDocument: (fn: any) => { host.change = fn; return {}; },
            onDidCloseTextDocument: (fn: any) => { host.close = fn; return {}; },
        },
        languages: {
            setTextDocumentLanguage: async (document: any, language: string) => { document.languageId = language; return document; },
            onDidChangeDiagnostics: (fn: any) => { host.diagnostic = fn; return {}; },
        },
    };
});
import * as vscode from 'vscode';
import { registerMacroExpansion } from '../src/macro-expansion';

beforeEach(() => {
    host.commands.clear(); host.fired = []; host.shown = []; host.choice = 0;
    host.editor = { document: { languageId: 'hew', uri: vscode.Uri.file('/main.hew') },
        selection: { start: new vscode.Position(1, 2), active: new vscode.Position(1, 9) } };
});

function setup() {
    const sendRequest = vi.fn().mockResolvedValue({ text: 'fn answer() { 42 }', inspectionOnly: true,
        origins: [{ name: 'make', invocation: { file: '/main.hew', span: { start: 6, end: 13 } },
            definition: { file: '/macros.hew', span: { start: 6, end: 13 } } }] });
    registerMacroExpansion({ subscriptions: [] } as any, { sendRequest } as any);
    return sendRequest;
}

describe('macro expansion editor views', () => {
    it('opens whole and selected views as Hew and requests the matching scope', async () => {
        const request = setup();
        await host.commands.get('hew.expandDocument')!();
        let document = host.shown.at(-1).document;
        expect(document.languageId).toBe('hew');
        expect(document.uri.scheme).toBe('hew-expansion');
        const text = await host.provider.provideTextDocumentContent(document.uri, {});
        expect(text).toContain('do not preserve hygiene');
        expect(text).toContain('fn answer()');
        expect(request.mock.lastCall![1]).toEqual({ textDocument: { uri: host.editor.document.uri.toString() },
            position: undefined, includeMetadata: true });
        await host.commands.get('hew.expandMacro')!();
        document = host.shown.at(-1).document;
        await host.provider.provideTextDocumentContent(document.uri, {});
        expect(request.mock.lastCall![1].position).toEqual(new vscode.Position(1, 2));
    });

    it('tracks invocation position after edits and refreshes after diagnostics', async () => {
        const request = setup();
        const source = host.editor.document;
        await host.commands.get('hew.expandMacro')!();
        const document = host.shown.at(-1).document;
        host.fired = [];
        host.change({ document: source, contentChanges: [{ rangeOffset: 0,
            range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), text: '// inserted\n' }] });
        expect(host.fired).toHaveLength(0);
        host.diagnostic({ uris: [source.uri] });
        expect(host.fired.map(uri => uri.toString())).toEqual([document.uri.toString()]);
        await host.provider.provideTextDocumentContent(document.uri, {});
        expect(request.mock.lastCall![1].position).toEqual(new vscode.Position(2, 2));
        host.editor = { document };
        host.commands.get('hew.refreshExpansion')!();
        expect(host.fired).toHaveLength(2);
    });

    it('jumps to the selected rule using UTF-8 origin offsets and releases closed views', async () => {
        setup();
        await host.commands.get('hew.expandMacro')!();
        const document = host.shown.at(-1).document;
        await host.provider.provideTextDocumentContent(document.uri, {});
        host.editor = { document };
        host.choice = 2;
        await host.commands.get('hew.expansionSource')!();
        expect(host.shown.at(-1).document.uri.path).toBe('/macros.hew');
        expect(host.shown.at(-1).options.selection.start).toEqual(new vscode.Position(1, 0));
        host.close(document);
        expect(await host.provider.provideTextDocumentContent(document.uri, {})).toBe('');
    });

    it('shows unavailable expansion without treating the view as authored source', async () => {
        const request = setup().mockResolvedValue(null);
        await host.commands.get('hew.expandMacro')!();
        const document = host.shown.at(-1).document;
        expect(await host.provider.provideTextDocumentContent(document.uri, {})).toContain('No expansion at this position');
        host.editor = { document };
        await host.commands.get('hew.expandDocument')!();
        expect(request).toHaveBeenCalledTimes(1);
    });
});
