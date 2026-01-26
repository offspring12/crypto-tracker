/**
 * Transaction Modifiers Hook
 *
 * Thin wrapper around transactionReversalService that handles:
 * - User confirmations (window.confirm, alert)
 * - State updates via updateActivePortfolio and setPortfolios
 *
 * Business logic lives in services/transactionReversalService.ts
 */

import { useCallback } from 'react';
import { Asset, Portfolio, TransactionTag, Currency } from '../types';
import {
  validateTransactionRemoval,
  validateTransferDeletion,
  validateSellWithProceedsDeletion,
  calculateWithdrawalReversal,
  calculateTransferReversalSource,
  calculateTransferReversalDestination,
  calculateLinkedBuySellReversal,
  calculateLegacyBuyReversal,
  calculateSellWithProceedsReversal,
  calculateSimpleTransactionRemoval,
  findMatchingSellForBuy,
} from '../services/transactionReversalService';

export interface UseTransactionModifiersProps {
  assets: Asset[];
  portfolios: Portfolio[];
  activePortfolioId: string;
  activePortfolio: Portfolio;
  updateActivePortfolio: (updater: (portfolio: Portfolio) => Portfolio) => void;
  setPortfolios: React.Dispatch<React.SetStateAction<Portfolio[]>>;
  displayCurrency: Currency;
  handleRemoveAsset: (assetId: string) => void;
}

export interface UseTransactionModifiersResult {
  handleRemoveTransaction: (assetId: string, txId: string) => void;
  handleEditTransaction: (
    assetId: string,
    txId: string,
    updates: {
      quantity: number;
      pricePerCoin: number;
      date: string;
      tag: TransactionTag;
      customTag?: string;
    }
  ) => void;
}

