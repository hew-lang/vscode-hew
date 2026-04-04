import * as path from 'path';

export interface BinaryLookupOptions {
    configPath?: string;
    binaryName: string;
    extensionPath: string;
    workspaceFolders?: readonly string[];
    isWorkspaceTrusted: boolean;
    allowUntrustedWorkspaceBinaries: boolean;
    fileExists: (candidatePath: string) => boolean;
    findOnPath: (binaryName: string) => string | undefined;
    platform?: NodeJS.Platform;
}

export interface BinaryLookupResult {
    path?: string;
    blockedWorkspaceCandidates: string[];
}

export function discoverBinaryPath(options: BinaryLookupOptions): BinaryLookupResult {
    const platform = options.platform ?? process.platform;
    const ext = platform === 'win32' ? '.exe' : '';
    const configPath = options.configPath?.trim();

    if (configPath && options.fileExists(configPath)) {
        return { path: configPath, blockedWorkspaceCandidates: [] };
    }

    const blockedWorkspaceCandidates: string[] = [];
    const allowWorkspaceBinaries =
        options.isWorkspaceTrusted || options.allowUntrustedWorkspaceBinaries;

    for (const folder of options.workspaceFolders ?? []) {
        const releasePath = path.join(folder, 'target', 'release', `${options.binaryName}${ext}`);
        const debugPath = path.join(folder, 'target', 'debug', `${options.binaryName}${ext}`);

        if (options.fileExists(releasePath)) {
            if (allowWorkspaceBinaries) {
                return { path: releasePath, blockedWorkspaceCandidates };
            }
            blockedWorkspaceCandidates.push(releasePath);
        }

        if (options.fileExists(debugPath)) {
            if (allowWorkspaceBinaries) {
                return { path: debugPath, blockedWorkspaceCandidates };
            }
            blockedWorkspaceCandidates.push(debugPath);
        }
    }

    const pathBinary = options.findOnPath(options.binaryName);
    if (pathBinary) {
        return { path: pathBinary, blockedWorkspaceCandidates };
    }

    const bundledPath = path.join(options.extensionPath, 'server', `${options.binaryName}${ext}`);
    if (options.fileExists(bundledPath)) {
        return { path: bundledPath, blockedWorkspaceCandidates };
    }

    return { blockedWorkspaceCandidates };
}
