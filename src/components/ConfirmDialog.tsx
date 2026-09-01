import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  confirmIcon?: ReactNode;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  description,
  icon,
  confirmLabel,
  confirmVariant = "primary",
  confirmIcon,
  cancelLabel = "取消",
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const dialog = (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className={`confirm-dialog is-${confirmVariant}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="confirm-dialog__icon" aria-hidden>
          {icon}
        </div>
        <div className="confirm-dialog__content">
          <div className="confirm-dialog__header">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only confirm-dialog__close"
              onClick={onCancel}
              aria-label={cancelLabel}
              title={cancelLabel}
            >
              <IconClose size={16} />
            </button>
          </div>
          <p id={descriptionId}>{description}</p>
          <div className="confirm-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmButtonRef}
              type="button"
              className={`btn btn-${confirmVariant} btn-sm`}
              onClick={onConfirm}
              disabled={confirmDisabled}
            >
              {confirmIcon}
              {confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );

  return createPortal(dialog, document.body);
}
