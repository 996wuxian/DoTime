export type ThemeMode = "dark" | "light";

export type ThemeAccentPresetId =
  | "default"
  | "ocean"
  | "indigo"
  | "violet"
  | "sakura"
  | "rose"
  | "coral"
  | "amber"
  | "emerald"
  | "cyan";

export type ThemeAccentSetting =
  | { type: "preset"; presetId: ThemeAccentPresetId }
  | { type: "custom"; color: string };

export interface ThemeAccentPreset {
  id: ThemeAccentPresetId;
  label: string;
  description: string;
  swatch: string;
  light?: string;
  dark?: string;
}

export interface ThemeAccentTokens {
  primary: string;
  primaryHover: string;
  primarySoft: string;
  primaryContrast: string;
  primaryRgb: string;
  primaryGradientStart: string;
  appAccentStart: string;
  appAccentEnd: string;
}

export const THEME_STORAGE_KEY = "dotime-theme";
export const THEME_ACCENT_STORAGE_KEY = "dotime-theme-accent";
export const THEME_CHANGE_EVENT = "dotime-theme-changed";
export const THEME_ACCENT_CHANGE_EVENT = "dotime-theme-accent-changed";

export const DEFAULT_CUSTOM_ACCENT_COLOR = "#4f46e5";

export const DEFAULT_THEME_ACCENT: ThemeAccentSetting = {
  type: "preset",
  presetId: "default",
};

export const THEME_ACCENT_PRESETS: readonly ThemeAccentPreset[] = [
  {
    id: "default",
    label: "默认配色",
    description: "亮色青碧 / 暗色晴蓝",
    swatch: "linear-gradient(135deg, #0f766e 50%, #6ea8ff 50%)",
  },
  {
    id: "ocean",
    label: "晴空蓝",
    description: "清爽利落",
    swatch: "#2563eb",
    light: "#2563eb",
    dark: "#3b82f6",
  },
  {
    id: "indigo",
    label: "暮色靛",
    description: "沉静专注",
    swatch: "#4f46e5",
    light: "#4f46e5",
    dark: "#6d75ff",
  },
  {
    id: "violet",
    label: "紫藤雾",
    description: "优雅柔和",
    swatch: "#7c3aed",
    light: "#7c3aed",
    dark: "#936bff",
  },
  {
    id: "sakura",
    label: "樱花莓",
    description: "轻盈明丽",
    swatch: "#db2777",
    light: "#db2777",
    dark: "#ec4899",
  },
  {
    id: "rose",
    label: "山茶玫",
    description: "温润炽热",
    swatch: "#e11d48",
    light: "#e11d48",
    dark: "#f43f5e",
  },
  {
    id: "coral",
    label: "日落橘",
    description: "温暖活力",
    swatch: "#ea580c",
    light: "#ea580c",
    dark: "#f97316",
  },
  {
    id: "amber",
    label: "琥珀金",
    description: "复古温雅",
    swatch: "#b45309",
    light: "#b45309",
    dark: "#f59e0b",
  },
  {
    id: "emerald",
    label: "松林绿",
    description: "自然护眼",
    swatch: "#059669",
    light: "#059669",
    dark: "#10b981",
  },
  {
    id: "cyan",
    label: "冰川青",
    description: "清透克制",
    swatch: "#0891b2",
    light: "#0891b2",
    dark: "#06b6d4",
  },
];

const PRESET_MAP = new Map<ThemeAccentPresetId, ThemeAccentPreset>(
  THEME_ACCENT_PRESETS.map((preset) => [preset.id, preset]),
);

