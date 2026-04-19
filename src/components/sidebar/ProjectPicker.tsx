import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Folder,
  ArrowLeft,
  ChevronRight,
  Search,
  Command,
  CornerDownLeft,
  Delete,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { readDir, openPath } from "../../lib/tauri";
import { createPortal } from "react-dom";

interface ProjectPickerProps {
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function ProjectPicker({ onClose, onSelect }: ProjectPickerProps) {
  const [currentPath, setCurrentPath] = useState("~/");
  const [directories, setDirectories] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadDirectories = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const dirs = await readDir(path);
      setDirectories(dirs);
      setSelectedIndex(0);
    } catch (error) {
      console.error("Failed to load directories", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectories(currentPath);
  }, [currentPath, loadDirectories]);

  const handleNavigateIn = (dir: string) => {
    const newPath =
      currentPath === "/"
        ? `/${dir}`
        : currentPath.endsWith("/")
          ? `${currentPath}${dir}`
          : `${currentPath}/${dir}`;
    setCurrentPath(newPath);
  };

  const handleNavigateBack = () => {
    const isUserHome = currentPath === "~/" || currentPath === "~";
    const isRoot = currentPath === "/";

    if (isUserHome) {
      setCurrentPath("/");
      return;
    }

    if (isRoot) return;

    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length === 0) return;
    parts.pop();

    const newPath = currentPath.startsWith("~/")
      ? `~/${parts.slice(1).join("/")}`
      : parts.length === 0
        ? "/"
        : `/${parts.join("/")}`;

    setCurrentPath(
      newPath.endsWith("/") || newPath === "/" ? newPath : `${newPath}/`,
    );
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Backspace" && !(e.target instanceof HTMLInputElement))
        handleNavigateBack();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, directories.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
      if (e.key === "Enter") {
        if (e.metaKey || e.ctrlKey) {
          onSelect(currentPath);
        } else if (directories[selectedIndex]) {
          handleNavigateIn(directories[selectedIndex]);
        }
      }
      if (e.key === "o" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void openPath(currentPath);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onClose,
    handleNavigateBack,
    directories,
    selectedIndex,
    currentPath,
    onSelect,
  ]);

  useEffect(() => {
    if (scrollRef.current) {
      const selectedElement = scrollRef.current.children[
        selectedIndex + 1
      ] as HTMLElement; // +1 because of "DIRECTORIES" label
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(4px)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "default",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "520px",
          background: "#161616",
          borderRadius: "16px",
          border: "1px solid #333",
          boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "70vh",
          minHeight: "400px",
          overflow: "hidden",
          animation: "pickerFadeIn 0.2s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #222",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flex: 1,
            }}
          >
            <button
              onClick={handleNavigateBack}
              style={{
                background: "transparent",
                border: "none",
                color: "#888",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <ArrowLeft size={16} />
            </button>
            <div
              style={{
                fontSize: "1rem",
                fontWeight: 500,
                color: "#fafafa",
                letterSpacing: "-0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {currentPath}
            </div>
          </div>

          <button
            onClick={() => onSelect(currentPath)}
            style={{
              background: "#2563eb",
              color: "white",
              border: "none",
              padding: "6px 14px",
              borderRadius: "8px",
              fontSize: "0.85rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Add{" "}
            <div
              style={{
                opacity: 0.6,
                fontSize: "0.7rem",
                display: "flex",
                alignItems: "center",
                gap: "2px",
              }}
            >
              <Command size={10} /> Enter
            </div>
          </button>
        </div>

        {/* List Content */}
        <div
          style={{
            padding: "4px",
            overflowY: "auto",
            flex: 1,
            scrollbarWidth: "thin",
            scrollbarColor: "#333 transparent",
          }}
          ref={scrollRef}
        >
          <div
            style={{
              padding: "8px 14px",
              fontSize: "0.7rem",
              fontWeight: 600,
              color: "#444",
              letterSpacing: "0.05em",
            }}
          >
            DIRECTORIES
          </div>

          {loading ? (
            <div
              style={{
                padding: "40px",
                textAlign: "center",
                color: "#444",
                fontSize: "0.9rem",
              }}
            >
              Loading...
            </div>
          ) : directories.length === 0 ? (
            <div
              style={{
                padding: "40px",
                textAlign: "center",
                color: "#444",
                fontSize: "0.9rem",
              }}
            >
              No directories found
            </div>
          ) : (
            directories.map((dir, index) => (
              <div
                key={dir}
                onClick={() => handleNavigateIn(dir)}
                onMouseEnter={() => setSelectedIndex(index)}
                className="picker-item"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  background:
                    index === selectedIndex
                      ? "rgba(255,255,255,0.05)"
                      : "transparent",
                  color: index === selectedIndex ? "#fff" : "#888",
                  transition: "background 0.1s",
                }}
              >
                <Folder
                  size={18}
                  stroke={index === selectedIndex ? "#2563eb" : "#666"}
                  fill={index === selectedIndex ? "#2563eb" : "transparent"}
                  style={{ opacity: index === selectedIndex ? 1 : 0.6 }}
                />
                <span style={{ fontSize: "0.95rem" }}>{dir}</span>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            background: "#161616",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "12px",
              color: "#666",
              fontSize: "0.8rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div
                style={{
                  background: "#222",
                  border: "1px solid #333",
                  padding: "4px",
                  borderRadius: "4px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  lineHeight: 1,
                }}
              >
                <ArrowUp size={8} />
                <ArrowDown size={8} />
              </div>
              <span>Navigate</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div
                style={{
                  background: "#222",
                  border: "1px solid #333",
                  padding: "2px 6px",
                  borderRadius: "4px",
                }}
              >
                Enter
              </div>
              <span>Select</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div
                style={{
                  background: "#222",
                  border: "1px solid #333",
                  padding: "2px 6px",
                  borderRadius: "4px",
                }}
              >
                Backspace
              </div>
              <span>Back</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div
                style={{
                  background: "#222",
                  border: "1px solid #333",
                  padding: "2px 6px",
                  borderRadius: "4px",
                }}
              >
                Esc
              </div>
              <span>Close</span>
            </div>
          </div>

          <div
            onClick={() => void openPath(currentPath)}
            className="finder-button"
            style={{
              color: "#888",
              fontSize: "0.8rem",
              background: "transparent",
              padding: "4px 8px",
              borderRadius: "6px",
              fontWeight: 500,
              whiteSpace: "nowrap",
              transition: "background 0.1s, color 0.1s",
              display: "flex",
              alignItems: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.background = "#222";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#888";
              e.currentTarget.style.background = "transparent";
            }}
          >
            Open in Finder
          </div>
        </div>

        <style>{`
          @keyframes pickerFadeIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
          }
          .picker-item:hover, .finder-button:hover, button:hover {
            cursor: pointer;
          }
        `}</style>
      </div>
    </div>,
    document.body,
  );
}
