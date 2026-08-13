import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ClipboardWindow } from "./components/ClipboardWindow";
import { MiniSubtasksWindow } from "./components/MiniSubtasksWindow";
import { PinnedTodoWindow } from "./components/PinnedTodoWindow";
import { PinnedSubtasksWindow } from "./components/PinnedSubtasksWindow";
import { ReminderPopup } from "./components/ReminderPopup";
import { applyTheme, loadTheme } from "./utils/theme";

applyTheme(loadTheme());

const params = new URLSearchParams(window.location.search);
const isMainView = !params.get("view");
const isReminderWindow = params.get("view") === "reminder";
const isClipboardWindow = params.get("view") === "clipboard";
const isMiniSubtasksWindow = params.get("view") === "mini-subtasks";
const isPinnedTodoWindow = params.get("view") === "pinned-todo";
const isPinnedSubtasksWindow = params.get("view") === "pinned-subtasks";

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
    {isReminderWindow ? (
      <ReminderPopup />
    ) : isMiniSubtasksWindow ? (
      <MiniSubtasksWindow />
    ) : isClipboardWindow ? (
      <ClipboardWindow />
    ) : isPinnedTodoWindow ? (
      <PinnedTodoWindow />
    ) : isPinnedSubtasksWindow ? (
      <PinnedSubtasksWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