const ACCENT_CSS_VARIABLES = [
  "--primary",
  "--primary-hover",
  "--primary-soft",
  "--primary-contrast",
  "--primary-rgb",
  "--primary-gradient-start",
  "--app-accent-start",
  "--app-accent-end",
] as const;

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  if (raw.length === 3) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  }
  return `#${raw}`;
}

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_CUSTOM_ACCENT_COLOR;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (channel: number) =>
    clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h = 0;
  if (max === rn) {
    h = (gn - bn) / delta + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = (bn - rn) / delta + 2;
  } else {
    h = (rn - gn) / delta + 4;
  }
  return { h: (h * 60) % 360, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360;
  if (s === 0) {
    const channel = Math.round(clamp(l, 0, 1) * 255);
    return { r: channel, g: channel, b: channel };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToChannel = (t: number) => {
    let normalized = t;
    if (normalized < 0) normalized += 1;
    if (normalized > 1) normalized -= 1;
    if (normalized < 1 / 6) return p + (q - p) * 6 * normalized;
    if (normalized < 1 / 2) return q;
    if (normalized < 2 / 3) return p + (q - p) * (2 / 3 - normalized) * 6;
    return p;
  };

  const hNorm = hue / 360;
  return {
    r: Math.round(hueToChannel(hNorm + 1 / 3) * 255),
    g: Math.round(hueToChannel(hNorm) * 255),
    b: Math.round(hueToChannel(hNorm - 1 / 3) * 255),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const linearize = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function perceivedBrightness({ r, g, b }: Rgb): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function pickPrimaryContrast(rgb: Rgb): string {
  const lum = relativeLuminance(rgb);
  const yiq = perceivedBrightness(rgb);
  // Prefer crisp white text/icons across medium-saturation accents (cyan, emerald, coral, etc.).
  // Only switch to a harmonized deep tint of the same hue on genuinely light/bright surfaces.
  if (lum < 0.42 && yiq < 175) {
    return "#ffffff";
  }
  const hsl = rgbToHsl(rgb);
  return rgbToHex(
    hslToRgb({
      h: hsl.h,
      s: hsl.s > 0.08 ? clamp(hsl.s * 0.55, 0.25, 0.55) : 0.08,
      l: 0.13,
    }),
  );
}

function rgbaString({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function resolveThemeAccentTokens(
  accent: ThemeAccentSetting,
  theme: ThemeMode,
): ThemeAccentTokens | null {
  if (accent.type === "preset" && accent.presetId === "default") {
    return null;
  }

  let primaryHex: string;
  if (accent.type === "preset") {
    const preset = PRESET_MAP.get(accent.presetId);
    if (!preset || !preset.light || !preset.dark) {
      return null;
    }
    primaryHex = theme === "light" ? preset.light : preset.dark;
  } else {
    const normalized = normalizeHexColor(accent.color);
    if (!normalized) return null;
    const baseHsl = rgbToHsl(hexToRgb(normalized));
    if (theme === "dark") {
      // Keep the user's hue while ensuring dark-surface legibility without washing it out.
      const adjustedL =
        baseHsl.l < 0.5
          ? clamp(baseHsl.l * 0.4 + 0.4, 0.5, 0.62)
          : clamp(baseHsl.l, 0.5, 0.74);
      const adjustedS = baseHsl.s > 0.05 ? clamp(baseHsl.s, 0.42, 0.94) : baseHsl.s;
      primaryHex = rgbToHex(hslToRgb({ h: baseHsl.h, s: adjustedS, l: adjustedL }));
    } else {
      // Preserve custom color closely in light mode; only tame ultra-light values.
      const adjustedL = baseHsl.l > 0.74 ? 0.48 : clamp(baseHsl.l, 0.24, 0.62);
      primaryHex = rgbToHex(hslToRgb({ h: baseHsl.h, s: baseHsl.s, l: adjustedL }));
    }
  }

  const primaryRgb = hexToRgb(primaryHex);
  const primaryHsl = rgbToHsl(primaryRgb);

  const hoverHsl: Hsl =
    theme === "dark"
      ? {
          h: primaryHsl.h,
          s: primaryHsl.s,
          l: clamp(primaryHsl.l + 0.07, 0.64, 0.88),
        }
      : {
          h: primaryHsl.h,
          s: clamp(primaryHsl.s + 0.04, 0, 1),
          l:
            primaryHsl.l > 0.45
              ? clamp(primaryHsl.l - 0.06, 0.2, 0.6)
              : clamp(primaryHsl.l + 0.06, 0.28, 0.58),
        };

  const gradientStartHsl: Hsl =
    theme === "dark"
      ? {
          h: (primaryHsl.h - 18 + 360) % 360,
          s: clamp(primaryHsl.s + 0.05, 0, 0.95),
          l: clamp(primaryHsl.l + 0.08, 0.68, 0.86),
        }
      : {
          h: (primaryHsl.h - 16 + 360) % 360,
          s: clamp(primaryHsl.s + 0.06, 0, 0.92),
          l: clamp(primaryHsl.l + 0.14, 0.48, 0.7),
        };

  const accentEndRgb = hslToRgb({
    h: (primaryHsl.h + 26) % 360,
    s: clamp(primaryHsl.s * 0.9, 0, 0.9),
    l: theme === "dark" ? clamp(primaryHsl.l, 0.56, 0.74) : clamp(primaryHsl.l + 0.06, 0.36, 0.58),
  });

  return {
    primary: primaryHex,
    primaryHover: rgbToHex(hslToRgb(hoverHsl)),
    primarySoft: rgbaString(primaryRgb, theme === "light" ? 0.12 : 0.16),
    primaryContrast: pickPrimaryContrast(primaryRgb),
    primaryRgb: `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}`,
    primaryGradientStart: rgbToHex(hslToRgb(gradientStartHsl)),
    appAccentStart: rgbaString(primaryRgb, theme === "light" ? 0.1 : 0.16),
    appAccentEnd: rgbaString(accentEndRgb, theme === "light" ? 0.08 : 0.1),
  };
}

export function getThemeAccentPreviewColor(
  accent: ThemeAccentSetting,
  theme: ThemeMode,
): string {
  if (accent.type === "custom") {
    return normalizeHexColor(accent.color) ?? DEFAULT_CUSTOM_ACCENT_COLOR;
  }
  if (accent.presetId === "default") {
    return theme === "light" ? "#0f766e" : "#6ea8ff";
  }
  const preset = PRESET_MAP.get(accent.presetId);
  if (!preset) return theme === "light" ? "#0f766e" : "#6ea8ff";
  return (theme === "light" ? preset.light : preset.dark) ?? preset.swatch;
}

export function loadTheme(): ThemeMode {
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
  } catch {
    /* ignore storage errors */
  }
  return "light";
}

export function loadThemeAccent(): ThemeAccentSetting {
  try {
    const raw = localStorage.getItem(THEME_ACCENT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME_ACCENT };
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") {
      return { ...DEFAULT_THEME_ACCENT };
    }
    const candidate = parsed as Partial<ThemeAccentSetting>;
    if (
      candidate.type === "preset" &&
      typeof candidate.presetId === "string" &&
      PRESET_MAP.has(candidate.presetId as ThemeAccentPresetId)
    ) {
      return {
        type: "preset",
        presetId: candidate.presetId as ThemeAccentPresetId,
      };
    }
    if (candidate.type === "custom" && typeof candidate.color === "string") {
      const normalized = normalizeHexColor(candidate.color);
      if (normalized) {
        return { type: "custom", color: normalized };
      }
    }
  } catch {
    /* ignore storage errors */
  }
  return { ...DEFAULT_THEME_ACCENT };
}

export function applyThemeAccent(
  accent: ThemeAccentSetting,
  theme: ThemeMode = loadTheme(),
) {
  const root = document.documentElement;
  const tokens = resolveThemeAccentTokens(accent, theme);
  if (!tokens) {
    for (const variable of ACCENT_CSS_VARIABLES) {
      root.style.removeProperty(variable);
    }
    return;
  }

  root.style.setProperty("--primary", tokens.primary);
  root.style.setProperty("--primary-hover", tokens.primaryHover);
  root.style.setProperty("--primary-soft", tokens.primarySoft);
  root.style.setProperty("--primary-contrast", tokens.primaryContrast);
  root.style.setProperty("--primary-rgb", tokens.primaryRgb);
  root.style.setProperty("--primary-gradient-start", tokens.primaryGradientStart);
  root.style.setProperty("--app-accent-start", tokens.appAccentStart);
  root.style.setProperty("--app-accent-end", tokens.appAccentEnd);
}

export function applyTheme(theme: ThemeMode, accent: ThemeAccentSetting = loadThemeAccent()) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.background =
    theme === "light" ? "#f4f7fb" : "#0b0d12";
  if (document.body) {
    document.body.style.background = theme === "light" ? "#f4f7fb" : "#0b0d12";
  }
  applyThemeAccent(accent, theme);
}

export function saveTheme(theme: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore storage errors */
  }
  applyTheme(theme);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: theme }),
    );
  }
}

export function saveThemeAccent(accent: ThemeAccentSetting): ThemeAccentSetting {
  let sanitized: ThemeAccentSetting = { ...DEFAULT_THEME_ACCENT };
  if (accent.type === "preset" && PRESET_MAP.has(accent.presetId)) {
    sanitized = { type: "preset", presetId: accent.presetId };
  } else if (accent.type === "custom") {
    const normalized = normalizeHexColor(accent.color);
    if (normalized) {
      sanitized = { type: "custom", color: normalized };
    }
  }

  try {
    localStorage.setItem(THEME_ACCENT_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    /* ignore storage errors */
  }

  applyThemeAccent(sanitized, loadTheme());
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ThemeAccentSetting>(THEME_ACCENT_CHANGE_EVENT, {
        detail: sanitized,
      }),
    );
  }
  return sanitized;
}

export function initializeThemeSettings() {
  applyTheme(loadTheme(), loadThemeAccent());
  window.addEventListener("storage", (event) => {
    if (
      event.key === THEME_STORAGE_KEY ||
      event.key === THEME_ACCENT_STORAGE_KEY ||
      event.key == null
    ) {
      applyTheme(loadTheme(), loadThemeAccent());
    }
  });
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === "dark" ? "light" : "dark";
}
