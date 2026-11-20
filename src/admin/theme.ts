/** Day / night preference for the admin console. Stored per device; every storage call is guarded. */
export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'theme';

export function getThemePref(): ThemePref {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Sets `data-theme` on <html>; "system" removes it so the device preference decides. */
export function applyTheme(pref: ThemePref = getThemePref()): void {
  const el = document.documentElement;
  if (pref === 'system') delete el.dataset.theme;
  else el.dataset.theme = pref;
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, pref);
  } catch {
    /* private window or blocked storage: the choice still applies until reload */
  }
  applyTheme(pref);
}
