import { useState } from "react";

/** useState mirrored into sessionStorage (a per-tab convenience; works without storage). */
export function useStoredState(key: string): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const set = (v: string | null) => {
    setValue(v);
    try {
      if (v === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [value, set];
}
