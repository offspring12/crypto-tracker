/**
 * Portfolios Hook
 *
 * Manages portfolio state including CRUD operations, active portfolio selection,
 * and localStorage persistence. This is the core state management for portfolios.
 *
 * Extracted from App.tsx for better code organization.
 */

import { useState, useEffect, useCallback } from 'react';
import { Portfolio, Asset, HistorySnapshot } from '../types';
import {
  PORTFOLIO_COLORS,
  migrateToPortfolios,
  migrateTransactionTags,
} from '../services/portfolioMigration';

export interface UsePortfoliosResult {
  /** All portfolios */
  portfolios: Portfolio[];
  /** Direct setter for portfolios (use sparingly, prefer updateActivePortfolio) */
  setPortfolios: React.Dispatch<React.SetStateAction<Portfolio[]>>;
  /** Currently active portfolio ID */
  activePortfolioId: string;
  /** Set the active portfolio ID */
  setActivePortfolioId: (id: string) => void;
  /** Currently active portfolio object */
  activePortfolio: Portfolio;
  /** Assets in the active portfolio */
  assets: Asset[];
  /** History snapshots for the active portfolio */
  history: HistorySnapshot[];
  /** Helper to update the active portfolio */
  updateActivePortfolio: (updater: (portfolio: Portfolio) => Portfolio) => void;
  /** Create a new portfolio */
  handleCreatePortfolio: (name: string) => void;
  /** Rename a portfolio */
  handleRenamePortfolio: (id: string, newName: string) => void;
  /** Delete a portfolio (with backup to localStorage) */
  handleDeletePortfolio: (id: string) => void;
}

/**
 * Hook for managing portfolio state
 *
 * Handles:
 * - Loading portfolios from localStorage (with migration)
 * - Persisting portfolios to localStorage
 * - Active portfolio selection
 * - Portfolio CRUD operations
 *
 * @returns Portfolio state and handlers
 *
 * @example
 * ```tsx
 * const {
 *   portfolios,
 *   activePortfolio,
 *   assets,
 *   updateActivePortfolio,
 *   handleCreatePortfolio,
 * } = usePortfolios();
 * ```
 */
export const usePortfolios = (): UsePortfoliosResult => {
  // Load portfolios from localStorage (with migration support)
  const [portfolios, setPortfolios] = useState<Portfolio[]>(() => {
    const saved = localStorage.getItem('portfolios');
    if (saved) {
      const parsed = JSON.parse(saved);
      return migrateTransactionTags(parsed); // Migrate old data
    }
    // Migration or first load
    return migrateToPortfolios();
  });

  // Load active portfolio ID from localStorage
  const [activePortfolioId, setActivePortfolioIdState] = useState<string>(() => {
    const saved = localStorage.getItem('active_portfolio_id');
    return saved || portfolios[0]?.id || '';
  });

  // Derive active portfolio and its data
  const activePortfolio = portfolios.find((p) => p.id === activePortfolioId) || portfolios[0];
  const assets = activePortfolio?.assets || [];
  const history = activePortfolio?.history || [];

  // Persist portfolios to localStorage
  useEffect(() => {
    localStorage.setItem('portfolios', JSON.stringify(portfolios));
  }, [portfolios]);

  // Persist active portfolio ID to localStorage
  useEffect(() => {
    localStorage.setItem('active_portfolio_id', activePortfolioId);
  }, [activePortfolioId]);

  // Wrapper for setActivePortfolioId to ensure type safety
  const setActivePortfolioId = useCallback((id: string) => {
    setActivePortfolioIdState(id);
  }, []);

  // Helper to update the active portfolio
  const updateActivePortfolio = useCallback(
    (updater: (portfolio: Portfolio) => Portfolio) => {
      setPortfolios((prev) =>
        prev.map((p) => (p.id === activePortfolioId ? updater(p) : p))
      );
    },
    [activePortfolioId]
  );

  // Create a new portfolio
  const handleCreatePortfolio = useCallback(
    (name: string) => {
      const newPortfolio: Portfolio = {
        id: Math.random().toString(36).substr(2, 9),
        name,
        color: PORTFOLIO_COLORS[portfolios.length % PORTFOLIO_COLORS.length],
        assets: [],
        closedPositions: [], // P2: Trading Lifecycle
        history: [],
        settings: {},
        createdAt: new Date().toISOString(),
      };
      setPortfolios([...portfolios, newPortfolio]);
      setActivePortfolioId(newPortfolio.id);
    },
    [portfolios, setActivePortfolioId]
  );

  // Rename a portfolio
  const handleRenamePortfolio = useCallback((id: string, newName: string) => {
    setPortfolios((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: newName } : p))
    );
  }, []);

  // Delete a portfolio (with backup)
  const handleDeletePortfolio = useCallback(
    (id: string) => {
      if (portfolios.length === 1) {
        alert('Cannot delete the last portfolio!');
        return;
      }

      const portfolio = portfolios.find((p) => p.id === id);
      if (portfolio && portfolio.assets.length > 0) {
        const confirmed = window.confirm(
          `"${portfolio.name}" contains ${portfolio.assets.length} asset(s). Are you sure you want to delete it? It will be saved in deleted portfolios (can be restored from export).`
        );
        if (!confirmed) return;
      }

      // Save to deleted portfolios before removing
      if (portfolio) {
        const deletedPortfolios = JSON.parse(
          localStorage.getItem('deleted_portfolios') || '[]'
        );
        deletedPortfolios.push({
          ...portfolio,
          deletedAt: new Date().toISOString(),
        });
        localStorage.setItem('deleted_portfolios', JSON.stringify(deletedPortfolios));
        console.log(`💾 Saved deleted portfolio "${portfolio.name}" to backup`);
      }

      setPortfolios((prev) => prev.filter((p) => p.id !== id));
      if (activePortfolioId === id) {
        setActivePortfolioId(portfolios.find((p) => p.id !== id)?.id || '');
      }
    },
    [portfolios, activePortfolioId, setActivePortfolioId]
  );

  return {
    portfolios,
    setPortfolios,
    activePortfolioId,
    setActivePortfolioId,
    activePortfolio,
    assets,
    history,
    updateActivePortfolio,
    handleCreatePortfolio,
    handleRenamePortfolio,
    handleDeletePortfolio,
  };
};
