import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_ACCENT,
  THEME_ACCENT_PRESETS,
  THEME_ACCENT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  applyTheme,
  applyThemeAccent,
  loadThemeAccent,
  normalizeHexColor,
  resolveThemeAccentTokens,
  saveTheme,
  saveThemeAccent,
} from "./theme";

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

function createFakeDocument() {
  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  return {
    documentElement: {
      setAttribute: (name: string, value: string) => attrs.set(name, value),
      getAttribute: (name: string) => attrs.get(name) ?? null,
      style: {
        colorScheme: "",
        background: "",
        setProperty: (name: string, value: string) => props.set(name, value),
        removeProperty: (name: string) => {
          props.delete(name);
          return "";
        },
        getPropertyValue: (name: string) => props.get(name) ?? "",
      },
    },
    body: {
      style: {
        background: "",
      },
    },
    props,
    attrs,
  };
}

describe("theme accent utilities", () => {
  let fakeDoc: ReturnType<typeof createFakeDocument>;

  beforeEach(() => {
    fakeDoc = createFakeDocument();
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal("document", fakeDoc);
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes valid 3-digit and 6-digit hex colors and rejects invalid inputs", () => {
    expect(normalizeHexColor("#4F46E5")).toBe("#4f46e5");
    expect(normalizeHexColor(" 4f46e5 ")).toBe("#4f46e5");
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    expect(normalizeHexColor("f60")).toBe("#ff6600");

    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("#gggggg")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor("#000; background:url(x)")).toBeNull();
  });

  it("provides curated presets including default and valid light/dark tokens", () => {
    expect(THEME_ACCENT_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(THEME_ACCENT_PRESETS[0].id).toBe("default");
    expect(
      resolveThemeAccentTokens(DEFAULT_THEME_ACCENT, "light"),
    ).toBeNull();
    expect(
      resolveThemeAccentTokens(DEFAULT_THEME_ACCENT, "dark"),
    ).toBeNull();

    for (const preset of THEME_ACCENT_PRESETS) {
      if (preset.id === "default") continue;
      for (const mode of ["light", "dark"] as const) {
        const tokens = resolveThemeAccentTokens(
          { type: "preset", presetId: preset.id },
          mode,
        );
        expect(tokens).not.toBeNull();
        expect(tokens?.primary).toMatch(/^#[0-9a-f]{6}$/);
        expect(tokens?.primaryHover).toMatch(/^#[0-9a-f]{6}$/);
        expect(tokens?.primaryRgb).toMatch(/^\d+, \d+, \d+$/);
        expect(tokens?.primaryContrast).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("uses crisp white foreground on medium-saturation accents and harmonized dark tint on very bright accents", () => {
    for (const presetId of ["cyan", "emerald", "coral", "sakura", "ocean"] as const) {
      const lightTokens = resolveThemeAccentTokens(
        { type: "preset", presetId },
        "light",
      );
      expect(lightTokens?.primaryContrast).toBe("#ffffff");
    }

    const brightAmberDark = resolveThemeAccentTokens(
      { type: "preset", presetId: "amber" },
      "dark",
    );
    expect(brightAmberDark?.primaryContrast).toMatch(/^#[0-9a-f]{6}$/);
    expect(brightAmberDark?.primaryContrast).not.toBe("#ffffff");
    expect(brightAmberDark?.primaryContrast).not.toBe("#0b0d12");

    const brightCustomDark = resolveThemeAccentTokens(
      { type: "custom", color: "#facc15" },
      "dark",
    );
    expect(brightCustomDark?.primaryContrast).toMatch(/^#[0-9a-f]{6}$/);
    expect(brightCustomDark?.primaryContrast).not.toBe("#ffffff");
  });

  it("adapts custom colors for both light and dark modes with readable contrast", () => {
    const darkTokens = resolveThemeAccentTokens(
      { type: "custom", color: "#1e1b4b" },
      "dark",
    );
    expect(darkTokens).not.toBeNull();
    expect(darkTokens?.primary).not.toBe("#1e1b4b");

    const lightTokens = resolveThemeAccentTokens(
      { type: "custom", color: "#fef08a" },
      "light",
    );
    expect(lightTokens).not.toBeNull();
    expect(lightTokens?.primary).not.toBe("#fef08a");

    const balancedLight = resolveThemeAccentTokens(
      { type: "custom", color: "#4f46e5" },
      "light",
    );
    expect(balancedLight?.primary).toBe("#4f46e5");
    expect(balancedLight?.primaryContrast).toBe("#ffffff");
  });

  it("loads fallback default accent when storage is missing, malformed, or unknown", () => {
    expect(loadThemeAccent()).toEqual(DEFAULT_THEME_ACCENT);

    localStorage.setItem(THEME_ACCENT_STORAGE_KEY, "{broken json");
    expect(loadThemeAccent()).toEqual(DEFAULT_THEME_ACCENT);

    localStorage.setItem(
      THEME_ACCENT_STORAGE_KEY,
      JSON.stringify({ type: "preset", presetId: "non-existent" }),
    );
    expect(loadThemeAccent()).toEqual(DEFAULT_THEME_ACCENT);

    localStorage.setItem(
      THEME_ACCENT_STORAGE_KEY,
      JSON.stringify({ type: "custom", color: "javascript:alert(1)" }),
    );
    expect(loadThemeAccent()).toEqual(DEFAULT_THEME_ACCENT);
  });

  it("persists accent, applies CSS variables, re-applies on theme toggle, and cleans up on default", () => {
    saveTheme("light");
    const saved = saveThemeAccent({ type: "custom", color: "#E11D48" });
    expect(saved).toEqual({ type: "custom", color: "#e11d48" });
    expect(loadThemeAccent()).toEqual({ type: "custom", color: "#e11d48" });
    expect(fakeDoc.props.get("--primary")).toBe("#e11d48");
    expect(fakeDoc.props.get("--primary-rgb")).toBe("225, 29, 72");

    const lightPrimary = fakeDoc.props.get("--primary");
    saveTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(fakeDoc.attrs.get("data-theme")).toBe("dark");
    expect(fakeDoc.props.get("--primary")).not.toBe(lightPrimary);

    saveThemeAccent(DEFAULT_THEME_ACCENT);
    expect(fakeDoc.props.has("--primary")).toBe(false);
    expect(fakeDoc.props.has("--primary-rgb")).toBe(false);
  });

  it("re-applies stored accent when applyTheme is called directly", () => {
    saveThemeAccent({ type: "preset", presetId: "indigo" });
    applyTheme("light");
    expect(fakeDoc.props.get("--primary")).toBe("#4f46e5");
    applyTheme("dark");
    expect(fakeDoc.props.get("--primary")).toBe("#6d75ff");
    applyThemeAccent(DEFAULT_THEME_ACCENT, "dark");
    expect(fakeDoc.props.has("--primary")).toBe(false);
  });
});
