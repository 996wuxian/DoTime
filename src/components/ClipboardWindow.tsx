import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconClipboardText,
  IconClose,
  IconCode,
  IconDockBottom,
  IconDockTop,
  IconPhoto,
  IconSearch,
  IconTrash,
} from "./icons";

const CLIPBOARD_HISTORY_LIMIT = 100;

type ClipboardKind = "text" | "image";

type ClipboardSnapshot = {
  id: string;
  kind: ClipboardKind;
  capturedAt: number;
  text?: string | null;
  imageDataUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  byteSize?: number | null;
  pinned: boolean;
  copyCount: number;
};

function isCodeLike(text: string) {
  return (
    /```|<\/?[a-z][\s\S]*>|^\s*(import|export|const|let|var|function|class|def|fn|use|SELECT|UPDATE|INSERT)\b/m.test(
      text,
    ) || /[{};][\r\n]/.test(text)
  );
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function formatByteSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatHistorySize(bytes: number) {
  if (bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function getClipboardLabel(item: ClipboardSnapshot) {
  if (item.kind === "image") return "图片";
  return isCodeLike(item.text ?? "") ? "代码片段" : "文字";
}

function getClipboardIcon(item: ClipboardSnapshot) {
  if (item.kind === "image") return <IconPhoto size={16} />;
  return isCodeLike(item.text ?? "") ? (
    <IconCode size={16} />
  ) : (
    <IconClipboardText size={16} />
  );
}

function normalizePasteItem(event: ClipboardEvent): ClipboardSnapshot | null {
  const data = event.clipboardData;
  if (!data) return null;

  const imageFile = Array.from(data.files).find((file) =>
    file.type.startsWith("image/"),
  );
  if (imageFile) {
    return {
      id: `paste-image-${Date.now()}`,
      kind: "image",
      capturedAt: Date.now(),
      imageDataUrl: URL.createObjectURL(imageFile),
      byteSize: imageFile.size,
      pinned: false,
      copyCount: 0,
    };
  }

  const text = data.getData("text/plain");
  if (!text) return null;
  return {
    id: `paste-text-${Date.now()}`,
    kind: "text",
    capturedAt: Date.now(),
    text,
    byteSize: new Blob([text]).size,
    pinned: false,
    copyCount: 0,
  };
}

function getSearchableText(item: ClipboardSnapshot) {
  return [
    getClipboardLabel(item),
    formatTime(item.capturedAt),
    item.text ?? "",
    item.imageWidth && item.imageHeight
      ? `${item.imageWidth} x ${item.imageHeight}`
      : "",
    formatByteSize(item.byteSize),
  ]
    .join(" ")
    .toLowerCase();
}

function getClientFingerprint(item: ClipboardSnapshot) {
  if (item.text) return `text:${item.text}`;
  if (item.imageDataUrl) {
    return `image:${item.imageWidth ?? 0}:${item.imageHeight ?? 0}:${
      item.imageDataUrl.length
    }`;
  }
  return `${item.kind}:${item.imageWidth ?? 0}:${item.byteSize ?? 0}`;
}

function sortClipboardItems(items: ClipboardSnapshot[]) {
  return [...items].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      right.copyCount - left.copyCount ||
      right.capturedAt - left.capturedAt,
  );
}

async function closeClipboardWindow() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("close_clipboard_window");
}

function getErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "复制失败，请重新复制原内容后再试。";
}

export function ClipboardWindow() {
  const [items, setItems] = useState<ClipboardSnapshot[]>([]);
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [tauriReady, setTauriReady] = useState(false);
  const [historySize, setHistorySize] = useState<number | null>(null);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    document.body.classList.add("is-clipboard-window");
    searchRef.current?.focus();
    return () => {
      document.body.classList.remove("is-clipboard-window");
      if (copiedTimerRef.current != null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("dotime-clipboard-closed", () => {
          if (!cancelled) setEnabled(false);
        }),
      )
      .then((cleanup) => {
        if (cancelled) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => {
        /* browser */
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const refreshHistorySize = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const size = await invoke<number>("get_clipboard_history_size");
        if (!disposed) setHistorySize(size);
      } catch {
        /* browser */
      }
    };

    void refreshHistorySize();
    const timer = window.setInterval(() => void refreshHistorySize(), 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/event"),
        ]);

        const history = await invoke<ClipboardSnapshot[]>("get_clipboard_history");
        if (cancelled) return;
        setItems(history);
        setTauriReady(true);

        const imageIds = history
          .filter((item) => item.kind === "image")
          .map((item) => item.id);
        const IMAGE_LOAD_CONCURRENCY = 3;
        let nextImageIndex = 0;
        const loadImageWorker = async () => {
          while (!cancelled) {
            const id = imageIds[nextImageIndex++];
            if (id == null) return;
            try {
              const full = await invoke<ClipboardSnapshot | null>(
                "get_clipboard_history_image",
                { id },
              );
              if (cancelled || full == null || !full.imageDataUrl) continue;
              setItems((current) =>
                current.map((item) =>
                  item.id === id
                    ? { ...item, imageDataUrl: full.imageDataUrl }
                    : item,
                ),
              );
            } catch (error) {
              console.error("failed to load clipboard image preview", error);
            }
          }
        };
        void Promise.all(
          Array.from(
            { length: Math.min(IMAGE_LOAD_CONCURRENCY, imageIds.length) },
            () => loadImageWorker(),
          ),
        );

        unlisten = await listen<ClipboardSnapshot>(
          "dotime-clipboard-changed",
          (event) => {
            if (!enabledRef.current) return;
            const incomingFingerprint = getClientFingerprint(event.payload);
            setItems((current) =>
              sortClipboardItems([
                event.payload,
                ...current.filter(
                  (item) =>
                    item.id !== event.payload.id &&
                    getClientFingerprint(item) !== incomingFingerprint,
                ),
              ]).slice(0, CLIPBOARD_HISTORY_LIMIT),
            );
          },
        );

        if (cancelled) unlisten();
      } catch {
        if (!cancelled) setTauriReady(false);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!enabledRef.current) return;
      const item = normalizePasteItem(event);
      if (!item) return;
      const incomingFingerprint = getClientFingerprint(item);
      setItems((current) =>
        sortClipboardItems([
          item,
          ...current.filter(
            (currentItem) =>
              getClientFingerprint(currentItem) !== incomingFingerprint,
          ),
        ]).slice(0, CLIPBOARD_HISTORY_LIMIT),
      );
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) =>
      getSearchableText(item).includes(normalizedQuery),
    );
  }, [items, query]);

  const statusText = enabled
    ? tauriReady
      ? "系统监听中"
      : "粘贴监听中"
    : "已暂停";

  const toggleMonitoring = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(
        next ? "enable_clipboard_monitor" : "disable_clipboard_monitor",
      );
    } catch (error) {
      console.error("failed to toggle clipboard monitor", error);
    }
  };

  const clearItems = async () => {
    setItems([]);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_clipboard_history");
    } catch {
      /* browser */
    }
  };

  const removeItem = async (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("remove_clipboard_history_item", { id });
    } catch {
      /* browser */
    }
  };

  const flashCopied = (id: string) => {
    if (copiedTimerRef.current != null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    setCopyError(null);
    setCopiedItemId(id);
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopiedItemId(null);
    }, 1200);
  };

  const copyItem = async (item: ClipboardSnapshot) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const updatedItem = await invoke<ClipboardSnapshot>(
        "copy_clipboard_history_item",
        { id: item.id },
      );
      setItems((current) =>
        sortClipboardItems(
          current.map((currentItem) =>
            currentItem.id === updatedItem.id
              ? { ...updatedItem, imageDataUrl: currentItem.imageDataUrl }
              : currentItem,
          ),
        ),
      );
      flashCopied(item.id);
    } catch (error) {
      if (item.kind === "text" && item.text) {
        await navigator.clipboard.writeText(item.text);
        flashCopied(item.id);
        return;
      }
      setCopiedItemId(null);
      setCopyError(getErrorMessage(error));
    }
  };

  const togglePin = async (id: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const nextItems = await invoke<ClipboardSnapshot[]>(
        "toggle_clipboard_history_pin",
        { id },
      );
      setItems((current) => {
        const previews = new Map(
          current.map((item) => [item.id, item.imageDataUrl]),
        );
        return sortClipboardItems(
          nextItems.map((item) => ({
            ...item,
            imageDataUrl: previews.get(item.id) ?? item.imageDataUrl,
          })),
        );
      });
    } catch {
      setItems((current) =>
        sortClipboardItems(
          current.map((item) =>
            item.id === id ? { ...item, pinned: !item.pinned } : item,
          ),
        ),
      );
    }
  };

  return (
    <main className="clipboard-window" aria-label="剪贴板记录">
      <header className="clipboard-window__titlebar" data-tauri-drag-region>
        <div className="clipboard-window__brand" data-tauri-drag-region>
          <span className="clipboard-window__brand-icon" aria-hidden>
            <IconClipboardText size={18} />
          </span>
          <div data-tauri-drag-region>
            <h1 data-tauri-drag-region>剪贴板</h1>
            <p data-tauri-drag-region>
              {statusText} · {items.length} 条记录
              {historySize != null
                ? ` · 占用 ${formatHistorySize(historySize)}`
                : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="clipboard-window__close"
          onClick={() => void closeClipboardWindow()}
          aria-label="关闭剪贴板窗口"
          title="关闭"
        >
          <IconClose size={17} />
        </button>
      </header>

      <section className="clipboard-window__toolbar" aria-label="剪贴板工具">
        <label className="clipboard-window__search">
          <IconSearch size={16} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文字、代码、图片信息"
            aria-label="搜索剪贴板记录"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="清空搜索"
              title="清空搜索"
            >
              <IconClose size={14} />
            </button>
          )}
        </label>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void toggleMonitoring()}
          aria-pressed={enabled}
        >
          {enabled ? "暂停" : "恢复"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon-only"
          onClick={() => void clearItems()}
          disabled={items.length === 0}
          aria-label="清空剪贴板记录"
          title="清空记录"
        >
          <IconTrash size={16} />
        </button>
      </section>

      {copyError && (
        <p className="clipboard-window__error" role="alert">
          {copyError}
        </p>
      )}

      {filteredItems.length === 0 ? (
        <div className="clipboard-window__empty" role="status">
          {items.length === 0
            ? tauriReady
              ? "复制文字、代码或图片后会显示在这里"
              : "正在加载剪贴板记录…"
            : "没有匹配的剪贴板记录"}
        </div>
      ) : (
        <ol className="clipboard-window__list">
          {filteredItems.map((item) => (
            <li
              key={item.id}
              className={`clipboard-window__item ${
                copiedItemId === item.id ? "is-copied" : ""
              } ${item.pinned ? "is-pinned" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => void copyItem(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void copyItem(item);
                if (event.key === " ") event.preventDefault();
              }}
              onKeyUp={(event) => {
                if (event.key === " ") void copyItem(item);
              }}
              title="点击复制到系统剪贴板"
            >
              <div className="clipboard-window__item-head">
                <span className="clipboard-window__type">
                  {getClipboardIcon(item)}
                  {getClipboardLabel(item)}
                </span>
                <span className="clipboard-window__meta">
                  {copiedItemId === item.id ? "已复制 · " : ""}
                  {formatTime(item.capturedAt)}
                  {item.imageWidth && item.imageHeight
                    ? ` · ${item.imageWidth} x ${item.imageHeight}`
                    : ""}
                  {item.byteSize ? ` · ${formatByteSize(item.byteSize)}` : ""}
                  {item.copyCount > 0 ? ` · ${item.copyCount} 次` : ""}
                </span>
                <button
                  type="button"
                  className={`btn btn-ghost btn-icon-only clipboard-window__pin ${
                    item.pinned ? "is-active" : ""
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void togglePin(item.id);
                  }}
                  aria-label={item.pinned ? "取消置顶" : "置顶这条记录"}
                  title={item.pinned ? "取消置顶" : "置顶"}
                >
                  {item.pinned ? (
                    <IconDockBottom size={14} />
                  ) : (
                    <IconDockTop size={14} />
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon-only clipboard-window__remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    void removeItem(item.id);
                  }}
                  aria-label="移除这条剪贴板记录"
                  title="移除"
                >
                  <IconClose size={14} />
                </button>
              </div>
              {item.imageDataUrl ? (
                <img
                  src={item.imageDataUrl}
                  alt="剪贴板图片预览"
                  className="clipboard-window__image"
                  draggable={false}
                />
              ) : item.kind === "image" && !item.text ? (
                <div className="clipboard-window__image-placeholder">
                  <IconPhoto size={22} />
                  <span>图片预览加载中…</span>
                </div>
              ) : (
                <pre className="clipboard-window__text">
                  <code>{item.text}</code>
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
