import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

export const HEW_DOCUMENT_SELECTOR: LanguageClientOptions['documentSelector'] = [
    { language: 'hew' }
];
// `TransportKind.stdio` in vscode-languageclient is numeric value 0.
// Keep this as a plain constant to avoid loading VS Code runtime modules in unit tests.
export const HEW_STDIO_TRANSPORT = 0;

export function createLspWiring(
    serverPath: string,
    outputChannel: LanguageClientOptions['outputChannel']
): { serverOptions: ServerOptions; clientOptions: LanguageClientOptions } {
    return {
        serverOptions: {
            command: serverPath,
            args: [],
            transport: HEW_STDIO_TRANSPORT,
        } as ServerOptions,
        clientOptions: {
            documentSelector: HEW_DOCUMENT_SELECTOR,
            outputChannel,
        },
    };
}
