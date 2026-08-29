import { serverConfig } from '@/lib/config';
import type { AiProvider } from '@/lib/ai/types';
import { LocalAiProvider } from '@/lib/ai/fallback';
import { GeminiAiProvider } from '@/lib/ai/gemini';

let cached: AiProvider | null = null;

/**
 * Resolve the configured AI provider.
 *
 * Adding a provider means adding one case here — nothing else in the app knows
 * which model is behind the Game Master. With no key configured this returns
 * the deterministic local provider, which is a fully supported mode, not a
 * degraded one.
 */
export function getAiProvider(): AiProvider {
  if (cached) return cached;
  if (!serverConfig.aiApiKey) {
    cached = new LocalAiProvider();
    return cached;
  }
  switch (serverConfig.aiProvider) {
    case 'gemini':
    case 'google':
      cached = new GeminiAiProvider();
      break;
    default:
      cached = new LocalAiProvider();
  }
  return cached;
}

/** Test seam — clears the memoised provider. */
export function resetAiProvider(): void {
  cached = null;
}

export type { AiProvider } from '@/lib/ai/types';
