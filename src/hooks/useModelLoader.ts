import { useState, useCallback, useRef } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';

export type LoaderState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

interface ModelLoaderResult {
  state: LoaderState;
  progress: number;
  error: string | null;
  ensure: () => Promise<boolean>;
}

export function useModelLoader(
  _category: ModelCategory = ModelCategory.Language,
  _coexist = false
): ModelLoaderResult {
  const [state, setState] = useState<LoaderState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const ensure = useCallback(async (): Promise<boolean> => {
    if (state === 'ready') return true;
    if (loadingRef.current) return false;
    loadingRef.current = true;

    try {
      setState('downloading');
      setProgress(0);

      await TextGeneration.loadModel(
        '/models/LFM2-350M.Q4_K_M.gguf',
        'LFM2-350M'
      );

      setProgress(1);
      setState('ready');
      console.log('[NOVA] Model loaded in-browser via RunAnywhere ✅');
      return true;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setState('error');
      console.error('[NOVA] Model load error:', msg);
      return false;
    } finally {
      loadingRef.current = false;
    }
  }, [state]);

  return { state, progress, error, ensure };
}