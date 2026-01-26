/**
 * Asset Notes Hook
 *
 * Provides handlers for managing notes on holdings (assets within portfolios).
 * Notes are portfolio-specific: the same asset can have different notes in different portfolios.
 *
 * Operations:
 * - Get note for an asset
 * - Save/update note for an asset
 * - Delete note for an asset
 */

import { useCallback } from 'react';
import { Portfolio, AssetNote } from '../types';

export interface UseAssetNotesProps {
  /** The active portfolio */
  activePortfolio: Portfolio | null;
  /** Helper to update the active portfolio */
  updateActivePortfolio: (updater: (portfolio: Portfolio) => Portfolio) => void;
}

export interface UseAssetNotesResult {
  /** Get note for an asset in the active portfolio */
  getNote: (assetSymbol: string) => AssetNote | undefined;
  /** Save or update a note for an asset */
  saveNote: (assetSymbol: string, noteText: string) => { success: boolean; error?: string };
  /** Delete a note for an asset */
  deleteNote: (assetSymbol: string) => void;
  /** Check if an asset has a note */
  hasNote: (assetSymbol: string) => boolean;
}

/**
 * Hook for managing asset notes within portfolios
 *
 * @param props - Dependencies from portfolio state
 * @returns Note operation handlers
 */
export const useAssetNotes = ({
  activePortfolio,
  updateActivePortfolio,
}: UseAssetNotesProps): UseAssetNotesResult => {

  // Get note for an asset in the active portfolio
  const getNote = useCallback(
    (assetSymbol: string): AssetNote | undefined => {
      if (!activePortfolio) return undefined;

      const notes = activePortfolio.assetNotes || [];
      return notes.find(
        (note) => note.assetSymbol.toUpperCase() === assetSymbol.toUpperCase()
      );
    },
    [activePortfolio]
  );

  // Check if an asset has a note
  const hasNote = useCallback(
    (assetSymbol: string): boolean => {
      return getNote(assetSymbol) !== undefined;
    },
    [getNote]
  );

  // Save or update a note for an asset
  const saveNote = useCallback(
    (assetSymbol: string, noteText: string): { success: boolean; error?: string } => {
      // Validation: check for empty note
      const trimmedNote = noteText.trim();
      if (!trimmedNote) {
        return { success: false, error: 'Note cannot be empty' };
      }

      if (!activePortfolio) {
        return { success: false, error: 'No active portfolio' };
      }

      const now = new Date().toISOString();
      const existingNote = getNote(assetSymbol);

      updateActivePortfolio((portfolio) => {
        const currentNotes = portfolio.assetNotes || [];

        if (existingNote) {
          // Update existing note
          const updatedNotes = currentNotes.map((note) =>
            note.assetSymbol.toUpperCase() === assetSymbol.toUpperCase()
              ? {
                  ...note,
                  note: trimmedNote,
                  lastEditedAt: now,
                }
              : note
          );

          return {
            ...portfolio,
            assetNotes: updatedNotes,
          };
        } else {
          // Create new note
          const newNote: AssetNote = {
            portfolioId: portfolio.id,
            assetSymbol: assetSymbol.toUpperCase(),
            note: trimmedNote,
            createdAt: now,
            lastEditedAt: now,
          };

          return {
            ...portfolio,
            assetNotes: [...currentNotes, newNote],
          };
        }
      });

      return { success: true };
    },
    [activePortfolio, getNote, updateActivePortfolio]
  );

  // Delete a note for an asset
  const deleteNote = useCallback(
    (assetSymbol: string): void => {
      if (!activePortfolio) return;

      updateActivePortfolio((portfolio) => {
        const currentNotes = portfolio.assetNotes || [];
        const filteredNotes = currentNotes.filter(
          (note) => note.assetSymbol.toUpperCase() !== assetSymbol.toUpperCase()
        );

        return {
          ...portfolio,
          assetNotes: filteredNotes,
        };
      });
    },
    [activePortfolio, updateActivePortfolio]
  );

  return {
    getNote,
    saveNote,
    deleteNote,
    hasNote,
  };
};
