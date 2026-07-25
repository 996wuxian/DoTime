/**
 * 无边框窗口自绘标题按钮（与 code2img 一致）
 */
import { useCallback, useEffect, useState } from "react";
import { IconClose, IconMaximize, IconMinimize } from "./icons";

type Props = {
  visible?: boolean;
};

export function WindowControls({ visible = true }: Props) {
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      setMaximized(await getCurrentWindow().isMaximized());
    } catch {
      /* browser */
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refreshMaximized();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        unlisten = await w.onResized(() => {
          void refreshMaximized();
        });
        if (cancelled && unlisten) unlisten();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [visible, refreshMaximized]);

  const winChrome = async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if (action === "minimize") await w.minimize();
      if (action === "toggleMaximize") {
        await w.toggleMaximize();
        await refreshMaximized();
      }
      if (action === "close") await w.close();
    } catch {
      /* ignore */
    }
  };

  if (!visible) return null;

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-controls__btn"
        aria-label="最小化"
        title="最小化"
        onClick={(e) => {
          e.stopPropagation();
          void winChrome("minimize");
        }}
      >
        <IconMinimize size={14} />
      </button>
      <button
        type="button"
        className="window-controls__btn"
        aria-label={maximized ? "还原" : "最大化"}
        title={maximized ? "还原" : "最大化"}
        onClick={(e) => {
          e.stopPropagation();
          void winChrome("toggleMaximize");
        }}
      >
        <IconMaximize size={12} />
      </button>
      <button
        type="button"
        className="window-controls__btn window-controls__btn--close"
        aria-label="关闭"
        title="关闭"
        onClick={(e) => {
          e.stopPropagation();
          void winChrome("close");
        }}
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}

export async function toggleMaximizeFromTitlebar(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  } catch {
    /* ignore */
  }
}
