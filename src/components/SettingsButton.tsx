import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { useAppUpdates } from "../hooks/useAppUpdates";
import { AppUpdateSettings } from "./AppUpdateSettings";
import {
  DEFAULT_CUSTOM_ACCENT_COLOR,
  THEME_ACCENT_CHANGE_EVENT,
  THEME_ACCENT_PRESETS,
  THEME_ACCENT_STORAGE_KEY,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  getThemeAccentPreviewColor,
  loadTheme,
  loadThemeAccent,
  normalizeHexColor,
  resolveThemeAccentTokens,
  saveThemeAccent,
  type ThemeAccentPresetId,
  type ThemeAccentSetting,
  type ThemeMode,
} from "../utils/theme";
import {
  DEFAULT_TYPOGRAPHY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TYPOGRAPHY_STORAGE_KEY,
  loadTypographySettings,
  saveTypographySettings,
  type TypographySettings,
} from "../utils/typography";
import { IconCheck, IconClose, IconMinus, IconPlus, IconSettings } from "./icons";
import {
  loadWindowOpacity,
  saveWindowOpacity,
  WINDOW_OPACITY_CHANGE_EVENT,
  WINDOW_OPACITY_MAX,
  WINDOW_OPACITY_MIN,
  WINDOW_OPACITY_STORAGE_KEY,
} from "../utils/windowOpacity";
import "./SettingsButton.css";

function getInitialCustomColor(accent: ThemeAccentSetting, theme: ThemeMode) {
  if (accent.type === "custom") {
    return accent.color;
  }
  return getThemeAccentPreviewColor(accent, theme) || DEFAULT_CUSTOM_ACCENT_COLOR;
}

