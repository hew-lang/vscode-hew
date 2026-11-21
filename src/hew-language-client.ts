import {
    DocumentDiagnosticRequest,
    DocumentFormattingRequest,
    DynamicFeature,
    LanguageClient,
} from 'vscode-languageclient/node';

/** Keep one provider for formatting and one stream of diagnostics. */
export class HewLanguageClient extends LanguageClient {
    override registerFeature(feature: Parameters<LanguageClient['registerFeature']>[0]): void {
        if (DynamicFeature.is(feature)) {
            const method = feature.registrationType.method;
            // Hew pushes diagnostics for open documents and affected importers.
            // Pulling the same reports creates a second collection in VS Code.
            if (method === DocumentDiagnosticRequest.method || method === DocumentFormattingRequest.method) {
                return;
            }
        }
        super.registerFeature(feature);
    }
}
