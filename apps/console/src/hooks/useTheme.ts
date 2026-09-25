import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const THEME_KEY = 'xpark-media-foundry:theme'
/** Light (day) mode only — the console ships a single theme. */
const DEFAULT_THEME: Theme = 'light'

export function readStoredTheme(): Theme {
  // Day mode is enforced; the stored preference is intentionally ignored.
  return DEFAULT_THEME
}

/**
 * Apply the theme to <html>. `data-theme` drives the app's own remapped
 * utilities (zinc/white variables and dark-surface overrides in index.css);
 * the `dark` class drives the shadcn/ui semantic tokens.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
}

/**
 * Day/night theme state, persisted to localStorage (mirrors the storage
 * pattern used by the SLO settings and chat sessions hooks). Callers only
 * need `toggle`; application to the DOM happens inside this hook and once
 * pre-paint in `main.tsx` so the stored theme shows without a flash.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(THEME_KEY, next)
      } catch {
        // ignore storage errors (private mode, quota, etc.)
      }
      return next
    })
  }, [])

  return { theme, toggle }
}
