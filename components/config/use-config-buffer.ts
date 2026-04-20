"use client";

/**
 * Shared edit-buffer hook for the config tabs.
 *
 * Each tab owns one instance. The hook tracks:
 *   - `serverValues`  : the last snapshot we fetched from the API
 *   - `draft`         : in-flight edits (keyed by the same paths)
 *   - `dirtyKeys`     : derived set of paths where draft !== serverValue
 *   - `mtimeMs`       : server-reported mtime used for the PUT optimistic-
 *                        concurrency check
 *
 * The buffer is intentionally dumb — it doesn't know about descriptors or
 * types. Tabs pass the descriptor through when rendering controls.
 */

import { useCallback, useMemo, useState } from "react";

export type ConfigValue = string | number | boolean;

export interface ConfigBufferState {
  serverValues: Record<string, ConfigValue>;
  draft: Record<string, ConfigValue>;
  mtimeMs: number | null;
}

export interface ConfigBuffer {
  serverValues: Record<string, ConfigValue>;
  draft: Record<string, ConfigValue>;
  mtimeMs: number | null;
  dirty: boolean;
  dirtyKeys: string[];
  getValue: (path: string) => ConfigValue | undefined;
  setValue: (path: string, v: ConfigValue) => void;
  reset: () => void;
  replaceSnapshot: (args: {
    serverValues: Record<string, ConfigValue>;
    mtimeMs: number;
  }) => void;
  buildPatch: () => Record<string, ConfigValue>;
}

export function useConfigBuffer(): ConfigBuffer {
  const [state, setState] = useState<ConfigBufferState>({
    serverValues: {},
    draft: {},
    mtimeMs: null,
  });

  const dirtyKeys = useMemo(() => {
    const out: string[] = [];
    for (const [k, v] of Object.entries(state.draft)) {
      if (!Object.is(v, state.serverValues[k])) out.push(k);
    }
    return out;
  }, [state.draft, state.serverValues]);

  const setValue = useCallback((path: string, v: ConfigValue) => {
    setState((prev) => ({
      ...prev,
      draft: { ...prev.draft, [path]: v },
    }));
  }, []);

  const getValue = useCallback(
    (path: string) =>
      path in state.draft ? state.draft[path] : state.serverValues[path],
    [state.draft, state.serverValues],
  );

  const reset = useCallback(() => {
    setState((prev) => ({ ...prev, draft: {} }));
  }, []);

  const replaceSnapshot = useCallback(
    (args: {
      serverValues: Record<string, ConfigValue>;
      mtimeMs: number;
    }) => {
      setState({
        serverValues: args.serverValues,
        draft: {},
        mtimeMs: args.mtimeMs,
      });
    },
    [],
  );

  const buildPatch = useCallback(() => {
    const patch: Record<string, ConfigValue> = {};
    for (const k of dirtyKeys) {
      patch[k] = state.draft[k] as ConfigValue;
    }
    return patch;
  }, [dirtyKeys, state.draft]);

  return {
    serverValues: state.serverValues,
    draft: state.draft,
    mtimeMs: state.mtimeMs,
    dirty: dirtyKeys.length > 0,
    dirtyKeys,
    getValue,
    setValue,
    reset,
    replaceSnapshot,
    buildPatch,
  };
}
