/**
 * Portfolio Migration Service
 *
 * Handles migration of portfolio data from legacy localStorage formats
 * to the current portfolio structure. These functions run on app initialization.
 *
 * Extracted from App.tsx for better code organization.
 */

import { Portfolio, Asset, HistorySnapshot } from '../types';

// Portfolio colors for visual distinction
export const PORTFOLIO_COLORS = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#f43f5e', // Rose
  '#14b8a6', // Teal
];

/**
 * Migration: Convert old structure to new portfolio structure
 *
 * Checks for legacy localStorage keys ('portfolio_assets', 'portfolio_history')
 * and migrates them to the new 'portfolios' structure.
 *
 * @returns Array of portfolios (either migrated or new default)
 */
export const migrateToPortfolios = (): Portfolio[] => {
  const oldAssets = localStorage.getItem('portfolio_assets');
  const oldHistory = localStorage.getItem('portfolio_history');

  if (!oldAssets && !oldHistory) {
    // No old data, return default empty portfolio
    return [{
      id: Math.random().toString(36).substr(2, 9),
      name: 'Main Portfolio',
      color: PORTFOLIO_COLORS[0],
      assets: [],
      closedPositions: [], // P2: Trading Lifecycle
      history: [],
      settings: {},
      createdAt: new Date().toISOString()
    }];
  }

  // Migrate old data to new structure
  const assets: Asset[] = oldAssets ? JSON.parse(oldAssets) : [];
  const history: HistorySnapshot[] = oldHistory ? JSON.parse(oldHistory) : [];

  const migratedPortfolio: Portfolio = {
    id: Math.random().toString(36).substr(2, 9),
    name: 'Main Portfolio',
    color: PORTFOLIO_COLORS[0],
    assets,
    closedPositions: [], // P2: Trading Lifecycle
    history,
    settings: {},
    createdAt: new Date().toISOString()
  };

  // Clean up old keys
  localStorage.removeItem('portfolio_assets');
  localStorage.removeItem('portfolio_history');

  console.log('✅ Migrated old portfolio data to new structure');
  return [migratedPortfolio];
};

/**
 * Migrate transactions to include required tags and currency
 *
 * Ensures all portfolios have:
 * - closedPositions array (P2 feature)
 * - Default assetType ('CRYPTO') and currency ('USD') on assets
 * - Default tag ('DCA') on transactions
 * - createdAt timestamp on transactions
 *
 * @param portfolios - Array of portfolios to migrate
 * @returns Migrated portfolios with all required fields
 */
export const migrateTransactionTags = (portfolios: Portfolio[]): Portfolio[] => {
  return portfolios.map(portfolio => ({
    ...portfolio,
    closedPositions: portfolio.closedPositions || [], // P2: Add closedPositions if missing
    assets: portfolio.assets.map(asset => ({
      ...asset,
      assetType: asset.assetType || 'CRYPTO', // Default to CRYPTO
      currency: asset.currency || 'USD', // Default to USD
      transactions: asset.transactions.map(tx => ({
        ...tx,
        tag: tx.tag || 'DCA', // Default untagged transactions to DCA
        createdAt: tx.createdAt || tx.date || new Date().toISOString() // Use transaction date as createdAt if missing
      }))
    }))
  }));
};
