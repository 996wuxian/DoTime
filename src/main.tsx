import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ClipboardWindow } from "./components/ClipboardWindow";
import { MiniSubtasksWindow } from "./components/MiniSubtasksWindow";
import { ReminderPopup } from "./components/ReminderPopup";
import { applyTheme, loadTheme } from "./utils/theme";

applyTheme(loadTheme());

const params = new URLSearchParams(window.location.search);
const isReminderWindow = params.get("view") === "reminder";
const isClipboardWindow = params.get("view") === "clipboard";
const isMiniSubtasksWindow = params.get("view") === "mini-subtasks";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isReminderWindow ? (
      <ReminderPopup />
    ) : isMiniSubtasksWindow ? (
      <MiniSubtasksWindow />
    ) : isClipboardWindow ? (
      <ClipboardWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
