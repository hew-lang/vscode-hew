import { createHash } from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function stagingFixture(target: 'linux-x64' | 'win32-x64', complete = true) {
    const root = mkdtempSync(join(tmpdir(), 'hew-sdk-staging-'));
    roots.push(root);
    const windows = target === 'win32-x64';
    const arch = windows ? 'windows-x86_64' : 'linux-x86_64';
    const name = `hew-v0.6.2-${arch}`;
    const extension = join(root, 'extension');
    const source = join(root, 'source', name);
    const archives = join(root, 'archives');
    mkdirSync(join(extension, 'scripts'), { recursive: true });
    mkdirSync(archives);
    cpSync(resolve('scripts/stage-hew-sdk.sh'), join(extension, 'scripts/stage-hew-sdk.sh'));
    const files = {
        [`bin/${windows ? 'hew.exe' : 'hew'}`]: 'unified executable',
        'lib/libhew.a': 'matching runtime',
        'lib/x86_64-unknown-linux-gnu/libhew.a': 'target runtime',
        'std/math.hew': 'matching standard library',
        'include/hew.h': 'matching header',
        'share/hew/hew-gdb.py': 'matching debugger helper',
        ...(windows ? { 'bin/LLVM.dll': 'dynamic dependency' } : { 'lib/libLLVM.so': 'dynamic dependency' }),
    };
    for (const [file, text] of Object.entries(files)) {
        if (!complete && file.startsWith('lib/')) continue;
        mkdirSync(join(source, file, '..'), { recursive: true });
        writeFileSync(join(source, file), text);
    }
    chmodSync(join(source, 'bin', windows ? 'hew.exe' : 'hew'), 0o755);
    const archive = join(archives, `${name}.${windows ? 'zip' : 'tar.gz'}`);
    if (windows) execFileSync('zip', ['-qr', archive, name], { cwd: join(root, 'source') });
    else execFileSync('tar', ['-czf', archive, '-C', join(root, 'source'), name]);
    const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
    writeFileSync(join(extension, 'hew-release.sha256'), `${hash}  ${name}.${windows ? 'zip' : 'tar.gz'}\n`);
    return { extension, archives, files, archive };
}

// Release packaging runs this Bash staging script on Linux for every target.
describe.skipIf(process.platform !== 'linux')('SDK archive staging', () => {
    it.each(['linux-x64', 'win32-x64'] as const)('stages the matched SDK and dynamic dependencies for %s', target => {
        const fixture = stagingFixture(target);
        const result = spawnSync('bash', ['scripts/stage-hew-sdk.sh', target, fixture.archives], {
            cwd: fixture.extension, encoding: 'utf8', timeout: 10000,
        });
        expect(result.status, result.stderr).toBe(0);
        for (const [file, text] of Object.entries(fixture.files)) {
            expect(readFileSync(join(fixture.extension, 'sdk', file), 'utf8')).toBe(text);
        }
    });

    it('refuses damaged archive bytes before replacing the installed SDK', () => {
        const fixture = stagingFixture('linux-x64');
        mkdirSync(join(fixture.extension, 'sdk'));
        writeFileSync(join(fixture.extension, 'sdk', 'retained'), 'working SDK');
        writeFileSync(fixture.archive, 'damaged archive');
        const result = spawnSync('bash', ['scripts/stage-hew-sdk.sh', 'linux-x64', fixture.archives], {
            cwd: fixture.extension, encoding: 'utf8', timeout: 10000,
        });
        expect(result.status).not.toBe(0);
        expect(readFileSync(join(fixture.extension, 'sdk', 'retained'), 'utf8')).toBe('working SDK');
    });

    it('refuses an incomplete SDK before replacing the installed SDK', () => {
        const fixture = stagingFixture('linux-x64', false);
        const result = spawnSync('bash', ['scripts/stage-hew-sdk.sh', 'linux-x64', fixture.archives], {
            cwd: fixture.extension, encoding: 'utf8', timeout: 10000,
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('SDK archive is missing lib');
        expect(existsSync(join(fixture.extension, 'sdk'))).toBe(false);
    });
});
