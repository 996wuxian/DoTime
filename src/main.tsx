import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ReminderPopup } from "./components/ReminderPopup";
import { applyTheme, loadTheme } from "./utils/theme";

applyTheme(loadTheme());

const params = new URLSearchParams(window.location.search);
const isReminderWindow = params.get("view") === "reminder";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isReminderWindow ? <ReminderPopup /> : <App />}
  </React.StrictMode>,
);
