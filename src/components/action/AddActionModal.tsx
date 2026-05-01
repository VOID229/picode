import {
  Play,
  X,
  FlaskConical,
  ListChecks,
  Wrench,
  Hammer,
  Bug,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useAppStore } from "../../state/useAppStore";

interface AddActionModalProps {
  editingActionId?: string;
  onClose: () => void;
}

export function AddActionModal({
  editingActionId,
  onClose,
}: AddActionModalProps) {
  const customActions = useAppStore((store) => store.customActions);
  const addCustomAction = useAppStore((store) => store.addCustomAction);
  const updateCustomAction = useAppStore((store) => store.updateCustomAction);
  const removeCustomAction = useAppStore((store) => store.removeCustomAction);

  const existingAction = editingActionId
    ? customActions.find((a) => a.id === editingActionId)
    : undefined;

  const [name, setName] = useState(existingAction?.name || "");
  const [command, setCommand] = useState(existingAction?.command || "");
  const [keybinding, setKeybinding] = useState(
    existingAction?.keybinding || "",
  );
  const [selectedIcon, setSelectedIcon] = useState<string>(
    existingAction?.icon || "Play",
  );
  const [showIconPicker, setShowIconPicker] = useState(false);

  const iconsMap: Record<string, React.ReactNode> = {
    Play: <Play size={18} strokeWidth={1.5} />,
    Test: <FlaskConical size={18} strokeWidth={1.5} />,
    Lint: <ListChecks size={18} strokeWidth={1.5} />,
    Configure: <Wrench size={18} strokeWidth={1.5} />,
    Build: <Hammer size={18} strokeWidth={1.5} />,
    Debug: <Bug size={18} strokeWidth={1.5} />,
  };

  const handleSave = () => {
    if (!name.trim() || !command.trim()) return;

    if (editingActionId) {
      updateCustomAction(editingActionId, {
        name,
        command,
        keybinding: keybinding || undefined,
        icon: selectedIcon,
      });
    } else {
      addCustomAction({
        name,
        command,
        keybinding: keybinding || undefined,
        icon: selectedIcon,
      });
    }
    onClose();
  };

  const handleDelete = () => {
    if (editingActionId) {
      removeCustomAction(editingActionId);
    }
    onClose();
  };

  const isEditing = !!editingActionId;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          backgroundColor: "#1C1C1E", // Dark grey background
          borderRadius: "12px",
          width: "460px",
          border: "1px solid #333",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            padding: "24px 24px 16px",
          }}
        >
          <div>
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: "1.25rem",
                fontWeight: 600,
                color: "#fff",
              }}
            >
              {isEditing ? "Edit Action" : "Add Action"}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "0.9rem",
                color: "#888",
                lineHeight: 1.4,
              }}
            >
              Actions are global commands you can run from the top bar or
              keybindings across all projects.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#888",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            padding: "0 24px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label
              style={{ fontSize: "0.9rem", fontWeight: 500, color: "#ccc" }}
            >
              Name
            </label>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div style={{ position: "relative" }}>
                <div
                  onClick={() => setShowIconPicker(!showIconPicker)}
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "8px",
                    background: "#2A2A2C",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: showIconPicker
                      ? "1px solid #2563eb"
                      : "1px solid #333",
                    cursor: "pointer",
                    color: showIconPicker ? "#fff" : "#888",
                    transition: "border-color 0.15s, color 0.15s",
                  }}
                >
                  {iconsMap[selectedIcon] || iconsMap["Play"]}
                </div>

                {showIconPicker && (
                  <>
                    <div
                      style={{ position: "fixed", inset: 0, zIndex: 10 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowIconPicker(false);
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        marginTop: "8px",
                        background: "#1C1C1E",
                        border: "1px solid #333",
                        borderRadius: "12px",
                        padding: "12px",
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: "8px",
                        zIndex: 20,
                        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                        width: "260px",
                      }}
                    >
                      {Object.entries(iconsMap).map(([key, iconNode]) => (
                        <button
                          key={key}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedIcon(key);
                            setShowIconPicker(false);
                          }}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "8px",
                            background:
                              selectedIcon === key
                                ? "rgba(59, 130, 246, 0.15)"
                                : "transparent",
                            border:
                              selectedIcon === key
                                ? "1px solid #3b82f6"
                                : "1px solid transparent",
                            color: selectedIcon === key ? "#fff" : "#ccc",
                            padding: "12px 8px",
                            borderRadius: "8px",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            if (selectedIcon !== key) {
                              e.currentTarget.style.background = "#2A2A2C";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (selectedIcon !== key) {
                              e.currentTarget.style.background = "transparent";
                            }
                          }}
                        >
                          <div style={{ pointerEvents: "none" }}>
                            {iconNode}
                          </div>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 500,
                              pointerEvents: "none",
                            }}
                          >
                            {key}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <input
                type="text"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  flex: 1,
                  background: "#2A2A2C",
                  border: "1px solid #2563eb", // Active focus color from screenshot
                  borderRadius: "8px",
                  padding: "10px 12px",
                  color: "#fff",
                  fontSize: "0.95rem",
                  outline: "none",
                  boxShadow: "0 0 0 1px #2563eb",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label
              style={{ fontSize: "0.9rem", fontWeight: 500, color: "#ccc" }}
            >
              Keybinding
            </label>
            <input
              type="text"
              placeholder="Press shortcut"
              value={keybinding}
              onChange={(e) => setKeybinding(e.target.value)}
              style={{
                background: "#111",
                border: "1px solid #333",
                borderRadius: "8px",
                padding: "10px 12px",
                color: "#fff",
                fontSize: "0.95rem",
                outline: "none",
              }}
            />
            <span style={{ fontSize: "0.8rem", color: "#666" }}>
              Press a shortcut. Use Backspace to clear.
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label
              style={{ fontSize: "0.9rem", fontWeight: 500, color: "#ccc" }}
            >
              Command
            </label>
            <textarea
              value={command}
              placeholder="e.g. bun test"
              onChange={(e) => setCommand(e.target.value)}
              style={{
                background: "#111",
                border: "1px solid #333",
                borderRadius: "8px",
                padding: "12px",
                color: "#fff",
                fontSize: "0.95rem",
                outline: "none",
                minHeight: "80px",
                resize: "none",
                fontFamily: "SF Mono, monospace",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 0 20px",
            }}
          >
            <span style={{ fontSize: "0.9rem", color: "#ccc" }}>
              Run automatically on worktree creation
            </span>
            <div
              style={{
                width: "36px",
                height: "20px",
                background: "#333",
                borderRadius: "20px",
                position: "relative",
              }}
            >
              <div
                style={{
                  width: "16px",
                  height: "16px",
                  background: "#888",
                  borderRadius: "50%",
                  position: "absolute",
                  top: "2px",
                  left: "2px",
                }}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #333",
            display: "flex",
            justifyContent: isEditing ? "space-between" : "flex-end",
            background: "rgba(255,255,255,0.02)",
            borderBottomLeftRadius: "12px",
            borderBottomRightRadius: "12px",
          }}
        >
          {isEditing && (
            <button
              onClick={handleDelete}
              className="action-modal-btn delete-btn"
            >
              Delete
            </button>
          )}

          <div style={{ display: "flex", gap: "12px" }}>
            <button onClick={onClose} className="action-modal-btn cancel-btn">
              Cancel
            </button>
            <button onClick={handleSave} className="action-modal-btn save-btn">
              {isEditing ? "Save changes" : "Save action"}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .action-modal-btn {
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .action-modal-btn.delete-btn {
          background: transparent;
          border: 1px solid transparent;
          color: #ef4444; /* red text by default */
        }
        .action-modal-btn.delete-btn:hover {
          border-color: #ef4444; /* red border on hover */
        }
        
        .action-modal-btn.cancel-btn {
          background: transparent;
          border: 1px solid #444;
          color: #ccc;
        }
        .action-modal-btn.cancel-btn:hover {
          border-color: #666;
          color: #fff;
          background: rgba(255,255,255,0.05);
        }
        
        .action-modal-btn.save-btn {
          background: #3b82f6;
          border: 1px solid #3b82f6;
          color: #fff;
        }
        .action-modal-btn.save-btn:hover {
          background: #60a5fa; /* lighter blue */
          border-color: #60a5fa;
        }
      `}</style>
    </div>
  );
}
