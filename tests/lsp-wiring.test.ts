import { describe, it, expect } from 'vitest'
import {
  createLspWiring,
  HEW_DOCUMENT_SELECTOR,
  HEW_STDIO_TRANSPORT,
} from '../src/lsp-wiring'

describe('LSP wiring', () => {
  it('maps generated definitions to the registered read-only SDK view', async () => {
    const original = { scheme: 'file', path: '/app/router_services.hew' } as any
    const virtual = { scheme: 'hew-sdk-context', path: original.path } as any
    const { clientOptions } = createLspWiring('/sdk/hew', undefined, { mapDefinitionUri: () => virtual })
    const provider = clientOptions.middleware!.provideDefinition!
    const next = async () => [{ targetUri: original, targetRange: {}, targetSelectionRange: {} }]
    const definitions = await provider({} as any, {} as any, {} as any, next as any)
    expect(definitions).toMatchObject([{ targetUri: virtual }])
  })

  it('builds server/client options for Hew language features', () => {
    const outputChannel = { appendLine: () => {} } as any
    const { serverOptions, clientOptions } = createLspWiring('/tmp/hew', outputChannel)

    expect(serverOptions).toEqual({
      command: '/tmp/hew',
      args: ['lsp'],
      transport: HEW_STDIO_TRANSPORT,
    })
    expect(clientOptions.documentSelector).toEqual(HEW_DOCUMENT_SELECTOR)
    expect(clientOptions.documentSelector).toEqual([{ language: 'hew', scheme: 'file' }, { language: 'hew', scheme: 'untitled' }])
    expect(clientOptions.outputChannel).toBe(outputChannel)
  })

  it('passes --pkg-path arg when pkgPath option is provided', () => {
    const outputChannel = { appendLine: () => {} } as any
    const { serverOptions } = createLspWiring('/tmp/hew', outputChannel, {
      pkgPath: '/custom/packages',
    })

    expect(serverOptions).toEqual({
      command: '/tmp/hew',
      args: ['lsp', '--pkg-path', '/custom/packages'],
      transport: HEW_STDIO_TRANSPORT,
    })
  })

  it('omits --pkg-path arg when pkgPath option is absent', () => {
    const outputChannel = { appendLine: () => {} } as any
    const { serverOptions } = createLspWiring('/tmp/hew', outputChannel, {})

    expect((serverOptions as any).args).toEqual(['lsp'])
  })
})
