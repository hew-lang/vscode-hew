import { beforeEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ provider: undefined as any, documents: [] as any[], changed: [] as string[] }));
vi.mock('vscode', () => {
    class Uri {
        constructor(readonly path: string, readonly scheme = 'file') {}
        static file(path: string) { return new Uri(path); }
        with(change: { scheme: string }) { return new Uri(this.path, change.scheme); }
        toString() { return `${this.scheme}://${this.path}`; }
    }
    return { Uri, EventEmitter: class {
        event = () => {};
        fire(uri: Uri) { host.changed.push(uri.toString()); }
        dispose() {}
    }, workspace: {
        get textDocuments() { return host.documents; },
        registerTextDocumentContentProvider: (_scheme: string, provider: any) => {
            host.provider = provider;
            return { dispose() {} };
        },
    } };
});

import * as vscode from 'vscode';
import { LiveAnalysis } from '../src/live-analysis';

beforeEach(() => { host.documents = []; host.changed = []; });

const context = (source: string) => ({ version: 1, compiler: '/sdk/bin/hew',
    sources: [{ path: '/app/router_services.hew', source }] });

it('uses the selected SDK LSP and opens its exact generated definition as read-only source', async () => {
    const client = { isRunning: () => true, initializeResult: { capabilities: { experimental: { hewAnalysisContext: 1 } } }, sendRequest: vi.fn().mockResolvedValue(null) };
    const select = vi.fn().mockResolvedValue(client);
    const analysis = new LiveAnalysis({ subscriptions: [] }, select);
    const entry = vscode.Uri.file('/app/router.hew');
    const module = vscode.Uri.file('/app/router_services.hew');
    await analysis.apply(entry, context('SDK generated source'));
    expect(select).toHaveBeenCalledWith('/sdk/bin/hew');
    expect(client.sendRequest).toHaveBeenCalledWith('hew/analysisContext', {
        textDocument: { uri: entry.toString() }, sources: [{ uri: module.toString(), text: 'SDK generated source' }],
    });
    const definition = analysis.definitionUri(module);
    expect(definition.scheme).toBe('hew-sdk-context');
    expect(host.provider.provideTextDocumentContent(definition)).toBe('SDK generated source');
    host.documents = [{ uri: module, isDirty: true }];
    expect(analysis.definitionUri(module)).toBe(module);
    host.documents = [];
    await analysis.apply(entry, context('changed SDK source'));
    expect(client.sendRequest.mock.calls.map(([, params]) => params.sources.length)).toEqual([1, 1]);
    expect(host.provider.provideTextDocumentContent(definition)).toBe('changed SDK source');
    expect(host.changed).toContain(definition.toString());
    await analysis.clear();
    expect(client.sendRequest).toHaveBeenLastCalledWith('hew/analysisContext', { textDocument: { uri: entry.toString() }, sources: [] });
    expect(analysis.definitionUri(module)).toBe(module);
    expect(host.provider.provideTextDocumentContent(definition)).toContain('detached');
});

it('does not silently apply contexts to an incompatible stable LSP', async () => {
    const client = { isRunning: () => true, initializeResult: { capabilities: {} }, sendRequest: vi.fn() };
    const analysis = new LiveAnalysis({ subscriptions: [] }, vi.fn().mockResolvedValue(client));
    await expect(analysis.apply(vscode.Uri.file('/app/router.hew'), context('source'))).rejects.toThrow('SDK compiler');
    expect(client.sendRequest).not.toHaveBeenCalled();
});

it('serializes detach after an in-flight context registration', async () => {
    let release!: () => void;
    const client = { isRunning: () => true, initializeResult: { capabilities: { experimental: { hewAnalysisContext: 1 } } },
        sendRequest: vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(null) };
    const analysis = new LiveAnalysis({ subscriptions: [] }, vi.fn().mockResolvedValue(client));
    const apply = analysis.apply(vscode.Uri.file('/app/router.hew'), context('source'));
    const clear = analysis.clear();
    await new Promise(resolve => setImmediate(resolve));
    release();
    await Promise.all([apply, clear]);
    expect(client.sendRequest.mock.calls.map(([, params]) => params.sources.length)).toEqual([1, 0]);
});
