export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "dotime-theme";

export function loadTheme(): ThemeMode {
  try {
    const storedTheme = localStorage.getItem(STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
  } catch {
    /* ignore storage errors */
  }
  return "dark";
}

export function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.background =
    theme === "light" ? "#f4f7fb" : "#0b0d12";
  if (document.body) {
    document.body.style.background = theme === "light" ? "#f4f7fb" : "#0b0d12";
  }
}

export function saveTheme(theme: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore storage errors */
  }
  applyTheme(theme);
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === "dark" ? "light" : "dark";
}
