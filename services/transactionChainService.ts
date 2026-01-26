/**
 * Transaction Chain Service
 *
 * Handles finding and validating linked transaction chains.
 * Used to prevent deletion of assets that are part of a transaction chain
 * (e.g., BTC → ETH → SOL where each arrow is a sell/buy transaction).
 *
 * Extracted from App.tsx for better code organization.
 */

import { Asset, Transaction } from '../types';

/**
 * Represents a link in a transaction chain
 */
export interface TransactionChainLink {
  ticker: string;
  soldFor: string;
  asset: Asset;
  tx: Transaction;
}

/**
 * Recursively find all assets in a transaction chain
 *
 * Starting from a given ticker, finds all SELL transactions and follows
 * the proceeds to build a complete chain of linked transactions.
 *
 * Example: If you sold BTC for ETH, then sold ETH for SOL,
 * calling findTransactionChain('BTC', assets) would return:
 * [{ ticker: 'BTC', soldFor: 'ETH', ... }, { ticker: 'ETH', soldFor: 'SOL', ... }]
 *
 * @param ticker - The starting ticker to search from
 * @param assets - Array of all assets in the portfolio
 * @param visited - Set of already-visited tickers (prevents infinite loops)
 * @returns Array of transaction chain links
 */
export const findTransactionChain = (
  ticker: string,
  assets: Asset[],
  visited = new Set<string>()
): TransactionChainLink[] => {
  if (visited.has(ticker)) return []; // Prevent infinite loops
  visited.add(ticker);

  const chain: TransactionChainLink[] = [];

  // Find all SELL transactions FROM this ticker
  assets.forEach(asset => {
    const assetTicker = asset.ticker.toUpperCase().split(' ')[0];
    if (assetTicker === ticker.toUpperCase()) {
      const sellTxs = asset.transactions.filter(tx => tx.type === 'SELL');
      sellTxs.forEach(tx => {
        if (tx.proceedsCurrency) {
          const proceedsTicker = tx.proceedsCurrency.toUpperCase().split(' ')[0];
          chain.push({ ticker: asset.ticker, soldFor: tx.proceedsCurrency, asset, tx });

          // Recursively find subsequent sales
          const subChain = findTransactionChain(proceedsTicker, assets, visited);
          chain.push(...subChain);
        }
      });
    }
  });

  return chain;
};
