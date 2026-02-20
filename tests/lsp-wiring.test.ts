import { describe, it, expect } from 'vitest'
import {
  createLspWiring,
  HEW_DOCUMENT_SELECTOR,
  HEW_STDIO_TRANSPORT,
} from '../src/lsp-wiring'

describe('LSP wiring', () => {
  it('builds server/client options for Hew language features', () => {
    const outputChannel = { appendLine: () => {} } as any
    const { serverOptions, clientOptions } = createLspWiring('/tmp/hew-lsp', outputChannel)

    expect(serverOptions).toEqual({
      command: '/tmp/hew-lsp',
      args: [],
      transport: HEW_STDIO_TRANSPORT,
    })
    expect(clientOptions.documentSelector).toEqual(HEW_DOCUMENT_SELECTOR)
    expect(clientOptions.documentSelector).toContainEqual({ language: 'hew' })
    expect(clientOptions.outputChannel).toBe(outputChannel)
  })
})
