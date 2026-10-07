import {
    DocumentFormattingRequest,
    DynamicFeature,
    LanguageClient,
} from 'vscode-languageclient/node';

/** Keep the compiler formatter as the single document-formatting provider. */
export class HewLanguageClient extends LanguageClient {
    override registerFeature(feature: Parameters<LanguageClient['registerFeature']>[0]): void {
        if (DynamicFeature.is(feature)
            && feature.registrationType.method === DocumentFormattingRequest.method) {
            return;
        }
        super.registerFeature(feature);
    }
}
