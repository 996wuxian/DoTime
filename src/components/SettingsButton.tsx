import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { useAppUpdates } from "../hooks/useAppUpdates";
import { AppUpdateSettings } from "./AppUpdateSettings";
import {
  DEFAULT_TYPOGRAPHY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TYPOGRAPHY_STORAGE_KEY,
  loadTypographySettings,
  saveTypographySettings,
  type TypographySettings,
} from "../utils/typography";
import { IconClose, IconMinus, IconPlus, IconSettings } from "./icons";
import {
  loadWindowOpacity,
  saveWindowOpacity,
  WINDOW_OPACITY_CHANGE_EVENT,
  WINDOW_OPACITY_MAX,
  WINDOW_OPACITY_MIN,
  WINDOW_OPACITY_STORAGE_KEY,
} from "../utils/windowOpacity";
import "./SettingsButton.css";

function SettingsDialog({ onClose, updates }: {
  onClose: () => void;
  updates: ReturnType<typeof useAppUpdates>;
}) {
  const [settings, setSettings] = useState(loadTypographySettings);
  const [windowOpacity, setWindowOpacity] = useState(loadWindowOpacity);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fontSizeId = useId();
  const opacityId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === TYPOGRAPHY_STORAGE_KEY || event.key == null) {
        setSettings(loadTypographySettings());
      }
      if (event.key === WINDOW_OPACITY_STORAGE_KEY || event.key == null) {
        setWindowOpacity(loadWindowOpacity());
      }
    };
    const handleOpacityChange = (event: Event) => {
      const nextOpacity = (event as CustomEvent<number>).detail;
      if (typeof nextOpacity === "number" && Number.isFinite(nextOpacity)) {
        setWindowOpacity(nextOpacity);
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(WINDOW_OPACITY_CHANGE_EVENT, handleOpacityChange);
    return () => {
      dialog?.close();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(WINDOW_OPACITY_CHANGE_EVENT, handleOpacityChange);
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
      <header className="settings-dialog__header">
        <div className="settings-dialog__heading">
          <span className="settings-dialog__icon">
            <IconSettings size={20} />
          </span>
          <div>
            <h2 id={titleId}>设置</h2>
            <p>阅读偏好与版本更新</p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon-only"
          aria-label="关闭设置"
          title="关闭"
          onClick={closeDialog}
          autoFocus
        >
          <IconClose size={17} />
        </button>
      </header>

      <div className="settings-dialog__body">
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
          <span>字体预览</span>
          <p>专注当下，把时间留给重要的事。</p>
          <small>doTime · 今天也要一步一步来 0123456789</small>
        </div>
        <AppUpdateSettings updates={updates} />
      </div>

      <footer className="settings-dialog__footer">
        <div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              updateSettings({ ...DEFAULT_TYPOGRAPHY });
              updateWindowOpacity(WINDOW_OPACITY_MAX);
            }}
          >
            恢复默认
          </button>
          <p>修改即时生效，自动保存</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={closeDialog}>
          完成
        </button>
      </footer>
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
