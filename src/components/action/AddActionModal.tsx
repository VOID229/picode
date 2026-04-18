import { Play, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useAppStore } from "../../state/useAppStore";
import type { CustomAction } from "../../state/useAppStore";

interface AddActionModalProps {
  workspaceId: string;
  editingActionId?: string;
  onClose: () => void;
}

export function AddActionModal({ workspaceId, editingActionId, onClose }: AddActionModalProps) {
  const customActions = useAppStore((store) => store.customActions);
  const addCustomAction = useAppStore((store) => store.addCustomAction);
  const updateCustomAction = useAppStore((store) => store.updateCustomAction);
  const removeCustomAction = useAppStore((store) => store.removeCustomAction);

  const existingAction = editingActionId 
    ? customActions[workspaceId]?.find(a => a.id === editingActionId) 
    : undefined;

  const [name, setName] = useState(existingAction?.name || "");
  const [command, setCommand] = useState(existingAction?.command || "");
  const [keybinding, setKeybinding] = useState(existingAction?.keybinding || "");

  const handleSave = () => {
    if (!name.trim() || !command.trim()) return;
    
    if (editingActionId) {
      updateCustomAction(workspaceId, editingActionId, {
        name,
        command,
        keybinding: keybinding || undefined,
        icon: "Play"
      });
    } else {
      addCustomAction(workspaceId, {
        name,
        command,
        keybinding: keybinding || undefined,
        icon: "Play"
      });
    }
    onClose();
  };

  const handleDelete = () => {
    if (editingActionId) {
      removeCustomAction(workspaceId, editingActionId);
    }
    onClose();
  };

  const isEditing = !!editingActionId;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        backgroundColor: '#1C1C1E', // Dark grey background
        borderRadius: '12px',
        width: '460px',
        border: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '24px 24px 16px' }}>
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.25rem', fontWeight: 600, color: '#fff' }}>{isEditing ? "Edit Action" : "Add Action"}</h2>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#888', lineHeight: 1.4 }}>
              Actions are project-scoped commands you can run from the top bar or keybindings.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.9rem', fontWeight: 500, color: '#ccc' }}>Name</label>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ 
                width: '40px', height: '40px', 
                borderRadius: '8px', 
                background: '#2A2A2C', 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid #333'
              }}>
                <Play size={18} color="#888" strokeWidth={1.5} />
              </div>
              <input 
                type="text" 
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ 
                  flex: 1, 
                  background: '#2A2A2C', 
                  border: '1px solid #2563eb', // Active focus color from screenshot
                  borderRadius: '8px', 
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: '0.95rem',
                  outline: 'none',
                  boxShadow: '0 0 0 1px #2563eb'
                }} 
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.9rem', fontWeight: 500, color: '#ccc' }}>Keybinding</label>
            <input 
              type="text" 
              placeholder="Press shortcut"
              value={keybinding}
              onChange={(e) => setKeybinding(e.target.value)}
              style={{ 
                background: '#111', 
                border: '1px solid #333', 
                borderRadius: '8px', 
                padding: '10px 12px',
                color: '#fff',
                fontSize: '0.95rem',
                outline: 'none'
              }} 
            />
            <span style={{ fontSize: '0.8rem', color: '#666' }}>Press a shortcut. Use Backspace to clear.</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.9rem', fontWeight: 500, color: '#ccc' }}>Command</label>
            <textarea 
              value={command}
              placeholder="e.g. bun test"
              onChange={(e) => setCommand(e.target.value)}
              style={{ 
                background: '#111', 
                border: '1px solid #333', 
                borderRadius: '8px', 
                padding: '12px',
                color: '#fff',
                fontSize: '0.95rem',
                outline: 'none',
                minHeight: '80px',
                resize: 'none',
                fontFamily: 'SF Mono, monospace'
              }} 
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 20px' }}>
            <span style={{ fontSize: '0.9rem', color: '#ccc' }}>Run automatically on worktree creation</span>
            <div style={{ 
              width: '36px', height: '20px', 
              background: '#333', 
              borderRadius: '20px', 
              position: 'relative' 
            }}>
              <div style={{ 
                width: '16px', height: '16px', 
                background: '#888', 
                borderRadius: '50%', 
                position: 'absolute', 
                top: '2px', left: '2px' 
              }} />
            </div>
          </div>
        </div>

        <div style={{ 
          padding: '16px 24px', 
          borderTop: '1px solid #333', 
          display: 'flex', 
          justifyContent: isEditing ? 'space-between' : 'flex-end', 
          background: 'rgba(255,255,255,0.02)',
          borderBottomLeftRadius: '12px',
          borderBottomRightRadius: '12px'
        }}>
          {isEditing && (
            <button onClick={handleDelete} style={{ 
              background: 'transparent', 
              border: '1px solid currentColor', 
              color: '#ef4444', 
              padding: '8px 16px', 
              borderRadius: '20px',
              fontSize: '0.9rem',
              fontWeight: 500,
              cursor: 'pointer'
            }}>
              Delete
            </button>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={onClose} style={{ 
              background: 'transparent', 
              border: '1px solid #444', 
              color: '#ccc', 
              padding: '8px 16px', 
              borderRadius: '20px',
              fontSize: '0.9rem',
              fontWeight: 500,
              cursor: 'pointer'
            }}>
              Cancel
            </button>
            <button onClick={handleSave} style={{ 
              background: '#3b82f6', 
              border: 'none', 
              color: '#fff', 
              padding: '8px 16px', 
              borderRadius: '20px',
              fontSize: '0.9rem',
              fontWeight: 500,
              cursor: 'pointer'
            }}>
              {isEditing ? "Save changes" : "Save action"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
