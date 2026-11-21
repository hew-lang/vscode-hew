import type * as vscode from 'vscode';
import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

export const HEW_DOCUMENT_SELECTOR: LanguageClientOptions['documentSelector'] = [
    { language: 'hew', scheme: 'file' },
    { language: 'hew', scheme: 'untitled' }
];

export interface LspWiringOptions {
    /** Extra package search directory (mirrors `hew check --pkg-path`). */
    pkgPath?: string;
    mapDefinitionUri?: (uri: vscode.Uri) => vscode.Uri;
}

export function createLspWiring(
    serverPath: string,
    outputChannel: LanguageClientOptions['outputChannel'],
    options: LspWiringOptions = {}
): { serverOptions: ServerOptions; clientOptions: LanguageClientOptions } {
    const args: string[] = ['lsp'];
    if (options.pkgPath) {
        args.push('--pkg-path', options.pkgPath);
    }
    return {
        // Executable options use stdio by default. An explicit TransportKind.stdio
        // makes vscode-languageclient append --stdio, which Hew does not accept.
        serverOptions: { command: serverPath, args },
        clientOptions: {
            documentSelector: HEW_DOCUMENT_SELECTOR,
            outputChannel,
            middleware: options.mapDefinitionUri ? {
                async provideDefinition(document, position, token, next) {
                    const definition = await next(document, position, token);
                    if (Array.isArray(definition)) {
                        for (const location of definition) {
                            if ('targetUri' in location) location.targetUri = options.mapDefinitionUri!(location.targetUri);
                            else location.uri = options.mapDefinitionUri!(location.uri);
                        }
                    } else if (definition) definition.uri = options.mapDefinitionUri!(definition.uri);
                    return definition;
                },
            } : undefined,
        },
    };
}
