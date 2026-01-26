/**
 * NoteModal Component
 *
 * Modal for viewing, editing, and deleting notes attached to holdings.
 * Features:
 * - Large textarea for note content
 * - Character count display
 * - Created/edited timestamps
 * - Save, Cancel, Delete actions
 * - Validation for empty notes
 */

import React, { useState, useEffect, useRef } from 'react';
import { X, FileText, Trash2, AlertCircle } from 'lucide-react';
import { AssetNote } from '../types';

interface NoteModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Asset ticker (e.g., 'BTC') */
  assetSymbol: string;
  /** Asset name (e.g., 'Bitcoin') */
  assetName: string;
  /** Portfolio name for display */
  portfolioName: string;
  /** Existing note if editing, undefined if creating */
  existingNote?: AssetNote;
  /** Called when user saves the note */
  onSave: (noteText: string) => { success: boolean; error?: string };
  /** Called when user deletes the note */
  onDelete: () => void;
  /** Called when modal should close */
  onClose: () => void;
}

export const NoteModal: React.FC<NoteModalProps> = ({
  isOpen,
  assetSymbol,
  assetName,
  portfolioName,
  existingNote,
  onSave,
  onDelete,
  onClose,
}) => {
  const [noteText, setNoteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize note text when modal opens
  useEffect(() => {
    if (isOpen) {
      setNoteText(existingNote?.note || '');
      setError(null);
      setShowDeleteConfirm(false);
      // Auto-focus textarea after a short delay
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen, existingNote]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      // ESC to close
      if (e.key === 'Escape') {
        onClose();
      }
      // Ctrl/Cmd + Enter to save
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, noteText]);

  if (!isOpen) return null;

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Handle save
  const handleSave = () => {
    const result = onSave(noteText);
    if (result.success) {
      onClose();
    } else {
      setError(result.error || 'Failed to save note');
    }
  };

  // Handle delete confirmation
  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDelete();
    onClose();
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  // Format date for display
  const formatDate = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Check if note was edited (different from created)
  const wasEdited =
    existingNote &&
    existingNote.lastEditedAt !== existingNote.createdAt;

  // Character count warning threshold
  const charWarningThreshold = 5000;
  const charCount = noteText.length;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-slate-800 rounded-xl max-w-2xl w-full shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20">
              <FileText size={22} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Note for {assetName} ({assetSymbol})
              </h2>
              <p className="text-sm text-slate-400">in {portfolioName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400"
            title="Close (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-5 overflow-y-auto">
          {/* Delete confirmation banner */}
          {showDeleteConfirm && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-red-200 font-medium mb-3">
                    Are you sure you want to delete this note?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleConfirmDelete}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors text-sm"
                    >
                      Yes, Delete
                    </button>
                    <button
                      onClick={handleCancelDelete}
                      className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle size={16} className="text-red-400" />
              <span className="text-sm text-red-200">{error}</span>
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={noteText}
            onChange={(e) => {
              setNoteText(e.target.value);
              setError(null);
            }}
            placeholder="Add notes about your investment thesis, strategy, reminders..."
            className="w-full h-64 bg-slate-900 border border-slate-600 rounded-lg p-4 text-white text-sm resize-none outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
          />

          {/* Character count */}
          <div className="flex items-center justify-between mt-2">
            <span
              className={`text-xs ${
                charCount > charWarningThreshold
                  ? 'text-amber-400'
                  : 'text-slate-500'
              }`}
            >
              {charCount.toLocaleString()} characters
              {charCount > charWarningThreshold && ' (consider keeping notes concise)'}
            </span>
            <span className="text-xs text-slate-500">
              Ctrl+Enter to save
            </span>
          </div>

          {/* Timestamps */}
          {existingNote && (
            <div className="mt-4 pt-4 border-t border-slate-700">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>Created: {formatDate(existingNote.createdAt)}</span>
                {wasEdited && (
                  <span>Last edited: {formatDate(existingNote.lastEditedAt)}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 bg-slate-900/50">
          <div className="flex items-center justify-between">
            {/* Delete button (only if existing note) */}
            <div>
              {existingNote && !showDeleteConfirm && (
                <button
                  onClick={handleDeleteClick}
                  className="flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors text-sm"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              )}
            </div>

            {/* Cancel and Save buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
