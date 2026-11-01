import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'

import { createOfflineProvider } from './offline-provider.js'

/** Owns one isolated SDK session. No user configuration, extensions, tools or remote transport. */
export async function createOfflineRuntime(cwd: string, runtimeDir: string) {
  const agentDir = join(runtimeDir, 'agent')
  mkdirSync(agentDir, { recursive: true })
  const provider = await createOfflineProvider()
  try {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      authPath: join(agentDir, 'empty-auth.json'),
      modelsStorePath: join(agentDir, 'models-store.json'),
      refreshOnCreate: false,
      allowModelNetwork: false,
    })
    const stream = runtime.streamSimple.bind(runtime)
    runtime.streamSimple = (model, context, options = {}) =>
      stream(model, context, {
        ...options,
        maxTokens: 512,
        maxRetries: 0,
        transport: 'sse',
        cacheRetention: 'none',
        fetch: (input, init) => globalThis.fetch(input, { ...init, redirect: 'error' }),
      })
    runtime.registerProvider('piw-offline', {
      api: 'openai-completions',
      baseUrl: provider.baseUrl,
      apiKey: 'offline-only',
      models: [
        {
          id: 'fixture',
          name: 'Local fixture (not a real model)',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 8192,
          maxTokens: 512,
        },
      ],
    })
    const model = runtime.getModel('piw-offline', 'fixture')
    if (!model) {
      throw new Error('Offline model registration failed')
    }
    const settingsManager = SettingsManager.inMemory({
      retry: { enabled: false },
      compaction: { enabled: false },
      cacheWarming: 'off',
    })
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: 'Offline lifecycle validation. No tools.',
    })
    await resourceLoader.reload()
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime: runtime,
      model,
      tools: [],
      noTools: 'all',
      settingsManager,
      resourceLoader,
      sessionManager: SessionManager.create(cwd, join(runtimeDir, 'sessions')),
    })
    if (session.getActiveToolNames().length || session.agent.state.tools.length) {
      session.dispose()
      throw new Error('Deny-all execution guard failed')
    }
    return { session, provider }
  } catch (error) {
    await provider.close()
    throw error
  }
}
