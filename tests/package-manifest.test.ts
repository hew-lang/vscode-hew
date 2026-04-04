import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('package.json', 'utf-8'));

describe('package manifest security settings', () => {
    it('declares limited restricted-mode support for binary execution settings', () => {
        expect(manifest.capabilities?.untrustedWorkspaces).toMatchObject({
            supported: 'limited',
        });

        expect(manifest.capabilities?.untrustedWorkspaces?.restrictedConfigurations).toEqual(
            expect.arrayContaining([
                'hew.lsp.serverPath',
                'hew.formatterPath',
                'hew.debugger.hewPath',
                'hew.allowUntrustedWorkspaceBinaries',
            ])
        );
    });

    it('defaults the untrusted workspace binary opt-in setting to false', () => {
        expect(
            manifest.contributes?.configuration?.properties?.['hew.allowUntrustedWorkspaceBinaries']
        ).toMatchObject({
            type: 'boolean',
            default: false,
        });
    });
});
