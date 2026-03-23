/**
 * NOVA V6 - OLLAMA LOCAL ENGINE 🦙
 * Replaces RunAnywhere SDK with local Ollama
 * Cache → Ollama → Groq fallback (handled by backend)
 */

const OLLAMA_URL = 'http://localhost:11434';
const BACKEND_URL = 'http://localhost:5000';

// ─────────────────────────────────────────
// OLLAMA STATUS
// ─────────────────────────────────────────

export type AISource = 'ollama' | 'groq' | 'cache' | 'offline';

export interface NovaStatus {
  ollama: boolean;
  backend: boolean;
  model: string;
  source: AISource;
}

/**
 * Check if Ollama is running locally
 */
export async function isOllamaOnline(): Promise<boolean> {
  try {
    const res = await fetch(OLLAMA_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check if Flask backend is running
 */
export async function isBackendOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get full NOVA system status
 */
export async function getNovaStatus(): Promise<NovaStatus> {
  const [ollama, backend] = await Promise.all([
    isOllamaOnline(),
    isBackendOnline(),
  ]);

  let source: AISource = 'offline';
  let model = 'none';

  if (backend) {
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      const data = await res.json();
      model = data.model || 'qwen3:4b';
      if (data.ollama?.includes('online')) {
        source = 'ollama';
      } else {
        source = 'groq';
      }
    } catch {
      source = ollama ? 'ollama' : 'groq';
    }
  }

  return { ollama, backend, model, source };
}

/**
 * Get acceleration mode label for UI display
 */
export function getAccelerationMode(): string {
  return 'ollama-local';
}

/**
 * Get display label for current AI source
 */
export function getSourceLabel(source: AISource): string {
  switch (source) {
    case 'ollama': return '[CORE: OLLAMA 🦙]';
    case 'cache': return '[CORE: CACHE ⚡]';
    case 'groq': return '[CORE: GROQ 🌐]';
    case 'offline': return '[CORE: OFFLINE ❌]';
    default: return '[CORE: UNKNOWN]';
  }
}

/**
 * Get color for current AI source
 */
export function getSourceColor(source: AISource): string {
  switch (source) {
    case 'ollama': return '#00ff88';
    case 'cache': return '#ffaa00';
    case 'groq': return '#ff3cac';
    case 'offline': return '#ff3333';
    default: return '#00eaff';
  }
}

export { OLLAMA_URL, BACKEND_URL };