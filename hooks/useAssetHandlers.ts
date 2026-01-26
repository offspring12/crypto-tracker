/**
 * Asset Handlers Hook
 *
 * Provides handlers for asset CRUD operations including:
 * - Update asset properties
 * - Refresh asset price
 * - Add new asset (with transaction)
 * - Remove asset (with reversal logic for sell proceeds)
 *
 * Extracted from App.tsx for better code organization.
 */

import { useCallback } from 'react';
import { Asset, Portfolio, Transaction, Currency, TransactionTag } from '../types';
import { fetchCryptoPrice, fetchAssetHistory } from '../services/geminiService';
import { fetchHistoricalExchangeRatesForDate } from '../services/currencyService';
import { findTransactionChain } from '../services/transactionChainService';

export interface UseAssetHandlersProps {
  /** All assets in the active portfolio */
  assets: Asset[];
  /** All portfolios (for debug logging) */
  portfolios: Portfolio[];
  /** Active portfolio ID (for debug logging) */
  activePortfolioId: string;
  /** Helper to update the active portfolio */
  updateActivePortfolio: (updater: (portfolio: Portfolio) => Portfolio) => void;
}

export interface UseAssetHandlersResult {
  /** Update an asset's properties */
  handleUpdateAsset: (id: string, updates: Partial<Asset>) => void;
  /** Refresh an asset's price from API */
  handleRefreshAsset: (id: string) => Promise<void>;
  /** Add a new asset with a BUY transaction */
  handleAddAsset: (
    ticker: string,
    quantity: number,
    pricePerCoin: number,
    date: string,
    currency?: Currency,
    tag?: TransactionTag
  ) => Promise<void>;
  /** Remove an asset (with sell reversal logic) */
  handleRemoveAsset: (assetId: string) => void;
}

/**
 * Hook for asset CRUD operations
 *
 * @param props - Dependencies from portfolio state
 * @returns Asset operation handlers
 */
