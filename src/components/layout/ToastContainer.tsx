import { useEffect } from "react";
import { useAppStore } from "../../state/useAppStore";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);

  return (
    <div
      style={{
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: { id: string; message: string; type: "success" | "error" | "info" };
  onRemove: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onRemove, 4000);
    return () => clearTimeout(timer);
  }, [onRemove]);

  const icon =
    toast.type === "success" ? (
      <CheckCircle size={16} color="var(--success)" />
    ) : toast.type === "error" ? (
      <AlertCircle size={16} color="var(--danger)" />
    ) : (
      <Info size={16} color="var(--accent)" />
    );

  const borderColor =
    toast.type === "success"
      ? "rgba(74, 222, 128, 0.3)"
      : toast.type === "error"
        ? "rgba(248, 113, 113, 0.3)"
        : "rgba(96, 165, 250, 0.3)";

  return (
    <div
      style={{
        pointerEvents: "auto",
        background: "var(--surface)",
        border: `1px solid ${borderColor}`,
        borderRadius: "10px",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        minWidth: "260px",
        maxWidth: "380px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        animation: "toastSlideIn 0.25s ease",
      }}
    >
      {icon}
      <span
        style={{
          flex: 1,
          fontSize: "0.85rem",
          color: "var(--text)",
          lineHeight: 1.4,
        }}
      >
        {toast.message}
      </span>
      <button
        onClick={onRemove}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          padding: "2px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "4px",
        }}
      >
        <X size={14} />
      </button>
      <style>{`
        @keyframes toastSlideIn {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
