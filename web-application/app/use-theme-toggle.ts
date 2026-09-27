"use client"

import { useEffect, useState } from "react"
import { useColorScheme } from "nativewind"

const STORAGE_KEY = "theme"

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark")
  document.documentElement.classList.toggle("light", theme === "light")
}

// See README "Architecture boundaries" (Theme toggle) for why this doesn't
// trust NativeWind's own colorScheme and persists to localStorage.
export function useThemeToggle() {
  const { setColorScheme } = useColorScheme()
  const [theme, setTheme] = useState<"light" | "dark">("light")

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const initial: "light" | "dark" =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
    applyTheme(initial)
    setColorScheme(initial)
    setTheme(initial)
  }, [setColorScheme])

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark"
    applyTheme(next)
    localStorage.setItem(STORAGE_KEY, next)
    setColorScheme(next)
    setTheme(next)
  }

  return { theme, toggleTheme }
}
