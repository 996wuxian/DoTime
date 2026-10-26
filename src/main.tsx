import React from "react";
import ReactDOM from "react-dom/client";
import "./App.css";
import { applyTheme, loadTheme } from "./utils/theme";
import { initializeTypographySettings } from "./utils/typography";

function disableGlobalBrowserShortcuts() {
  const preventContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  const preventDevToolsShortcut = (event: KeyboardEvent) => {
    if (event.key !== "F12" && event.code !== "F12") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  document.addEventListener("contextmenu", preventContextMenu, true);
  window.addEventListener("keydown", preventDevToolsShortcut, true);
}

disableGlobalBrowserShortcuts();
applyTheme(loadTheme());
initializeTypographySettings();

const params = new URLSearchParams(window.location.search);
const isMainView = !params.get("view");
const isReminderWindow = params.get("view") === "reminder";
const isClipboardWindow = params.get("view") === "clipboard";
const isStickyNoteWindow = params.get("view") === "sticky-note";
const isMiniSubtasksWindow = params.get("view") === "mini-subtasks";
const isPinnedTodoWindow = params.get("view") === "pinned-todo";
const isPinnedSubtasksWindow = params.get("view") === "pinned-subtasks";

// Auxiliary notes only need their own data, never the main task/backup store.
if (!isStickyNoteWindow && !isClipboardWindow) {
  const { initializeFileBackedDataStore } = await import("./data/fileStorage");
  await initializeFileBackedDataStore();
}

async function loadWindowComponent() {
  if (isStickyNoteWindow) return (await import("./components/StickyNoteWindow")).StickyNoteWindow;
  if (isReminderWindow) return (await import("./components/ReminderPopup")).ReminderPopup;
  if (isMiniSubtasksWindow) return (await import("./components/MiniSubtasksWindow")).MiniSubtasksWindow;
  if (isClipboardWindow) return (await import("./components/ClipboardWindow")).ClipboardWindow;
  if (isPinnedTodoWindow) return (await import("./components/PinnedTodoWindow")).PinnedTodoWindow;
  if (isPinnedSubtasksWindow) return (await import("./components/PinnedSubtasksWindow")).PinnedSubtasksWindow;
  return (await import("./App")).default;
}

const WindowComponent = await loadWindowComponent();

if (isReminderWindow) {
  document.documentElement.classList.add("is-reminder-window");
  document.body.classList.add("is-reminder-window");
}

if (isStickyNoteWindow) {
  document.documentElement.classList.add("is-sticky-note-window");
  document.body.classList.add("is-sticky-note-window");
}

if (isMiniSubtasksWindow) {
  document.documentElement.classList.add("is-mini-subtasks-window");
  document.body.classList.add("is-mini-subtasks-window");
}

if (isPinnedTodoWindow) {
  document.documentElement.classList.add("is-pinned-todo-window");
  document.body.classList.add("is-pinned-todo-window");
}

if (isPinnedSubtasksWindow) {
  document.documentElement.classList.add("is-pinned-subtasks-window");
  document.body.classList.add("is-pinned-subtasks-window");
}

const appLoadingEl = document.getElementById("app-loading");
if (appLoadingEl != null) {
  if (isMainView) {
    window.setTimeout(() => {
      appLoadingEl.classList.add("is-leaving");
      window.setTimeout(() => appLoadingEl.remove(), 400);
    }, 900);
  } else {
    appLoadingEl.remove();
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WindowComponent />
  </React.StrictMode>,
);
