import { describe, expect, it, vi } from 'vitest'

// Model the language client's public registration/initialization lifecycle.
// Each enabled feature registers a provider when the server advertises it.
vi.mock('vscode-languageclient/node', () => {
  const formatting = 'textDocument/formatting'
  class LanguageClient {
    features: any[] = []

    constructor() {
      this.registerFeature({ registrationType: { method: formatting } })
      this.registerFeature({ registrationType: { method: 'textDocument/hover' } })
      this.registerFeature({ registrationType: { method: 'textDocument/rangeFormatting' } })
      this.registerFeature({ initialize: () => 'static feature' })
    }

    registerFeature(feature: any) {
      this.features.push(feature)
    }

    initialize(capabilities: Record<string, boolean>, providers: string[]) {
      const enabled: Record<string, string> = {
        [formatting]: 'documentFormattingProvider',
        'textDocument/hover': 'hoverProvider',
        'textDocument/rangeFormatting': 'documentRangeFormattingProvider',
      }
      for (const feature of this.features) {
        const method = feature.registrationType?.method
        if (capabilities[enabled[method]]) providers.push(method)
      }
    }
  }
  return {
    LanguageClient,
    DynamicFeature: { is: (feature: any) => feature.registrationType !== undefined },
    DocumentFormattingRequest: { method: formatting },
  }
})

import { LanguageClient } from 'vscode-languageclient/node'
import { HewLanguageClient } from '../src/hew-language-client'

function initialize(Client: typeof LanguageClient) {
  const client = new Client('hew', 'Hew', {} as any, {}) as any
  const providers = ['compiler formatter']
  client.initialize({ documentFormattingProvider: true, hoverProvider: true,
    documentRangeFormattingProvider: true }, providers)
  return { client, providers }
}

describe('Hew language-client provider registration', () => {
  it('keeps one document formatter when the server advertises formatting', () => {
    // The stock client reproduces the two-provider state seen in VS Code.
    expect(initialize(LanguageClient).providers).toContain('textDocument/formatting')
    const { providers } = initialize(HewLanguageClient)
    expect(providers.filter(provider => provider.includes('formatter')
      || provider === 'textDocument/formatting')).toEqual(['compiler formatter'])
    expect(providers).toContain('textDocument/hover')
    expect(providers).toContain('textDocument/rangeFormatting')
  })

  it('preserves other static and subsequently registered features', () => {
    const { client } = initialize(HewLanguageClient)
    expect(client.features.some((feature: any) => feature.initialize)).toBe(true)
    client.registerFeature({ registrationType: { method: 'textDocument/completion' } })
    client.registerFeature({ registrationType: { method: 'textDocument/formatting' } })
    expect(client.features.map((feature: any) => feature.registrationType?.method))
      .toContain('textDocument/completion')
    expect(client.features.map((feature: any) => feature.registrationType?.method))
      .not.toContain('textDocument/formatting')
  })
})
