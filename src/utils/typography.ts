export type FontMode = "current" | "system";

export interface TypographySettings {
  fontMode: FontMode;
  fontSize: number;
}

export const TYPOGRAPHY_STORAGE_KEY = "dotime-typography";
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 24;
export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  fontMode: "current",
  fontSize: 16,
};

export function loadTypographySettings(): TypographySettings {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(TYPOGRAPHY_STORAGE_KEY) ?? "null",
    );
    if (stored == null || typeof stored !== "object") {
      return { ...DEFAULT_TYPOGRAPHY };
    }
    const { fontMode, fontSize } = stored as Partial<TypographySettings>;
    return {
      fontMode: fontMode === "system" ? "system" : "current",
      fontSize:
        typeof fontSize === "number" && Number.isFinite(fontSize)
          ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(fontSize)))
          : DEFAULT_TYPOGRAPHY.fontSize,
    };
  } catch {
    return { ...DEFAULT_TYPOGRAPHY };
  }
}

function applyTypographySettings(settings: TypographySettings) {
  document.documentElement.dataset.fontMode = settings.fontMode;
  document.documentElement.style.fontSize = `${settings.fontSize}px`;
}

export function saveTypographySettings(settings: TypographySettings) {
  try {
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* Keep the current window usable even when storage is unavailable. */
  }
  applyTypographySettings(settings);
}

export function initializeTypographySettings() {
  applyTypographySettings(loadTypographySettings());
  window.addEventListener("storage", (event) => {
    if (event.key === TYPOGRAPHY_STORAGE_KEY || event.key == null) {
      applyTypographySettings(loadTypographySettings());
    }
  });
}
