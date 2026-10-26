import * as path from 'path';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

const scheme = 'hew-sdk-context';

interface ContextSource { path: string; source: string }
interface SdkContext { version: 1; compiler: string; sources: ContextSource[] }

function sdkContext(value: unknown): SdkContext {
    const context = value as SdkContext | undefined;
    if (context?.version !== 1 || typeof context.compiler !== 'string' || !path.isAbsolute(context.compiler)
        || !Array.isArray(context.sources) || context.sources.some(source => !source
            || typeof source.path !== 'string' || !path.isAbsolute(source.path) || typeof source.source !== 'string')) {
        throw new Error('The live SDK did not return a compatible editor source context.');
    }
    return context;
}

/** A view of SDK source, never another generator or an authored filesystem file. */
export class LiveAnalysis {
    private sources = new Map<string, { text: string; view: vscode.Uri }>();
    private current?: { client: LanguageClient; compiler: string; document: vscode.Uri; fingerprint: string };
    private jobs = Promise.resolve();
    private changed = new vscode.EventEmitter<vscode.Uri>();

    constructor(context: Pick<vscode.ExtensionContext, 'subscriptions'>,
        private readonly selectCompiler: (compiler: string) => Promise<LanguageClient>) {
        context.subscriptions.push(this.changed,
            vscode.workspace.registerTextDocumentContentProvider(scheme, {
                onDidChange: this.changed.event,
                provideTextDocumentContent: uri => [...this.sources.values()].find(source => source.view.toString() === uri.toString())?.text
                    ?? '// This SDK context is detached.\n',
            }));
    }

    definitionUri(uri: vscode.Uri): vscode.Uri {
        // Authored open buffers retain their actual editor identity and text.
        if (vscode.workspace.textDocuments.some(document => document.uri.toString() === uri.toString())) return uri;
        return this.sources.get(uri.toString())?.view ?? uri;
    }

    apply(document: vscode.Uri, value: unknown): Promise<void> {
        const context = sdkContext(value);
        return this.enqueue(async () => {
            const fingerprint = JSON.stringify({ document: document.toString(), context });
            if (this.current?.fingerprint === fingerprint) return;
            const replacing = this.current?.compiler === context.compiler
                && this.current.document.toString() === document.toString();
            if (!replacing) await this.clearCurrent();
            const client = await this.selectCompiler(context.compiler);
            const capabilities = client.initializeResult?.capabilities.experimental as { hewAnalysisContext?: number } | undefined;
            if (capabilities?.hewAnalysisContext !== 1) {
                throw new Error('Live source editing requires the SDK compiler with analysis-context support; the bundled stable LSP is incompatible.');
            }
            const sources = context.sources.map(source => {
                const uri = vscode.Uri.file(source.path);
                return { uri: uri.toString(), text: source.source, view: uri.with({ scheme }) };
            });
            await client.sendRequest('hew/analysisContext', {
                textDocument: { uri: document.toString() }, sources: sources.map(({ uri, text }) => ({ uri, text })),
            });
            this.current = { client, compiler: context.compiler, document, fingerprint };
            const previousViews = [...this.sources.values()].map(source => source.view);
            this.sources.clear();
            for (const source of sources) {
                this.sources.set(source.uri, { text: source.text, view: source.view });
            }
            for (const view of [...previousViews, ...sources.map(source => source.view)]) this.changed.fire(view);
        });
    }

    clear(): Promise<void> { return this.enqueue(() => this.clearCurrent()); }

    private async clearCurrent(): Promise<void> {
        const previous = this.current;
        this.current = undefined;
        const views = [...this.sources.values()].map(source => source.view);
        this.sources.clear();
        for (const view of views) this.changed.fire(view);
        if (previous && previous.client.isRunning()) {
            try {
                await previous.client.sendRequest('hew/analysisContext', {
                    textDocument: { uri: previous.document.toString() }, sources: [],
                });
            } catch (error) {
                // A stopped server has already discarded its entire context.
                if (previous.client.isRunning()) throw error;
            }
        }
    }

    private enqueue(operation: () => Promise<void>): Promise<void> {
        const job = this.jobs.then(operation);
        this.jobs = job.catch(() => undefined);
        return job;
    }
}