export const useAssetHandlers = ({
  assets,
  portfolios,
  activePortfolioId,
  updateActivePortfolio,
}: UseAssetHandlersProps): UseAssetHandlersResult => {
  // Update an asset's properties
  const handleUpdateAsset = useCallback(
    (id: string, updates: Partial<Asset>) => {
      updateActivePortfolio((portfolio) => ({
        ...portfolio,
        assets: portfolio.assets.map((a) => (a.id === id ? { ...a, ...updates } : a)),
      }));
    },
    [updateActivePortfolio]
  );

  // Refresh an asset's price from API
  const handleRefreshAsset = useCallback(
    async (id: string) => {
      const asset = assets.find((a) => a.id === id);
      if (!asset) return;

      updateActivePortfolio((portfolio) => ({
        ...portfolio,
        assets: portfolio.assets.map((a) => (a.id === id ? { ...a, isUpdating: true } : a)),
      }));

      try {
        const result = await fetchCryptoPrice(asset.ticker);
        updateActivePortfolio((portfolio) => ({
          ...portfolio,
          assets: portfolio.assets.map((a) =>
            a.id === id
              ? {
                  ...a,
                  currentPrice: result.price,
                  sources: result.sources,
                  lastUpdated: new Date().toISOString(),
                  isUpdating: false,
                  error: undefined,
                  name: result.name || result.symbol || a.name,
                  currency: result.currency || 'USD',
                }
              : a
          ),
        }));
      } catch (error: any) {
        updateActivePortfolio((portfolio) => ({
          ...portfolio,
          assets: portfolio.assets.map((a) =>
            a.id === id ? { ...a, isUpdating: false, error: error.message || 'Failed' } : a
          ),
        }));
      }
    },
    [assets, updateActivePortfolio]
  );

  // Add a new asset with a BUY transaction
  const handleAddAsset = useCallback(
    async (
      ticker: string,
      quantity: number,
      pricePerCoin: number,
      date: string,
      currency: Currency = 'USD',
      tag?: TransactionTag
    ) => {
      const totalCost = quantity * pricePerCoin;

      // Parse date in local timezone to avoid timezone conversion issues
      const [year, month, day] = date.split('-').map(Number);
      const localDate = new Date(year, month - 1, day);

      // Fetch historical FX rates for the purchase date
      let historicalRates: Record<Currency, number> | undefined;
      try {
        console.log(`💱 Fetching historical FX rates for purchase date: ${date}`);
        historicalRates = await fetchHistoricalExchangeRatesForDate(localDate);
        console.log(`✅ Historical FX rates fetched for ${date}:`, historicalRates);
      } catch (error) {
        console.warn(
          `⚠️ Failed to fetch historical FX rates for ${date}, transaction will proceed without them:`,
          error
        );
      }

      const newTx: Transaction = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'BUY',
        quantity,
        pricePerCoin,
        date,
        totalCost,
        tag: tag || 'DCA',
        createdAt: new Date().toISOString(),
        purchaseCurrency: currency,
        exchangeRateAtPurchase: historicalRates,
      };

      const existingAsset = assets.find((a) => a.ticker === ticker);

      if (existingAsset) {
        const updatedTransactions = [...existingAsset.transactions, newTx];
        const newTotalQty = existingAsset.quantity + quantity;
        const newTotalCostBasis = existingAsset.totalCostBasis + totalCost;
        updateActivePortfolio((portfolio) => ({
          ...portfolio,
          assets: portfolio.assets.map((a) =>
            a.id === existingAsset.id
              ? {
                  ...a,
                  quantity: newTotalQty,
                  transactions: updatedTransactions,
                  totalCostBasis: newTotalCostBasis,
                  avgBuyPrice: newTotalCostBasis / newTotalQty,
                }
              : a
          ),
        }));
      } else {
        const newId = Math.random().toString(36).substr(2, 9);

        const tempAsset: Asset = {
          id: newId,
          ticker,
          name: undefined,
          quantity,
          currentPrice: 0,
          lastUpdated: new Date().toISOString(),
          sources: [],
          isUpdating: true,
          transactions: [newTx],
          avgBuyPrice: pricePerCoin,
          totalCostBasis: totalCost,
          assetType: undefined,
          currency: currency,
        };

        updateActivePortfolio((portfolio) => ({
          ...portfolio,
          assets: [...portfolio.assets, tempAsset],
        }));

        try {
          const result = await fetchCryptoPrice(ticker);
          updateActivePortfolio((portfolio) => ({
            ...portfolio,
            assets: portfolio.assets.map((a) =>
              a.id === newId
                ? {
                    ...a,
                    currentPrice: result.price,
                    sources: result.sources,
                    isUpdating: false,
                    name: result.name || result.symbol || a.name,
                    assetType: result.assetType || 'CRYPTO',
                    currency: result.currency || 'USD',
                  }
                : a
            ),
          }));

          const historyData = await fetchAssetHistory(ticker, result.price, result.symbol, result.assetType);
          if (historyData) {
            updateActivePortfolio((portfolio) => ({
              ...portfolio,
              assets: portfolio.assets.map((a) =>
                a.id === newId ? { ...a, priceHistory: historyData } : a
              ),
            }));
          }
        } catch (error: any) {
          updateActivePortfolio((portfolio) => ({
            ...portfolio,
            assets: portfolio.assets.map((a) =>
              a.id === newId ? { ...a, isUpdating: false, error: error.message || 'Failed' } : a
            ),
          }));
        }
      }
    },
    [assets, updateActivePortfolio]
  );

  // Remove an asset (with sell reversal logic)
  const handleRemoveAsset = useCallback(
    (assetId: string) => {
      const assetToDelete = assets.find((a) => a.id === assetId);
      if (!assetToDelete) return;

      console.log('🗑️ Attempting to delete asset:', assetToDelete.ticker, 'ID:', assetId);

      // Check if this asset is proceeds from a sell transaction
      const sellTransactionsForThisAsset: Array<{ asset: Asset; tx: Transaction }> = [];

      assets.forEach((asset) => {
        asset.transactions.forEach((tx) => {
          if (tx.type === 'SELL' && tx.proceedsCurrency) {
            console.log('  Found SELL tx:', tx.proceedsCurrency, 'vs', assetToDelete.ticker);
            const proceedsTicker = tx.proceedsCurrency.toUpperCase().split(' ')[0];
            const assetTicker = assetToDelete.ticker.toUpperCase().split(' ')[0];

            if (proceedsTicker === assetTicker) {
              console.log('  ✅ MATCH! Adding to sellTransactionsForThisAsset');
              sellTransactionsForThisAsset.push({ asset, tx });
            }
          }
        });
      });

      console.log('📊 Found', sellTransactionsForThisAsset.length, 'sell transactions for this asset');

      if (sellTransactionsForThisAsset.length > 0) {
        // This asset came from sell transactions - check if it's been used in subsequent sales
        const sellList = sellTransactionsForThisAsset
          .map(
            ({ asset, tx }) =>
              `  • ${tx.quantity} ${asset.ticker} sold on ${new Date(tx.date).toLocaleDateString()}`
          )
          .join('\n');

        // Check for transaction chain
        const assetTickerBase = assetToDelete.ticker.toUpperCase().split(' ')[0];
        const fullChain = findTransactionChain(assetTickerBase, assets);

        console.log('🔍 Checking for transaction chain from', assetToDelete.ticker);
        console.log('  Found chain of length:', fullChain.length);
        if (fullChain.length > 0) {
          console.log('  ⚠️ Full chain:', fullChain.map((c) => `${c.ticker}→${c.soldFor}`).join(', '));
        }

        if (fullChain.length > 0) {
          // Can't reverse - this position has been used in subsequent sales
          let errorMessage = `❌ Cannot Delete: "${assetToDelete.ticker}" is part of a transaction chain:\n\n`;

          const chainVisualization = [assetToDelete.ticker];
          fullChain.forEach((c) => {
            chainVisualization.push(c.soldFor);
          });
          errorMessage += `  ${chainVisualization.join(' → ')}\n\n`;

          errorMessage += `Transactions in this chain:\n`;
          fullChain.forEach((c) => {
            errorMessage += `  • ${c.tx.quantity} ${c.ticker} sold for ${c.soldFor} on ${new Date(
              c.tx.date
            ).toLocaleDateString()}\n`;
          });

          errorMessage += `\n⚠️ Deleting this position would corrupt your P&L calculations and transaction history.\n\n`;
          errorMessage += `To delete "${assetToDelete.ticker}", you must first reverse the sales in ORDER:\n`;

          for (let i = fullChain.length - 1; i >= 0; i--) {
            const step = fullChain.length - i;
            const proceedsTicker = fullChain[i].soldFor.split(' ')[0];
            errorMessage += `${step}. Delete or reverse the ${fullChain[i].ticker}→${proceedsTicker} sale\n`;
          }
          errorMessage += `${fullChain.length + 1}. Then you can delete "${assetToDelete.ticker}"\n\n`;
          errorMessage += `This ensures your transaction history remains consistent.`;

          alert(errorMessage);
          return;
        }

        // No subsequent sales - safe to reverse
        const confirmed = window.confirm(
          `⚠️ Warning: "${assetToDelete.ticker}" is proceeds from the following sell transaction(s):\n\n` +
            `${sellList}\n\n` +
            `Deleting this position will REVERSE these sales:\n` +
            `- The sell transactions will be deleted\n` +
            `- The sold assets will be restored to your holdings\n` +
            `- Closed positions will be removed\n` +
            `- P&L calculations will be recalculated\n\n` +
            `Do you want to continue and reverse these sales?`
        );

        if (!confirmed) return;

        // Reverse all the sell transactions
        updateActivePortfolio((portfolio) => {
          console.log('🔄 Starting reversal process');
          console.log('  Portfolio has', portfolio.assets.length, 'assets');
          console.log('  Deleting asset:', assetId);

          let updatedAssets = portfolio.assets.filter((a) => a.id !== assetId);
          console.log('  After filtering, have', updatedAssets.length, 'assets');

          let updatedClosedPositions = [...(portfolio.closedPositions || [])];

          sellTransactionsForThisAsset.forEach(({ asset, tx }) => {
            console.log('  🔄 Reversing SELL transaction:', tx.id, 'from', asset.ticker);
            console.log('     Sold quantity:', tx.quantity, asset.ticker);

            const assetStillExists = updatedAssets.find((a) => a.id === asset.id);
            console.log('     Asset still in portfolio?', !!assetStillExists);

            let filteredTxs = asset.transactions.filter((t) => t.id !== tx.id);
            console.log(
              '     Transactions before:',
              asset.transactions.length,
              '-> after:',
              filteredTxs.length
            );

            // Find closed positions for this sell to restore BUY transactions
            const relatedClosedPositions = (portfolio.closedPositions || []).filter(
              (cp) => cp.sellTransactionId === tx.id
            );

            console.log('     Found', relatedClosedPositions.length, 'closed positions to reverse');

            // Recreate the BUY transactions that were consumed by FIFO
            relatedClosedPositions.forEach((cp) => {
              const existingBuyTx = filteredTxs.find((t) => t.id === cp.buyTransactionId);

              if (existingBuyTx) {
                console.log('       Restoring partial BUY:', cp.entryQuantity, 'to tx', cp.buyTransactionId);
                filteredTxs = filteredTxs.map((t) =>
                  t.id === cp.buyTransactionId
                    ? {
                        ...t,
                        quantity: t.quantity + cp.entryQuantity,
                        totalCost: t.totalCost + cp.entryCostBasis,
                      }
                    : t
                );
              } else {
                console.log('       Recreating full BUY:', cp.entryQuantity, '@', cp.entryPrice);
                const recreatedBuyTx: Transaction = {
                  id: cp.buyTransactionId,
                  type: 'BUY',
                  quantity: cp.entryQuantity,
                  pricePerCoin: cp.entryPrice,
                  date: cp.entryDate,
                  totalCost: cp.entryCostBasis,
                  tag: cp.entryTag || 'DCA',
                  createdAt: new Date().toISOString(),
                  purchaseCurrency: cp.entryCurrency as Currency,
                  exchangeRateAtPurchase: undefined,
                };
                filteredTxs.push(recreatedBuyTx);
              }
            });

            // Recalculate from the restored transactions
            const buyTxs = filteredTxs.filter((t) => t.type === 'BUY');
            const newQty = buyTxs.reduce((sum, t) => sum + t.quantity, 0);
            const newCost = buyTxs.reduce((sum, t) => sum + t.totalCost, 0);

            console.log('     Restored quantity:', newQty, '(from', buyTxs.length, 'BUY transactions)');
            console.log('     Restored cost basis:', newCost);

            const assetFound = updatedAssets.some((a) => a.id === asset.id);
            console.log('     Can find asset to update?', assetFound);

            updatedAssets = updatedAssets.map((a) =>
              a.id === asset.id
                ? {
                    ...a,
                    transactions: filteredTxs,
                    quantity: newQty,
                    totalCostBasis: newCost,
                    avgBuyPrice: newQty > 0 ? newCost / newQty : 0,
                  }
                : a
            );

            // Remove closed positions related to this sell transaction
            updatedClosedPositions = updatedClosedPositions.filter((cp) => cp.sellTransactionId !== tx.id);
            console.log('     ✅ Reversal complete for', asset.ticker);
          });

          console.log('🏁 Reversal complete. Final asset count:', updatedAssets.length);

          // Clean up orphaned closed positions from the deleted asset
          const deletedAssetTicker = assetToDelete.ticker.toUpperCase().split(' ')[0];
          const orphanedClosedPositions = updatedClosedPositions.filter((cp) => {
            const cpTicker = cp.ticker.toUpperCase().split(' ')[0];
            return cpTicker === deletedAssetTicker;
          });

          if (orphanedClosedPositions.length > 0) {
            console.log(
              '🧹 Cleaning up',
              orphanedClosedPositions.length,
              'orphaned closed positions for',
              deletedAssetTicker
            );
            updatedClosedPositions = updatedClosedPositions.filter((cp) => {
              const cpTicker = cp.ticker.toUpperCase().split(' ')[0];
              return cpTicker !== deletedAssetTicker;
            });
          }

          // Log the final state
          updatedAssets.forEach((a) => {
            console.log(
              `  📦 Final state for ${a.ticker}: quantity=${a.quantity}, transactions=${a.transactions.length}`
            );
          });

          const finalPortfolio = {
            ...portfolio,
            assets: updatedAssets,
            closedPositions: updatedClosedPositions,
          };

          console.log('📤 Returning updated portfolio with', finalPortfolio.assets.length, 'assets');
          console.log('📤 Closed positions count:', updatedClosedPositions.length);
          return finalPortfolio;
        });

        // Debug: Log state after update
        console.log('🔍 After updateActivePortfolio call, checking current assets state:');
        setTimeout(() => {
          const currentAssets = portfolios.find((p) => p.id === activePortfolioId)?.assets || [];
          console.log('  Current portfolio has', currentAssets.length, 'assets');
          currentAssets.forEach((a) => {
            console.log(`  ${a.ticker}: quantity=${a.quantity}, transactions=${a.transactions.length}`);
          });
        }, 100);
      } else {
        // Normal asset deletion - just confirm
        const confirmed = window.confirm(
          `Are you sure you want to delete ${assetToDelete.ticker}?\n\n` +
            `This will remove all ${assetToDelete.quantity.toLocaleString()} units and transaction history.`
        );

        if (!confirmed) return;

        updateActivePortfolio((portfolio) => ({
          ...portfolio,
          assets: portfolio.assets.filter((a) => a.id !== assetId),
        }));
      }
    },
    [assets, portfolios, activePortfolioId, updateActivePortfolio]
  );

  return {
    handleUpdateAsset,
    handleRefreshAsset,
    handleAddAsset,
    handleRemoveAsset,
  };
};