export const useTransactionModifiers = ({
  assets,
  portfolios,
  activePortfolioId,
  activePortfolio,
  updateActivePortfolio,
  setPortfolios,
  displayCurrency,
  handleRemoveAsset,
}: UseTransactionModifiersProps): UseTransactionModifiersResult => {
  /**
   * Handle transaction removal with all reversal logic
   */
  const handleRemoveTransaction = useCallback(
    (assetId: string, txId: string) => {
      const asset = assets.find((a) => a.id === assetId);
      if (!asset) return;

      const txToDelete = asset.transactions.find((tx) => tx.id === txId);
      if (!txToDelete) return;

      // Initial validation
      const validation = validateTransactionRemoval(asset, txId, portfolios, activePortfolioId);
      if (!validation.valid) {
        alert(`⚠️ Cannot Delete Transaction\n\n${validation.error}`);
        return;
      }

      // Handle WITHDRAWAL
      if (txToDelete.type === 'WITHDRAWAL') {
        const confirmed = window.confirm(
          `⚠️ Delete Withdrawal Transaction?\n\n` +
            `This will increase your position by ${txToDelete.quantity.toLocaleString()} ${asset.ticker}.\n\n` +
            `Destination: ${txToDelete.withdrawalDestination}\n` +
            `Date: ${new Date(txToDelete.date).toLocaleDateString()}\n\n` +
            `Do you want to continue?`
        );

        if (!confirmed) return;

        updateActivePortfolio((portfolio) => {
          const update = calculateWithdrawalReversal(portfolio, assetId, txId);
          return { ...portfolio, assets: update.assets };
        });
        return;
      }

      // Handle TRANSFER
      if (txToDelete.type === 'TRANSFER') {
        const transferValidation = validateTransferDeletion(asset, txToDelete, portfolios);
        if (!transferValidation.valid) {
          alert(`❌ Cannot delete this TRANSFER transaction.\n\n${transferValidation.error}`);
          return;
        }

        const destinationPortfolio = portfolios.find(
          (p) => p.id === txToDelete.destinationPortfolioId
        )!;
        const destinationAsset = destinationPortfolio.assets.find(
          (a) => a.ticker === asset.ticker
        )!;

        const transferCurrency = txToDelete.purchaseCurrency || asset.currency || 'USD';
        const confirmed = window.confirm(
          `⚠️ Delete Transfer Transaction?\n\n` +
            `This will:\n` +
            `  • Restore ${txToDelete.quantity.toLocaleString()} ${asset.ticker} to this portfolio\n` +
            `  • Remove ${txToDelete.quantity.toLocaleString()} ${asset.ticker} from "${destinationPortfolio.name}"\n\n` +
            `Date: ${new Date(txToDelete.date).toLocaleDateString()}\n` +
            `Cost Basis: ${txToDelete.totalCost.toLocaleString()} ${transferCurrency}\n\n` +
            `Do you want to continue?`
        );

        if (!confirmed) return;

        // Update source portfolio
        updateActivePortfolio((portfolio) => {
          const update = calculateTransferReversalSource(
            portfolio,
            assetId,
            txId,
            txToDelete,
            destinationAsset,
            asset
          );
          return { ...portfolio, assets: update.assets };
        });

        // Update destination portfolio
        setPortfolios((prevPortfolios) =>
          prevPortfolios.map((p) => {
            if (p.id !== txToDelete.destinationPortfolioId) return p;
            return calculateTransferReversalDestination(
              p,
              asset.ticker,
              txToDelete.quantity,
              activePortfolio.id
            );
          })
        );
        return;
      }

      // Handle BUY with linked SELL
      if (txToDelete.type === 'BUY' && txToDelete.linkedBuySellTransactionId) {
        const linkedTxData = assets
          .flatMap((a) => a.transactions.map((tx) => ({ asset: a, tx })))
          .find(({ tx }) => tx.id === txToDelete.linkedBuySellTransactionId);

        if (!linkedTxData) {
          const confirmed = window.confirm(
            `⚠️ Warning: Cannot find the linked source transaction.\n\n` +
              `This BUY transaction was created before transaction linking was implemented, or the source transaction has been deleted.\n\n` +
              `Deleting it will NOT restore the source asset.\n\n` +
              `Do you want to continue?`
          );
          if (!confirmed) return;
          // Fall through to simple deletion
        } else {
          const sourceTicker = linkedTxData.asset.ticker;
          const sourceQuantity = txToDelete.sourceQuantity || 0;

          const confirmed = window.confirm(
            `⚠️ Delete Buy Transaction?\n\n` +
              `This will delete BOTH transactions:\n` +
              `  • BUY: ${txToDelete.quantity.toLocaleString()} ${asset.ticker}\n` +
              `  • SELL: ${sourceQuantity.toLocaleString()} ${sourceTicker}\n\n` +
              `The ${sourceTicker} will be restored to your portfolio.\n\n` +
              `Date: ${new Date(txToDelete.date).toLocaleDateString()}\n\n` +
              `Do you want to continue?`
          );

          if (!confirmed) return;

          updateActivePortfolio((portfolio) => {
            const update = calculateLinkedBuySellReversal(
              portfolio,
              assetId,
              txId,
              linkedTxData.asset.id,
              txToDelete.linkedBuySellTransactionId!
            );
            return {
              ...portfolio,
              assets: update.assets,
              closedPositions: update.closedPositions || portfolio.closedPositions,
            };
          });
          return;
        }
      }

      // Handle BUY with sourceTicker (legacy)
      if (txToDelete.type === 'BUY' && txToDelete.sourceTicker && txToDelete.sourceQuantity) {
        const sourceTicker = txToDelete.sourceTicker.toUpperCase();
        const sourceQuantity = txToDelete.sourceQuantity;
        const sourceValue = txToDelete.totalCost;

        const confirmed = window.confirm(
          `⚠️ Delete Buy Transaction?\n\n` +
            `This will:\n` +
            `  • Remove ${txToDelete.quantity.toLocaleString()} ${asset.ticker}\n` +
            `  • Restore ${sourceQuantity.toLocaleString()} ${sourceTicker}\n\n` +
            `Date: ${new Date(txToDelete.date).toLocaleDateString()}\n` +
            `Cost: ${sourceValue.toLocaleString()} ${displayCurrency}\n\n` +
            `Do you want to continue?`
        );

        if (!confirmed) return;

        updateActivePortfolio((portfolio) => {
          const update = calculateLegacyBuyReversal(
            portfolio,
            assetId,
            txId,
            txToDelete,
            asset.ticker
          );
          return { ...portfolio, assets: update.assets };
        });
        return;
      }

      // Handle SELL with linked BUY
      if (
        txToDelete.type === 'SELL' &&
        txToDelete.proceedsCurrency &&
        txToDelete.linkedBuySellTransactionId
      ) {
        const linkedBuyTxData = assets
          .flatMap((a) => a.transactions.map((tx) => ({ asset: a, tx })))
          .find(({ tx }) => tx.id === txToDelete.linkedBuySellTransactionId);

        if (linkedBuyTxData) {
          const confirmed = window.confirm(
            `⚠️ Delete Sell Transaction?\n\n` +
              `This SELL is part of a BUY transaction pair.\n\n` +
              `Deleting it will also delete:\n` +
              `  • BUY: ${linkedBuyTxData.tx.quantity.toLocaleString()} ${linkedBuyTxData.asset.ticker}\n\n` +
              `Your ${asset.ticker} position will be restored.\n\n` +
              `Do you want to continue?`
          );

          if (!confirmed) return;

          updateActivePortfolio((portfolio) => {
            const update = calculateLinkedBuySellReversal(
              portfolio,
              linkedBuyTxData.asset.id,
              txToDelete.linkedBuySellTransactionId!,
              assetId,
              txId
            );
            return {
              ...portfolio,
              assets: update.assets,
              closedPositions: update.closedPositions || portfolio.closedPositions,
            };
          });
          return;
        }
      }

      // Handle SELL with proceeds (no linking)
      if (
        txToDelete.type === 'SELL' &&
        txToDelete.proceedsCurrency &&
        !txToDelete.linkedBuySellTransactionId
      ) {
        const sellValidation = validateSellWithProceedsDeletion(asset, txToDelete, assets);
        if (!sellValidation.valid) {
          alert(`❌ Cannot Delete\n\n${sellValidation.error}`);
          return;
        }

        const proceedsTicker = txToDelete.proceedsCurrency;
        const proceedsAsset = assets.find((a) => a.ticker === proceedsTicker);

        if (proceedsAsset) {
          const confirmed = window.confirm(
            `⚠️ Warning: Deleting this SELL transaction will also remove the proceeds position:\n\n` +
              `${proceedsAsset.ticker}: ${proceedsAsset.quantity.toLocaleString()} units\n\n` +
              `This will affect your portfolio value and P&L calculations.\n\n` +
              `Do you want to continue?`
          );
          if (!confirmed) return;

          updateActivePortfolio((portfolio) => {
            const update = calculateSellWithProceedsReversal(
              portfolio,
              assetId,
              txId,
              proceedsAsset.id
            );
            return {
              ...portfolio,
              assets: update.assets,
              closedPositions: update.closedPositions || portfolio.closedPositions,
            };
          });
        } else {
          // Proceeds don't exist
          const confirmed = window.confirm(
            sellValidation.confirmationMessage ||
              `Delete this transaction?\n\nDo you want to continue?`
          );
          if (!confirmed) return;

          updateActivePortfolio((portfolio) => {
            const update = calculateSellWithProceedsReversal(portfolio, assetId, txId, null);
            return {
              ...portfolio,
              assets: update.assets,
              closedPositions: update.closedPositions || portfolio.closedPositions,
            };
          });
        }
        return;
      }

      // Handle BUY that is proceeds from a SELL
      if (txToDelete.type === 'BUY' || txToDelete.type === 'DEPOSIT' || txToDelete.type === 'INCOME') {
        const matchingSell = findMatchingSellForBuy(asset, txToDelete, assets);

        if (matchingSell) {
          if (asset.transactions.length === 1) {
            const confirmed = window.confirm(
              `⚠️ Warning: "${asset.ticker}" is proceeds from a sell transaction.\n\n` +
                `Deleting this transaction will remove the entire position and REVERSE the original sale.\n\n` +
                `Do you want to continue?`
            );

            if (!confirmed) return;

            handleRemoveAsset(assetId);
            return;
          } else {
            alert(
              `❌ Cannot delete this transaction.\n\n` +
                `This "${asset.ticker}" purchase is proceeds from selling ${matchingSell.asset.ticker}.\n\n` +
                `To reverse this, you must delete the entire "${asset.ticker}" position using the delete button (trash icon next to refresh).`
            );
            return;
          }
        }
      }

      // Simple deletion (no special handling needed)
      updateActivePortfolio((portfolio) => {
        const update = calculateSimpleTransactionRemoval(portfolio, assetId, txId);
        return { ...portfolio, assets: update.assets };
      });
    },
    [
      assets,
      portfolios,
      activePortfolioId,
      activePortfolio,
      updateActivePortfolio,
      setPortfolios,
      displayCurrency,
      handleRemoveAsset,
    ]
  );

  /**
   * Handle transaction editing
   */
  const handleEditTransaction = useCallback(
    (
      assetId: string,
      txId: string,
      updates: {
        quantity: number;
        pricePerCoin: number;
        date: string;
        tag: TransactionTag;
        customTag?: string;
      }
    ) => {
      updateActivePortfolio((portfolio) => ({
        ...portfolio,
        assets: portfolio.assets.map((asset) => {
          if (asset.id !== assetId) return asset;

          const updatedTransactions = asset.transactions.map((tx) => {
            if (tx.id !== txId) return tx;

            return {
              ...tx,
              quantity: updates.quantity,
              pricePerCoin: updates.pricePerCoin,
              date: updates.date,
              totalCost: updates.quantity * updates.pricePerCoin,
              tag: updates.tag,
              customTag: updates.customTag,
              lastEdited: new Date().toISOString(),
            };
          });

          const newQty = updatedTransactions.reduce((sum, tx) => sum + tx.quantity, 0);
          const newCost = updatedTransactions.reduce((sum, tx) => sum + tx.totalCost, 0);

          return {
            ...asset,
            transactions: updatedTransactions,
            quantity: newQty,
            totalCostBasis: newCost,
            avgBuyPrice: newCost / newQty,
          };
        }),
      }));
    },
    [updateActivePortfolio]
  );

  return {
    handleRemoveTransaction,
    handleEditTransaction,
  };
};
