import { execFile, ChildProcess } from 'child_process';
import { finished } from 'stream/promises';

/** Return output only after the compiler succeeds and the buffer has been written. */
export async function formatWithCompiler(compilerPath: string, source: string): Promise<string> {
    let child!: ChildProcess;
    const output = new Promise<string>((resolve, reject) => {
        child = execFile(compilerPath, ['fmt', '--stdin'], { timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
            } else {
                resolve(stdout);
            }
        });
    });

    // A successful exit alone does not guarantee that writing stdin succeeded.
    // Keep the stream error listener in place until both operations have settled.
    const input = child.stdin
        ? finished(child.stdin, { readable: false })
        : Promise.reject(new Error('hew fmt stdin is unavailable'));
    const completion = Promise.allSettled([output, input]);
    child.stdin?.end(source);
    const [result, written] = await completion;

    if (result.status === 'rejected') {
        throw result.reason;
    }
    if (written.status === 'rejected') {
        throw written.reason;
    }
    if (source.trim().length > 0 && result.value.trim().length === 0) {
        throw new Error('hew fmt returned no output for a nonempty buffer');
    }
    return result.value;
}
