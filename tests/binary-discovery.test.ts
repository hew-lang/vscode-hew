import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { discoverBinaryPath } from '../src/binary-discovery';

function runDiscovery({
    binaryName = 'hew',
    configPath,
    workspaceFolders = ['/workspace'],
    extensionPath = '/extension',
    isWorkspaceTrusted = true,
    allowUntrustedWorkspaceBinaries = false,
    existingPaths = [],
    pathBinary,
}: {
    binaryName?: string;
    configPath?: string;
    workspaceFolders?: string[];
    extensionPath?: string;
    isWorkspaceTrusted?: boolean;
    allowUntrustedWorkspaceBinaries?: boolean;
    existingPaths?: string[];
    pathBinary?: string;
}) {
    const existing = new Set(existingPaths);

    return discoverBinaryPath({
        configPath,
        binaryName,
        extensionPath,
        workspaceFolders,
        isWorkspaceTrusted,
        allowUntrustedWorkspaceBinaries,
        fileExists: candidatePath => existing.has(candidatePath),
        findOnPath: () => pathBinary,
        platform: 'linux',
    });
}

describe('binary discovery', () => {
    it('prefers an explicit configured path even in an untrusted workspace', () => {
        const configPath = '/trusted/bin/hew-lsp';
        const workspaceBinary = path.join('/workspace', 'target', 'release', 'hew-lsp');

        const result = runDiscovery({
            binaryName: 'hew-lsp',
            configPath,
            isWorkspaceTrusted: false,
            existingPaths: [configPath, workspaceBinary],
        });

        expect(result).toEqual({
            path: configPath,
            blockedWorkspaceCandidates: [],
        });
    });

    it('prefers workspace release binaries when the workspace is trusted', () => {
        const workspaceBinary = path.join('/workspace', 'target', 'release', 'hew-lsp');

        const result = runDiscovery({
            binaryName: 'hew-lsp',
            existingPaths: [workspaceBinary],
            pathBinary: 'hew-lsp',
        });

        expect(result).toEqual({
            path: workspaceBinary,
            blockedWorkspaceCandidates: [],
        });
    });

    it('blocks workspace binaries in untrusted workspaces by default and falls back to PATH', () => {
        const workspaceBinary = path.join('/workspace', 'target', 'release', 'hew');

        const result = runDiscovery({
            isWorkspaceTrusted: false,
            existingPaths: [workspaceBinary],
            pathBinary: 'hew',
        });

        expect(result).toEqual({
            path: 'hew',
            blockedWorkspaceCandidates: [workspaceBinary],
        });
    });

    it('allows workspace binaries in untrusted workspaces when explicitly opted in', () => {
        const workspaceBinary = path.join('/workspace', 'target', 'debug', 'hew');

        const result = runDiscovery({
            isWorkspaceTrusted: false,
            allowUntrustedWorkspaceBinaries: true,
            existingPaths: [workspaceBinary],
        });

        expect(result).toEqual({
            path: workspaceBinary,
            blockedWorkspaceCandidates: [],
        });
    });

    it('falls back to bundled binaries after blocking workspace candidates', () => {
        const workspaceBinary = path.join('/workspace', 'target', 'release', 'hew-lsp');
        const bundledBinary = path.join('/extension', 'server', 'hew-lsp');

        const result = runDiscovery({
            binaryName: 'hew-lsp',
            isWorkspaceTrusted: false,
            existingPaths: [workspaceBinary, bundledBinary],
        });

        expect(result).toEqual({
            path: bundledBinary,
            blockedWorkspaceCandidates: [workspaceBinary],
        });
    });
});