export function SettingsDialogContent({
  onClose,
  updates,
  titleId,
}: {
  onClose: () => void;
  updates: ReturnType<typeof useAppUpdates>;
  titleId: string;
}) {
  const [settings, setSettings] = useState(loadTypographySettings);
  const [windowOpacity, setWindowOpacity] = useState(loadWindowOpacity);
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadTheme);
  const [themeAccent, setThemeAccent] = useState<ThemeAccentSetting>(loadThemeAccent);
  const [customColorInput, setCustomColorInput] = useState(() =>
    getInitialCustomColor(loadThemeAccent(), loadTheme()),
  );
  const [customColorError, setCustomColorError] = useState<string | null>(null);

  const fontSizeId = useId();
  const opacityId = useId();
  const customColorPickerId = useId();
  const customColorInputId = useId();

  useEffect(() => {
    const syncThemeAccent = (nextAccent: ThemeAccentSetting, nextTheme: ThemeMode) => {
      setThemeAccent(nextAccent);
      setCustomColorInput(getInitialCustomColor(nextAccent, nextTheme));
      setCustomColorError(null);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === TYPOGRAPHY_STORAGE_KEY || event.key == null) {
        setSettings(loadTypographySettings());
      }
      if (event.key === WINDOW_OPACITY_STORAGE_KEY || event.key == null) {
        setWindowOpacity(loadWindowOpacity());
      }
      if (
        event.key === THEME_STORAGE_KEY ||
        event.key === THEME_ACCENT_STORAGE_KEY ||
        event.key == null
      ) {
        const nextTheme = loadTheme();
        setThemeMode(nextTheme);
        syncThemeAccent(loadThemeAccent(), nextTheme);
      }
    };
    const handleOpacityChange = (event: Event) => {
      const nextOpacity = (event as CustomEvent<number>).detail;
      if (typeof nextOpacity === "number" && Number.isFinite(nextOpacity)) {
        setWindowOpacity(nextOpacity);
      }
    };
    const handleThemeChange = (event: Event) => {
      const nextTheme = (event as CustomEvent<ThemeMode>).detail;
      if (nextTheme === "dark" || nextTheme === "light") {
        setThemeMode(nextTheme);
        setThemeAccent((current) => {
          if (current.type === "preset") {
            setCustomColorInput(getInitialCustomColor(current, nextTheme));
          }
          return current;
        });
      }
    };
    const handleThemeAccentChange = (event: Event) => {
      const nextAccent = (event as CustomEvent<ThemeAccentSetting>).detail;
      if (nextAccent) {
        syncThemeAccent(nextAccent, loadTheme());
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(WINDOW_OPACITY_CHANGE_EVENT, handleOpacityChange);
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    window.addEventListener(THEME_ACCENT_CHANGE_EVENT, handleThemeAccentChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(WINDOW_OPACITY_CHANGE_EVENT, handleOpacityChange);
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
      window.removeEventListener(THEME_ACCENT_CHANGE_EVENT, handleThemeAccentChange);
    };
  }, []);

  const updateSettings = (next: TypographySettings) => {
    setSettings(next);
    saveTypographySettings(next);
  };

  const updateWindowOpacity = (value: number) => {
    const nextOpacity = Math.min(
      WINDOW_OPACITY_MAX,
      Math.max(WINDOW_OPACITY_MIN, value),
    );
    setWindowOpacity(nextOpacity);
    saveWindowOpacity(nextOpacity);
  };

  const selectPresetAccent = (presetId: ThemeAccentPresetId) => {
    const nextAccent = saveThemeAccent({ type: "preset", presetId });
    setThemeAccent(nextAccent);
    setCustomColorInput(getInitialCustomColor(nextAccent, themeMode));
    setCustomColorError(null);
  };

  const applyCustomAccent = (rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return false;
    const nextAccent = saveThemeAccent({ type: "custom", color: normalized });
    setThemeAccent(nextAccent);
    setCustomColorInput(normalized);
    setCustomColorError(null);
    return true;
  };

  const handleCustomHexChange = (value: string) => {
    setCustomColorInput(value);
    const trimmed = value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(trimmed)) {
      const normalized = normalizeHexColor(trimmed);
      if (normalized) {
        const nextAccent = saveThemeAccent({ type: "custom", color: normalized });
        setThemeAccent(nextAccent);
        setCustomColorError(null);
      }
      return;
    }
    if (customColorError) {
      setCustomColorError(null);
    }
  };

  const commitCustomHexInput = () => {
    if (!applyCustomAccent(customColorInput)) {
      setCustomColorError("请输入有效的十六进制颜色，例如 #4f46e5");
    }
  };

  const activePickerColor =
    normalizeHexColor(customColorInput) ??
    getInitialCustomColor(themeAccent, themeMode);
  const activePreset =
    themeAccent.type === "preset"
      ? THEME_ACCENT_PRESETS.find((preset) => preset.id === themeAccent.presetId)
      : null;

  return (
    <>
      <header className="settings-dialog__header">
        <div className="settings-dialog__heading">
          <span className="settings-dialog__icon">
            <IconSettings size={20} />
          </span>
          <div>
            <h2 id={titleId}>设置</h2>
            <p>外观偏好与版本更新</p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon-only"
          aria-label="关闭设置"
          title="关闭"
          onClick={onClose}
          autoFocus
        >
          <IconClose size={17} />
        </button>
      </header>

      <div className="settings-dialog__body">
        <fieldset className="settings-dialog__field">
          <div className="settings-dialog__size-heading">
            <legend>主题色</legend>
            <output className="settings-dialog__accent-status">
              {themeAccent.type === "custom"
                ? `自定义 ${themeAccent.color.toUpperCase()}`
                : activePreset?.label ?? "默认配色"}
            </output>
          </div>

          <div
            className="settings-dialog__accent-presets"
            role="radiogroup"
            aria-label="预设主题色"
          >
            {THEME_ACCENT_PRESETS.map((preset) => {
              const isSelected =
                themeAccent.type === "preset" && themeAccent.presetId === preset.id;
              const swatchBackground =
                preset.id === "default"
                  ? preset.swatch
                  : themeMode === "light"
                    ? (preset.light ?? preset.swatch)
                    : (preset.dark ?? preset.swatch);
              const checkColor =
                preset.id === "default"
                  ? "#ffffff"
                  : (resolveThemeAccentTokens(
                      { type: "preset", presetId: preset.id },
                      themeMode,
                    )?.primaryContrast ?? "#ffffff");

              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`settings-dialog__accent-preset${isSelected ? " is-active" : ""}`}
                  title={`${preset.label} · ${preset.description}`}
                  onClick={() => selectPresetAccent(preset.id)}
                >
                  <span
                    className="settings-dialog__accent-dot"
                    style={{ background: swatchBackground, color: checkColor }}
                    aria-hidden="true"
                  >
                    {isSelected && <IconCheck size={13} stroke={2.6} />}
                  </span>
                  <span className="settings-dialog__accent-name">{preset.label}</span>
                </button>
              );
            })}
          </div>

          <div
            className={`settings-dialog__custom-accent${themeAccent.type === "custom" ? " is-active" : ""}`}
          >
            <label
              className="settings-dialog__color-picker"
              htmlFor={customColorPickerId}
              title="点击选取自定义主题色"
            >
              <span
                className="settings-dialog__color-swatch"
                style={{ backgroundColor: activePickerColor }}
                aria-hidden="true"
              />
              <input
                id={customColorPickerId}
                type="color"
                value={activePickerColor}
                aria-label="自定义主题色取色器"
                onChange={(event) => {
                  applyCustomAccent(event.target.value);
                }}
              />
            </label>
            <div className="settings-dialog__custom-accent-info">
              <label htmlFor={customColorInputId}>自定义主题色</label>
              <small>点击色块取色，或输入 Hex 色值自动适配明暗模式</small>
            </div>
            <input
              id={customColorInputId}
              type="text"
              className="settings-dialog__hex-input"
              value={customColorInput}
              maxLength={7}
              spellCheck={false}
              aria-label="自定义主题色色值"
              aria-invalid={customColorError != null}
              placeholder="#4f46e5"
              onChange={(event) => handleCustomHexChange(event.target.value)}
              onBlur={commitCustomHexInput}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitCustomHexInput();
                }
              }}
            />
          </div>
          {customColorError && (
            <p className="settings-dialog__error" role="alert">
              {customColorError}
            </p>
          )}
        </fieldset>

        <fieldset className="settings-dialog__field">
          <legend>字体</legend>
          <div className="settings-dialog__font-options">
            {([
              { value: "current", label: "当前字体", hint: "默认 · 保留现有风格" },
              { value: "system", label: "系统字体", hint: "使用系统默认字体" },
            ] as const).map((option) => (
              <label key={option.value} className="settings-dialog__font-option">
                <input
                  type="radio"
                  name="font-mode"
                  value={option.value}
                  checked={settings.fontMode === option.value}
                  onChange={() =>
                    updateSettings({ ...settings, fontMode: option.value })
                  }
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="settings-dialog__field">
          <div className="settings-dialog__size-heading">
            <label htmlFor={fontSizeId}>字体大小</label>
            <output htmlFor={fontSizeId}>{settings.fontSize} px</output>
          </div>
          <div className="settings-dialog__size-control">
            <button
              type="button"
              className="btn btn-secondary btn-icon-only"
              aria-label="减小字体"
              disabled={settings.fontSize <= FONT_SIZE_MIN}
              onClick={() =>
                updateSettings({ ...settings, fontSize: settings.fontSize - 1 })
              }
            >
              <IconMinus size={16} />
            </button>
            <input
              id={fontSizeId}
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={settings.fontSize}
              aria-valuetext={`${settings.fontSize} 像素`}
              onChange={(event) =>
                updateSettings({ ...settings, fontSize: Number(event.target.value) })
              }
            />
            <button
              type="button"
              className="btn btn-secondary btn-icon-only"
              aria-label="增大字体"
              disabled={settings.fontSize >= FONT_SIZE_MAX}
              onClick={() =>
                updateSettings({ ...settings, fontSize: settings.fontSize + 1 })
              }
            >
              <IconPlus size={16} />
            </button>
          </div>
          <div className="settings-dialog__size-labels" aria-hidden="true">
            <span>小</span>
            <span>默认 16 px</span>
            <span>大</span>
          </div>
        </div>

        <div className="settings-dialog__field">
          <div className="settings-dialog__size-heading">
            <label htmlFor={opacityId}>悬浮窗口不透明度</label>
            <output htmlFor={opacityId}>{Math.round(windowOpacity * 100)}%</output>
          </div>
          <div className="settings-dialog__size-control">
            <input
              id={opacityId}
              type="range"
              min={Math.round(WINDOW_OPACITY_MIN * 100)}
              max={Math.round(WINDOW_OPACITY_MAX * 100)}
              step={5}
              value={Math.round(windowOpacity * 100)}
              aria-valuetext={`${Math.round(windowOpacity * 100)}% 不透明度`}
              onChange={(event) =>
                updateWindowOpacity(Number(event.target.value) / 100)
              }
            />
          </div>
          <p className="settings-dialog__hint">
            适用于置顶待办和固定待办。窗口上按住 Ctrl 并滚动滚轮可调整，向上增加、向下减少，每格 5%。
          </p>
        </div>

        <div className="settings-dialog__preview">
          <div className="settings-dialog__preview-top">
            <span>外观与字体预览</span>
            <span className="settings-dialog__preview-badge">主题色效果</span>
          </div>
          <p>专注当下，把时间留给重要的事。</p>
          <small>doTime · 今天也要一步一步来 0123456789</small>
          <div className="settings-dialog__preview-bar" aria-hidden="true">
            <span />
          </div>
        </div>
        <AppUpdateSettings updates={updates} />
      </div>

      <footer className="settings-dialog__footer">
        <div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              selectPresetAccent("default");
              updateSettings({ ...DEFAULT_TYPOGRAPHY });
              updateWindowOpacity(WINDOW_OPACITY_MAX);
            }}
          >
            恢复默认
          </button>
          <p>修改即时生效，自动保存</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
          完成
        </button>
      </footer>
    </>
  );
}

function SettingsDialog({ onClose, updates }: {
  onClose: () => void;
  updates: ReturnType<typeof useAppUpdates>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);

  const closeDialog = () => {
    dialogRef.current?.close();
    onClose();
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          closeDialog();
        }
      }}
    >
      <SettingsDialogContent
        onClose={closeDialog}
        updates={updates}
        titleId={titleId}
      />
    </dialog>,
    document.body,
  );
}

export function SettingsButton({ updates }: { updates: ReturnType<typeof useAppUpdates> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-icon-only settings-toggle"
        aria-label="打开设置"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="设置"
        onClick={() => setOpen(true)}
      >
        <IconSettings size={17} />
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} updates={updates} />}
    </>
  );
}
