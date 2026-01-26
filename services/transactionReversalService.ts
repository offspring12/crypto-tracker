/**
 * Transaction Reversal Service
 *
 * Pure functions for calculating transaction reversals.
 * These functions return new state objects without side effects.
 *
 * Used by useTransactionModifiers hook to handle transaction deletion.
 */

import { Asset, Portfolio, Transaction, Currency, TransactionTag, ClosedPosition } from '../types';
import { validateTransactionDeletion, getBalanceAtDate } from './cashFlowValidation';
import { findTransactionChain } from './transactionChainService';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Recalculate asset position from transactions
 */
export const recalculateAssetPosition = (
  transactions: Transaction[]
): { quantity: number; totalCostBasis: number; avgBuyPrice: number } => {
  const acquisitions = transactions.filter(
    (tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
  );
  const disposals = transactions.filter(
    (tx) => tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
  );

  const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
  const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
  const quantity = totalAcquired - totalDisposed;

  const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
  const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
  const totalCostBasis = totalCostAcquired - totalCostDisposed;

  return {
    quantity,
    totalCostBasis,
    avgBuyPrice: quantity > 0 ? totalCostBasis / quantity : 0,
  };
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}

/**
 * Validate if a transaction can be deleted
 */
export const validateTransactionRemoval = (
  asset: Asset,
  txId: string,
  portfolios: Portfolio[],
  activePortfolioId: string
): ValidationResult => {
  const txToDelete = asset.transactions.find((tx) => tx.id === txId);
  if (!txToDelete) {
    return { valid: false, error: 'Transaction not found' };
  }

  // Check if this is a transferred transaction
  if (txToDelete.transferredFrom) {
    const sourcePortfolio = portfolios.find((p) => p.id === txToDelete.transferredFrom);
    const sourcePortfolioName = sourcePortfolio ? sourcePortfolio.name : 'the source portfolio';
    return {
      valid: false,
      error:
        `This transaction was transferred from "${sourcePortfolioName}".\n\n` +
        `To delete it, go to "${sourcePortfolioName}" and delete the TRANSFER transaction there.\n\n` +
        `Deleting the TRANSFER in the source portfolio will automatically remove this copied transaction.`,
    };
  }

  // Use existing validation
  const validation = validateTransactionDeletion(asset, txId);
  if (!validation.valid) {
    return { valid: false, error: validation.error };
  }

  return { valid: true };
};

/**
 * Validate TRANSFER deletion
 */
export const validateTransferDeletion = (
  asset: Asset,
  tx: Transaction,
  portfolios: Portfolio[]
): ValidationResult => {
  const destinationPortfolioId = tx.destinationPortfolioId;
  if (!destinationPortfolioId) {
    return {
      valid: false,
      error: 'Cannot delete this TRANSFER transaction: Missing destination portfolio information.',
    };
  }

  const destinationPortfolio = portfolios.find((p) => p.id === destinationPortfolioId);
  if (!destinationPortfolio) {
    return {
      valid: false,
      error:
        `The destination portfolio no longer exists.\n\n` +
        `This transfer cannot be reversed.`,
    };
  }

  const destinationAsset = destinationPortfolio.assets.find((a) => a.ticker === asset.ticker);
  if (!destinationAsset) {
    return {
      valid: false,
      error:
        `${asset.ticker} no longer exists in "${destinationPortfolio.name}".\n\n` +
        `The asset may have been sold or withdrawn. Please resolve the transaction chain first.`,
    };
  }

  const availableBalanceInDest = getBalanceAtDate(destinationAsset, new Date().toISOString());
  if (availableBalanceInDest < tx.quantity) {
    return {
      valid: false,
      error:
        `Insufficient quantity in "${destinationPortfolio.name}":\n` +
        `  Required: ${tx.quantity.toLocaleString()} ${asset.ticker}\n` +
        `  Available: ${availableBalanceInDest.toLocaleString()} ${asset.ticker}\n\n` +
        `Some of the transferred assets may have been sold or withdrawn.\n` +
        `Please resolve those transactions first.`,
    };
  }

  return { valid: true };
};

/**
 * Validate SELL deletion with proceeds
 */
export const validateSellWithProceedsDeletion = (
  asset: Asset,
  tx: Transaction,
  assets: Asset[]
): ValidationResult => {
  if (!tx.proceedsCurrency) {
    return { valid: true };
  }

  const proceedsTicker = tx.proceedsCurrency;
  const proceedsAsset = assets.find((a) => a.ticker === proceedsTicker);

  if (!proceedsAsset) {
    // Proceeds don't exist - can proceed with warning
    return {
      valid: true,
      requiresConfirmation: true,
      confirmationMessage:
        `The proceeds from this SELL transaction no longer exist in your portfolio.\n\n` +
        `Deleting this transaction may cause incorrect P&L calculations and affect your closed positions.\n\n` +
        `It's recommended to keep this transaction for accurate records.\n\n` +
        `Do you still want to delete it?`,
    };
  }

  // Check for transaction chain
  const proceedsTickerBase = proceedsAsset.ticker.toUpperCase().split(' ')[0];
  const fullChain = findTransactionChain(proceedsTickerBase, assets);

  if (fullChain.length > 0) {
    let errorMessage = `The proceeds "${proceedsAsset.ticker}" have been sold in a transaction chain:\n\n`;

    const chainVisualization = [asset.ticker, proceedsAsset.ticker];
    fullChain.forEach((c) => {
      chainVisualization.push(c.soldFor);
    });
    errorMessage += `  ${chainVisualization.join(' → ')}\n\n`;

    errorMessage += `Transactions in this chain:\n`;
    errorMessage += `  • ${tx.quantity} ${asset.ticker} sold for ${proceedsAsset.ticker} on ${new Date(tx.date).toLocaleDateString()}\n`;
    fullChain.forEach((c) => {
      errorMessage += `  • ${c.tx.quantity} ${c.ticker} sold for ${c.soldFor} on ${new Date(c.tx.date).toLocaleDateString()}\n`;
    });

    errorMessage += `\nDeleting this SELL transaction would corrupt your P&L calculations.\n\n`;
    errorMessage += `To delete this transaction, you must first reverse the sales in ORDER:\n`;

    for (let i = fullChain.length - 1; i >= 0; i--) {
      const step = fullChain.length - i;
      const proceedsTicker2 = fullChain[i].soldFor.split(' ')[0];
      errorMessage += `${step}. Delete or reverse the ${fullChain[i].ticker}→${proceedsTicker2} sale\n`;
    }
    errorMessage += `${fullChain.length + 1}. Then you can delete this ${asset.ticker}→${proceedsAsset.ticker} transaction\n\n`;
    errorMessage += `This ensures your transaction history remains consistent.`;

    return { valid: false, error: errorMessage };
  }

  return { valid: true };
};

// ============================================================================
// REVERSAL CALCULATION FUNCTIONS
// ============================================================================

export interface PortfolioUpdate {
  assets: Asset[];
  closedPositions?: ClosedPosition[];
}

/**
 * Calculate WITHDRAWAL reversal
 */
export const calculateWithdrawalReversal = (
  portfolio: Portfolio,
  assetId: string,
  txId: string
): PortfolioUpdate => {
  const assetToUpdate = portfolio.assets.find((a) => a.id === assetId);
  if (!assetToUpdate) return { assets: portfolio.assets };

  const updatedTxs = assetToUpdate.transactions.filter((tx) => tx.id !== txId);
  const { quantity, totalCostBasis, avgBuyPrice } = recalculateAssetPosition(updatedTxs);

  if (quantity === 0) {
    return {
      assets: portfolio.assets.filter((a) => a.id !== assetId),
    };
  }

  return {
    assets: portfolio.assets.map((a) =>
      a.id === assetId
        ? { ...a, transactions: updatedTxs, quantity, totalCostBasis, avgBuyPrice }
        : a
    ),
  };
};

/**
 * Calculate TRANSFER reversal for source portfolio
 */
export const calculateTransferReversalSource = (
  portfolio: Portfolio,
  assetId: string,
  txId: string,
  txToDelete: Transaction,
  destinationAsset: Asset,
  originalAsset: Asset
): PortfolioUpdate => {
  const assetToUpdate = portfolio.assets.find((a) => a.id === assetId);

  if (!assetToUpdate) {
    // Asset doesn't exist in source - recreate it
    const sortedDestAcquisitions = [...destinationAsset.transactions]
      .filter((tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let remainingToRestore = txToDelete.quantity;
    const restoredTxs: Transaction[] = [];

    for (const tx of sortedDestAcquisitions) {
      if (remainingToRestore <= 0) break;

      const qtyFromThisTx = Math.min(remainingToRestore, tx.quantity);
      const costFromThisTx = (qtyFromThisTx / tx.quantity) * tx.totalCost;

      restoredTxs.push({
        ...tx,
        id: Math.random().toString(36).substr(2, 9),
        quantity: qtyFromThisTx,
        totalCost: costFromThisTx,
      });

      remainingToRestore -= qtyFromThisTx;
    }

    const restoredAsset: Asset = {
      id: assetId,
      ticker: originalAsset.ticker,
      name: originalAsset.name,
      quantity: txToDelete.quantity,
      currentPrice: originalAsset.currentPrice,
      lastUpdated: new Date().toISOString(),
      sources: originalAsset.sources,
      isUpdating: false,
      transactions: restoredTxs,
      avgBuyPrice: txToDelete.totalCost / txToDelete.quantity,
      totalCostBasis: txToDelete.totalCost,
      coinGeckoId: originalAsset.coinGeckoId,
      assetType: originalAsset.assetType,
      currency: originalAsset.currency,
    };

    return {
      assets: [...portfolio.assets, restoredAsset],
    };
  }

  // Asset exists - remove TRANSFER transaction
  const updatedTxs = assetToUpdate.transactions.filter((tx) => tx.id !== txId);
  const { quantity, totalCostBasis, avgBuyPrice } = recalculateAssetPosition(updatedTxs);

  return {
    assets: portfolio.assets.map((a) =>
      a.id === assetId
        ? { ...a, transactions: updatedTxs, quantity, totalCostBasis, avgBuyPrice }
        : a
    ),
  };
};

/**
 * Calculate TRANSFER reversal for destination portfolio
 */
export const calculateTransferReversalDestination = (
  portfolio: Portfolio,
  assetTicker: string,
  quantityToRemove: number,
  sourcePortfolioId: string
): Portfolio => {
  const destAsset = portfolio.assets.find((a) => a.ticker === assetTicker);
  if (!destAsset) return portfolio;

  const sortedAcquisitions = [...destAsset.transactions]
    .filter((tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
    .sort((a, b) => {
      const aIsTransferred = a.transferredFrom === sourcePortfolioId ? 0 : 1;
      const bIsTransferred = b.transferredFrom === sourcePortfolioId ? 0 : 1;
      if (aIsTransferred !== bIsTransferred) return aIsTransferred - bIsTransferred;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

  let remainingToRemove = quantityToRemove;
  const txsToKeep: Transaction[] = [];

  for (const tx of sortedAcquisitions) {
    if (remainingToRemove <= 0) {
      txsToKeep.push(tx);
      continue;
    }

    if (tx.quantity <= remainingToRemove) {
      remainingToRemove -= tx.quantity;
    } else {
      const qtyToRemove = remainingToRemove;
      const costToRemove = (qtyToRemove / tx.quantity) * tx.totalCost;

      txsToKeep.push({
        ...tx,
        quantity: tx.quantity - qtyToRemove,
        totalCost: tx.totalCost - costToRemove,
      });

      remainingToRemove = 0;
    }
  }

  const nonAcquisitions = destAsset.transactions.filter(
    (tx) => tx.type !== 'BUY' && tx.type !== 'DEPOSIT' && tx.type !== 'INCOME'
  );

  const finalTxs = [...txsToKeep, ...nonAcquisitions];
  const { quantity, totalCostBasis, avgBuyPrice } = recalculateAssetPosition(finalTxs);

  if (quantity === 0) {
    return {
      ...portfolio,
      assets: portfolio.assets.filter((a) => a.id !== destAsset.id),
    };
  }

  return {
    ...portfolio,
    assets: portfolio.assets.map((a) =>
      a.id === destAsset.id
        ? { ...a, transactions: finalTxs, quantity, totalCostBasis, avgBuyPrice }
        : a
    ),
  };
};

/**
 * Calculate linked BUY/SELL pair reversal
 */
export const calculateLinkedBuySellReversal = (
  portfolio: Portfolio,
  buyAssetId: string,
  buyTxId: string,
  sellAssetId: string,
  sellTxId: string
): PortfolioUpdate => {
  let updatedAssets = [...portfolio.assets];
  let updatedClosedPositions = [...(portfolio.closedPositions || [])];

  // Remove closed positions created by the linked SELL
  updatedClosedPositions = updatedClosedPositions.filter(
    (cp) => cp.sellTransactionId !== sellTxId
  );

  // Remove BUY transaction from destination asset
  updatedAssets = updatedAssets
    .map((a) => {
      if (a.id !== buyAssetId) return a;
      const updatedTxs = a.transactions.filter((tx) => tx.id !== buyTxId);
      const { quantity, totalCostBasis, avgBuyPrice } = recalculateAssetPosition(updatedTxs);

      if (quantity === 0 && updatedTxs.length === 0) {
        return null;
      }

      return { ...a, transactions: updatedTxs, quantity, totalCostBasis, avgBuyPrice };
    })
    .filter((a) => a !== null) as Asset[];

  // Remove SELL transaction from source asset
  updatedAssets = updatedAssets.map((a) => {
    if (a.id !== sellAssetId) return a;
    const updatedTxs = a.transactions.filter((tx) => tx.id !== sellTxId);
    const { quantity, totalCostBasis, avgBuyPrice } = recalculateAssetPosition(updatedTxs);
    return { ...a, transactions: updatedTxs, quantity, totalCostBasis, avgBuyPrice };
  });

  return { assets: updatedAssets, closedPositions: updatedClosedPositions };
};

/**
 * Calculate legacy BUY reversal (with sourceTicker but no linking)
 */
export const calculateLegacyBuyReversal = (
  portfolio: Portfolio,
  assetId: string,
  txId: string,
  txToDelete: Transaction,
  assetTicker: string
): PortfolioUpdate => {
  const sourceTicker = txToDelete.sourceTicker!.toUpperCase();
  const sourceQuantity = txToDelete.sourceQuantity!;
  const sourceValue = txToDelete.totalCost;

  // Remove BUY from destination
  let updatedAssets = portfolio.assets
    .map((a) => {
      if (a.id !== assetId) return a;
      const updatedTxs = a.transactions.filter((tx) => tx.id !== txId);
      const { quantity, totalCostBasis, avgBuyPrice } = recalculateAssetPosition(updatedTxs);

      if (quantity === 0 && updatedTxs.length === 0) {
        return null;
      }

      return { ...a, transactions: updatedTxs, quantity, totalCostBasis, avgBuyPrice };
    })
    .filter((a) => a !== null) as Asset[];

  // Restore source asset
  const sourceAsset = updatedAssets.find((a) => a.ticker.toUpperCase() === sourceTicker);

  if (sourceAsset) {
    const restorationTx: Transaction = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'DEPOSIT',
      quantity: sourceQuantity,
      pricePerCoin: sourceValue / sourceQuantity,
      date: txToDelete.date,
      totalCost: sourceValue,
      tag: txToDelete.tag || 'DCA',
      createdAt: new Date().toISOString(),
      depositSource: `Restored from deleted BUY of ${assetTicker}`,
    };

    updatedAssets = updatedAssets.map((a) => {
      if (a.ticker.toUpperCase() !== sourceTicker) return a;
      const updatedTxs = [...a.transactions, restorationTx];
      const { quantity, totalCostBasis, avgBuyPrice } = recalculateAssetPosition(updatedTxs);
      return {
        ...a,
        transactions: updatedTxs,
        quantity,
        totalCostBasis,
        avgBuyPrice,
        lastUpdated: new Date().toISOString(),
      };
    });
  } else {
    const newSourceAsset: Asset = {
      id: Math.random().toString(36).substr(2, 9),
      ticker: sourceTicker,
      name: sourceTicker,
      quantity: sourceQuantity,
      currentPrice: sourceValue / sourceQuantity,
      lastUpdated: new Date().toISOString(),
      sources: [],
      isUpdating: false,
      transactions: [
        {
          id: Math.random().toString(36).substr(2, 9),
          type: 'DEPOSIT',
          quantity: sourceQuantity,
          pricePerCoin: sourceValue / sourceQuantity,
          date: txToDelete.date,
          totalCost: sourceValue,
          tag: txToDelete.tag || 'DCA',
          createdAt: new Date().toISOString(),
          depositSource: `Restored from deleted BUY of ${assetTicker}`,
        },
      ],
      avgBuyPrice: sourceValue / sourceQuantity,
      totalCostBasis: sourceValue,
      assetType: 'CASH',
      currency: sourceTicker as Currency,
    };

    updatedAssets = [...updatedAssets, newSourceAsset];
  }

  return { assets: updatedAssets };
};

/**
 * Calculate SELL reversal with proceeds
 */
export const calculateSellWithProceedsReversal = (
  portfolio: Portfolio,
  assetId: string,
  txId: string,
  proceedsAssetId: string | null
): PortfolioUpdate => {
  let updatedAssets = [...portfolio.assets];
  let updatedClosedPositions = [...(portfolio.closedPositions || [])];

  // Remove proceeds asset if it exists
  if (proceedsAssetId) {
    const proceedsAsset = portfolio.assets.find((a) => a.id === proceedsAssetId);
    updatedAssets = updatedAssets.filter((a) => a.id !== proceedsAssetId);

    // Clean up orphaned closed positions
    if (proceedsAsset) {
      const deletedAssetTicker = proceedsAsset.ticker.toUpperCase().split(' ')[0];
      updatedClosedPositions = updatedClosedPositions.filter((cp) => {
        const cpTicker = cp.ticker.toUpperCase().split(' ')[0];
        return cpTicker !== deletedAssetTicker;
      });
    }
  }

  // Restore sold asset using closed positions
  const assetToRestore = portfolio.assets.find((a) => a.id === assetId);
  if (assetToRestore) {
    let filteredTxs = assetToRestore.transactions.filter((tx) => tx.id !== txId);

    const relatedClosedPositions = (portfolio.closedPositions || []).filter(
      (cp) => cp.sellTransactionId === txId
    );

    // Recreate consumed BUY transactions
    relatedClosedPositions.forEach((cp) => {
      const existingBuyTx = filteredTxs.find((t) => t.id === cp.buyTransactionId);

      if (existingBuyTx) {
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
        const recreatedBuyTx: Transaction = {
          id: cp.buyTransactionId,
          type: 'BUY',
          quantity: cp.entryQuantity,
          pricePerCoin: cp.entryPrice,
          date: cp.entryDate,
          totalCost: cp.entryCostBasis,
          tag: (cp.entryTag as TransactionTag) || 'DCA',
          createdAt: new Date().toISOString(),
          purchaseCurrency: cp.entryCurrency as Currency,
          exchangeRateAtPurchase: undefined,
        };
        filteredTxs.push(recreatedBuyTx);
      }
    });

    const { quantity, totalCostBasis, avgBuyPrice } = recalculateAssetPosition(filteredTxs);

    if (filteredTxs.length === 0) {
      updatedAssets = updatedAssets.filter((a) => a.id !== assetId);
    } else {
      updatedAssets = updatedAssets.map((a) =>
        a.id === assetId
          ? { ...a, transactions: filteredTxs, quantity, totalCostBasis, avgBuyPrice }
          : a
      );
    }
  }

  // Remove from closed positions
  updatedClosedPositions = updatedClosedPositions.filter((cp) => cp.sellTransactionId !== txId);

  return { assets: updatedAssets, closedPositions: updatedClosedPositions };
};

/**
 * Calculate simple transaction removal (no special handling needed)
 */
export const calculateSimpleTransactionRemoval = (
  portfolio: Portfolio,
  assetId: string,
  txId: string
): PortfolioUpdate => {
  const updatedAssets = portfolio.assets
    .map((a) => {
      if (a.id !== assetId) return a;
      const updatedTxs = a.transactions.filter((tx) => tx.id !== txId);
      if (updatedTxs.length === 0) return null;
      const { quantity, totalCostBasis, avgBuyPrice } = recalculateAssetPosition(updatedTxs);
      return { ...a, transactions: updatedTxs, quantity, totalCostBasis, avgBuyPrice };
    })
    .filter((a) => a !== null) as Asset[];

  return { assets: updatedAssets };
};

/**
 * Check if a BUY transaction is proceeds from a SELL
 */
export const findMatchingSellForBuy = (
  asset: Asset,
  txToDelete: Transaction,
  assets: Asset[]
): { asset: Asset; tx: Transaction } | null => {
  const assetTickerBase = asset.ticker.toUpperCase().split(' ')[0];
  const sellTransactionsForThisAsset: Array<{ asset: Asset; tx: Transaction }> = [];

  assets.forEach((a) => {
    a.transactions.forEach((tx) => {
      if (tx.type === 'SELL' && tx.proceedsCurrency) {
        const proceedsTicker = tx.proceedsCurrency.toUpperCase().split(' ')[0];
        if (proceedsTicker === assetTickerBase) {
          sellTransactionsForThisAsset.push({ asset: a, tx });
        }
      }
    });
  });

  if (sellTransactionsForThisAsset.length > 0) {
    const matchingSellTx = sellTransactionsForThisAsset.find(({ tx }) => {
      const sellDate = new Date(tx.date).toDateString();
      const buyDate = new Date(txToDelete.date).toDateString();
      return sellDate === buyDate;
    });

    return matchingSellTx || null;
  }

  return null;
};
