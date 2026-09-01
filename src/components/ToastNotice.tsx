import { createPortal } from "react-dom";

interface ToastNoticeProps {
  kind: "info" | "success" | "error";
  message: string;
}

export function ToastNotice({ kind, message }: ToastNoticeProps) {
  return createPortal(
    <div
      className={`global-toast ${kind === "error" ? "is-error" : ""} ${
        kind === "success" ? "is-success" : ""
      }`}
      role={kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {message}
    </div>,
    document.body,
  );
}
