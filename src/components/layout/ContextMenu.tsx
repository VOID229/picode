import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "danger";
  separator?: boolean;
  isHeader?: boolean;
  isChecked?: boolean;
  keepOpen?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

import { Check } from "lucide-react";

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to keep menu within viewport
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - 300);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: adjustedY,
        left: adjustedX,
        zIndex: 1000,
        background: "var(--surface)",
        border: "1px solid #333",
        borderRadius: "12px",
        padding: "6px",
        minWidth: "200px",
        boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        animation: "contextMenuItemFadeIn 0.1s ease-out",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {item.isHeader ? (
            <div
              style={{
                fontSize: "0.7rem",
                fontWeight: 600,
                color: "var(--text-dim)",
                padding: "8px 12px 4px 12px",
                textTransform: "capitalize",
                letterSpacing: "0.02em",
              }}
            >
              {item.label}
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                item.onClick?.();
                if (!item.keepOpen) {
                  onClose();
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "none",
                background: "transparent",
                color:
                  item.variant === "danger" ? "#ff453a" : "var(--text-muted)",
                fontSize: "0.9rem",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.1s, color 0.1s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  item.variant === "danger"
                    ? "rgba(255, 69, 58, 0.15)"
                    : "var(--accent)";
                if (item.variant !== "danger")
                  e.currentTarget.style.color = "white";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color =
                  item.variant === "danger" ? "#ff453a" : "var(--text-muted)";
              }}
            >
              <div
                style={{
                  width: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {item.isChecked && <Check size={14} />}
              </div>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.icon && <span style={{ opacity: 0.8 }}>{item.icon}</span>}
            </button>
          )}
          {item.separator && (
            <div
              style={{
                height: "1px",
                background: "var(--line)",
                margin: "4px 0",
              }}
            />
          )}
        </React.Fragment>
      ))}

      <style>{`
        @keyframes contextMenuItemFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
