/**
 * Transaction Handlers Hook
 *
 * Provides handlers for all transaction types:
 * - Deposit (external assets into portfolio)
 * - Income (dividends, staking, airdrops)
 * - Withdrawal (assets leaving portfolio)
 * - Buy with validation (swap one asset for another)
 * - Portfolio transfer (move between portfolios)
 *
 * Extracted from App.tsx for better code organization.
 */

import { useCallback } from 'react';
import { Asset, Portfolio, Transaction, Currency, TransactionTag } from '../types';
import { fetchCryptoPrice, fetchAssetHistory } from '../services/geminiService';
import { fetchHistoricalExchangeRatesForDate, convertCurrencySync } from '../services/currencyService';
import { validateBuyTransaction } from '../services/cashFlowValidation';
import {
  calculateRealizedPnL,
  detectAssetNativeCurrency,
  getHistoricalPrice,
  isCashAsset,
} from '../services/portfolioService';

export interface UseTransactionHandlersProps {
  /** All assets in the active portfolio */
  assets: Asset[];
  /** All portfolios */
  portfolios: Portfolio[];
  /** Active portfolio ID */
  activePortfolioId: string;
  /** Active portfolio object */
  activePortfolio: Portfolio;
  /** Helper to update the active portfolio */
  updateActivePortfolio: (updater: (portfolio: Portfolio) => Portfolio) => void;
  /** Direct setter for all portfolios (for portfolio transfers) */
  setPortfolios: React.Dispatch<React.SetStateAction<Portfolio[]>>;
  /** Current display currency */
  displayCurrency: Currency;
  /** Current exchange rates */
  exchangeRates: Record<string, number>;
  /** Handler to add a new asset (from useAssetHandlers) */
  handleAddAsset: (
    ticker: string,
    quantity: number,
    pricePerCoin: number,
    date: string,
    currency?: Currency,
    tag?: TransactionTag
  ) => Promise<void>;
}

export interface UseTransactionHandlersResult {
  /** Handle deposit transaction */
  handleDeposit: (
    ticker: string,
    quantity: number,
    costBasis: number,
    date: string,
    depositSource: string,
    tag?: TransactionTag,
    costBasisCurrency?: Currency
  ) => Promise<void>;
  /** Handle income transaction (dividends, staking, etc.) */
  handleIncome: (
    ticker: string,
    quantity: number,
    date: string,
    incomeType: 'dividend' | 'staking' | 'airdrop' | 'interest',
    incomeSource: string,
    tag?: TransactionTag,
    costBasis?: number,
    costBasisCurrency?: Currency
  ) => Promise<void>;
  /** Handle withdrawal transaction */
  handleWithdrawal: (
    asset: Asset,
    quantity: number,
    date: string,
    withdrawalDestination: string,
    tag?: TransactionTag
  ) => void;
  /** Handle buy transaction with validation */
  handleBuyWithValidation: (
    sourceTicker: string,
    sourceQuantity: number,
    destinationTicker: string,
    destinationQuantity: number,
    date: string,
    tag?: TransactionTag
  ) => Promise<void>;
  /** Handle portfolio transfer */
  handlePortfolioTransfer: (
    asset: Asset,
    quantity: number,
    date: string,
    destinationPortfolioId: string,
    tag?: TransactionTag
  ) => void;
}

/**
 * Hook for all transaction handlers
 */
export const useTransactionHandlers = ({
  assets,
  portfolios,
  activePortfolioId,
  activePortfolio,
  updateActivePortfolio,
  setPortfolios,
  displayCurrency,
  exchangeRates,
  handleAddAsset,
}: UseTransactionHandlersProps): UseTransactionHandlersResult => {
  /**
   * Handle DEPOSIT transaction
   */
  const handleDeposit = useCallback(
    async (
      ticker: string,
      quantity: number,
      costBasis: number,
      date: string,
      depositSource: string,
      tag?: TransactionTag,
      costBasisCurrency?: Currency
    ) => {
      try {
        const [year, month, day] = date.split('-').map(Number);
        const localDate = new Date(year, month - 1, day);

        let historicalRates: Record<Currency, number> | undefined;
        try {
          historicalRates = await fetchHistoricalExchangeRatesForDate(localDate);
        } catch (error) {
          console.warn(`⚠️ Failed to fetch historical FX rates for ${date}:`, error);
        }

        const assetCurrency = detectAssetNativeCurrency(ticker);
        const purchaseCurrency = costBasisCurrency || assetCurrency;

        const depositTx: Transaction = {
          id: Math.random().toString(36).substr(2, 9),
          type: 'DEPOSIT',
          quantity,
          pricePerCoin: costBasis / quantity,
          date,
          totalCost: costBasis,
          tag: tag || 'DCA',
          createdAt: new Date().toISOString(),
          purchaseCurrency: purchaseCurrency,
          exchangeRateAtPurchase: historicalRates,
          costBasis,
          depositSource,
        };

        const existingAsset = assets.find(
          (a) => a.ticker.toUpperCase() === ticker.toUpperCase()
        );

        if (existingAsset) {
          updateActivePortfolio((portfolio) => ({
            ...portfolio,
            assets: portfolio.assets.map((a) =>
              a.id === existingAsset.id
                ? {
                    ...a,
                    quantity: a.quantity + quantity,
                    transactions: [...a.transactions, depositTx],
                    totalCostBasis: a.totalCostBasis + costBasis,
                    avgBuyPrice: (a.totalCostBasis + costBasis) / (a.quantity + quantity),
                    lastUpdated: new Date().toISOString(),
                  }
                : a
            ),
          }));

          console.log(`✅ Deposited ${quantity} ${ticker} to existing position`);
        } else {
          await handleAddAsset(ticker, quantity, costBasis / quantity, date, assetCurrency, tag || 'DCA');

          updateActivePortfolio((portfolio) => {
            const updatedPortfolio = {
              ...portfolio,
              assets: portfolio.assets.map((a) => {
                if (a.ticker.toUpperCase() === ticker.toUpperCase()) {
                  const sortedTxs = [...a.transactions].sort(
                    (a, b) =>
                      new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
                  );

                  const updatedTxs = a.transactions.map((tx): Transaction => {
                    if (tx.id === sortedTxs[0]?.id) {
                      return {
                        ...tx,
                        type: 'DEPOSIT' as const,
                        depositSource,
                        costBasis,
                        purchaseCurrency: purchaseCurrency,
                        exchangeRateAtPurchase: historicalRates,
                      };
                    }
                    return tx;
                  });

                  return { ...a, transactions: updatedTxs };
                }
                return a;
              }),
            };
            return updatedPortfolio;
          });

          console.log(`✅ Created new position with ${quantity} ${ticker} deposit`);
        }
      } catch (error) {
        console.error('❌ Deposit transaction failed:', error);
        throw error;
      }
    },
    [assets, updateActivePortfolio, handleAddAsset]
  );

  /**
   * Handle INCOME transaction
   */
  const handleIncome = useCallback(
    async (
      ticker: string,
      quantity: number,
      date: string,
      incomeType: 'dividend' | 'staking' | 'airdrop' | 'interest',
      incomeSource: string,
      tag?: TransactionTag,
      costBasis?: number,
      costBasisCurrency?: Currency
    ) => {
      try {
        const [year, month, day] = date.split('-').map(Number);
        const localDate = new Date(year, month - 1, day);

        let historicalRates: Record<Currency, number> | undefined;
        try {
          historicalRates = await fetchHistoricalExchangeRatesForDate(localDate);
        } catch (error) {
          console.warn(`⚠️ Failed to fetch historical FX rates for ${date}:`, error);
        }

        const assetCurrency = detectAssetNativeCurrency(ticker);
        const purchaseCurrency = costBasisCurrency || assetCurrency;
        const finalCostBasis = costBasis ?? 0;
        const pricePerUnit = quantity > 0 ? finalCostBasis / quantity : 0;

        const incomeTx: Transaction = {
          id: Math.random().toString(36).substr(2, 9),
          type: 'INCOME',
          quantity,
          pricePerCoin: pricePerUnit,
          date,
          totalCost: finalCostBasis,
          tag: tag || 'Research',
          createdAt: new Date().toISOString(),
          purchaseCurrency: purchaseCurrency,
          exchangeRateAtPurchase: historicalRates,
          incomeType,
          incomeSource,
          costBasis: finalCostBasis,
        };

        const existingAsset = assets.find(
          (a) => a.ticker.toUpperCase() === ticker.toUpperCase()
        );

        if (existingAsset) {
          const newTotalCostBasis = existingAsset.totalCostBasis + finalCostBasis;
          const newQuantity = existingAsset.quantity + quantity;

          updateActivePortfolio((portfolio) => ({
            ...portfolio,
            assets: portfolio.assets.map((a) =>
              a.id === existingAsset.id
                ? {
                    ...a,
                    quantity: newQuantity,
                    totalCostBasis: newTotalCostBasis,
                    transactions: [...a.transactions, incomeTx],
                    avgBuyPrice: newQuantity > 0 ? newTotalCostBasis / newQuantity : 0,
                    lastUpdated: new Date().toISOString(),
                  }
                : a
            ),
          }));

          console.log(
            `✅ Received ${quantity} ${ticker} as ${incomeType} income (cost basis: ${
              finalCostBasis > 0 ? `$${finalCostBasis}` : '$0'
            })`
          );
        } else {
          await handleAddAsset(ticker, quantity, finalCostBasis, date, assetCurrency, tag || 'Research');

          updateActivePortfolio((portfolio) => ({
            ...portfolio,
            assets: portfolio.assets.map((a) => {
              if (a.ticker.toUpperCase() === ticker.toUpperCase()) {
                return {
                  ...a,
                  transactions: a.transactions.map((tx) =>
                    tx.createdAt === incomeTx.createdAt
                      ? { ...tx, type: 'INCOME', incomeType, incomeSource }
                      : tx
                  ),
                };
              }
              return a;
            }),
          }));

          console.log(`✅ Created new position with ${quantity} ${ticker} income (${incomeType})`);
        }
      } catch (error) {
        console.error('❌ Income transaction failed:', error);
        throw error;
      }
    },
    [assets, updateActivePortfolio, handleAddAsset]
  );

  /**
   * Handle WITHDRAWAL transaction
   */
  const handleWithdrawal = useCallback(
    (
      asset: Asset,
      quantity: number,
      date: string,
      withdrawalDestination: string,
      tag?: TransactionTag
    ) => {
      try {
        const sortedAcquisitionTxs = [...asset.transactions]
          .filter((tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let remainingToWithdraw = quantity;
        let costBasisWithdrawn = 0;

        for (const tx of sortedAcquisitionTxs) {
          if (remainingToWithdraw <= 0) break;
          const qtyFromThisTx = Math.min(remainingToWithdraw, tx.quantity);
          const costFromThisTx = (qtyFromThisTx / tx.quantity) * tx.totalCost;
          remainingToWithdraw -= qtyFromThisTx;
          costBasisWithdrawn += costFromThisTx;
        }

        const avgPriceWithdrawn = quantity > 0 ? costBasisWithdrawn / quantity : 0;

        const withdrawalTx: Transaction = {
          id: Math.random().toString(36).substr(2, 9),
          type: 'WITHDRAWAL',
          quantity,
          pricePerCoin: avgPriceWithdrawn,
          date,
          totalCost: costBasisWithdrawn,
          tag: tag || 'Profit-Taking',
          createdAt: new Date().toISOString(),
          withdrawalDestination,
        };

        const updatedTxs = [...asset.transactions, withdrawalTx];

        const acquisitions = updatedTxs.filter(
          (tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
        );
        const disposals = updatedTxs.filter(
          (tx) => tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
        );

        const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
        const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
        const newQty = totalAcquired - totalDisposed;

        const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
        const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
        const newCost = totalCostAcquired - totalCostDisposed;

        const isFullWithdrawal = newQty === 0;

        if (isFullWithdrawal) {
          updateActivePortfolio((portfolio) => ({
            ...portfolio,
            assets: portfolio.assets.filter((a) => a.id !== asset.id),
          }));
          console.log(
            `✅ Withdrew all ${asset.ticker} (full withdrawal, cost basis: $${costBasisWithdrawn.toFixed(2)})`
          );
        } else {
          updateActivePortfolio((portfolio) => ({
            ...portfolio,
            assets: portfolio.assets.map((a) =>
              a.id === asset.id
                ? {
                    ...a,
                    quantity: newQty,
                    transactions: updatedTxs,
                    totalCostBasis: newCost,
                    avgBuyPrice: newQty > 0 ? newCost / newQty : 0,
                    lastUpdated: new Date().toISOString(),
                  }
                : a
            ),
          }));
          console.log(
            `✅ Withdrew ${quantity} ${asset.ticker} (partial withdrawal, cost basis: $${costBasisWithdrawn.toFixed(2)})`
          );
        }
      } catch (error) {
        console.error('❌ Withdrawal transaction failed:', error);
        throw error;
      }
    },
    [updateActivePortfolio]
  );

  /**
   * Handle BUY transaction with validation
   */
  const handleBuyWithValidation = useCallback(
    async (
      sourceTicker: string,
      sourceQuantity: number,
      destinationTicker: string,
      destinationQuantity: number,
      date: string,
      tag?: TransactionTag
    ) => {
      try {
        const validation = validateBuyTransaction(
          assets,
          sourceTicker,
          sourceQuantity,
          destinationTicker,
          date
        );

        if (!validation.valid) {
          const proceed = window.confirm(
            `⚠️ Validation Warning\n\n${validation.error}\n\nDo you want to proceed anyway?`
          );
          if (!proceed) return;
        }

        const [year, month, day] = date.split('-').map(Number);
        const localDate = new Date(year, month - 1, day);

        let historicalRates: Record<Currency, number> | undefined;
        try {
          historicalRates = await fetchHistoricalExchangeRatesForDate(localDate);
        } catch (error) {
          console.warn(`⚠️ Failed to fetch historical FX rates for ${date}:`, error);
        }

        const sourceCurrency = detectAssetNativeCurrency(sourceTicker);
        const destCurrency = detectAssetNativeCurrency(destinationTicker);

        const transactionPairId = Math.random().toString(36).substr(2, 9);
        const buyTxId = Math.random().toString(36).substr(2, 9);
        const sellTxId = Math.random().toString(36).substr(2, 9);

        const sourceAsset = assets.find(
          (a) => a.ticker.toUpperCase() === sourceTicker.toUpperCase()
        );

        let costBasisSpentUSD = sourceQuantity;
        let costBasisFIFOinUSD = 0;
        let sourceMarketPriceOnDate = 1.0;
        let pnlResult: ReturnType<typeof calculateRealizedPnL> | null = null;

        if (sourceAsset) {
          if (sourceAsset.ticker.toUpperCase() !== sourceTicker.toUpperCase()) {
            throw new Error(`Asset mismatch: expected ${sourceTicker} but got ${sourceAsset.ticker}`);
          }

          console.log(`🔍 Source asset: ${sourceAsset.ticker}, currentPrice: $${sourceAsset.currentPrice}`);

          sourceMarketPriceOnDate = getHistoricalPrice(sourceAsset, date);
          costBasisSpentUSD = sourceQuantity * sourceMarketPriceOnDate;

          console.log(
            `💰 BUY cost basis: ${sourceQuantity} ${sourceTicker} @ $${sourceMarketPriceOnDate} = $${costBasisSpentUSD} USD`
          );

          const sortedAcquisitionTxs = [...sourceAsset.transactions]
            .filter((tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          let remainingToSpend = sourceQuantity;

          for (const tx of sortedAcquisitionTxs) {
            if (remainingToSpend <= 0) break;
            const qtyFromThisTx = Math.min(remainingToSpend, tx.quantity);
            const costFromThisTxOriginal = (qtyFromThisTx / tx.quantity) * tx.totalCost;

            let costFromThisTxUSD = costFromThisTxOriginal;
            if (tx.exchangeRateAtPurchase && tx.purchaseCurrency && tx.purchaseCurrency !== 'USD') {
              costFromThisTxUSD = convertCurrencySync(
                costFromThisTxOriginal,
                tx.purchaseCurrency,
                'USD',
                tx.exchangeRateAtPurchase
              );
            }

            remainingToSpend -= qtyFromThisTx;
            costBasisFIFOinUSD += costFromThisTxUSD;
          }

          console.log(
            `📊 SELL realized P&L: Proceeds=$${costBasisSpentUSD} - FIFO Cost=$${costBasisFIFOinUSD} = $${
              costBasisSpentUSD - costBasisFIFOinUSD
            }`
          );
        }

        let closedPositionsFromSell: any[] = [];
        if (sourceAsset) {
          const actualProceedsCurrency = destCurrency;
          const salePriceInProceedsCurrency = sourceMarketPriceOnDate;

          // Only calculate realized P&L for non-cash assets
          // Spending cash (CHF, USD, etc.) to buy assets is NOT a taxable event
          if (!isCashAsset(sourceTicker)) {
            pnlResult = calculateRealizedPnL(
              sourceAsset,
              sourceQuantity,
              salePriceInProceedsCurrency,
              actualProceedsCurrency,
              date,
              displayCurrency,
              historicalRates || exchangeRates,
              tag,
              sellTxId,
              undefined
            );
            closedPositionsFromSell = pnlResult.closedPositions;
            console.log(
              `📊 Created ${closedPositionsFromSell.length} closed positions for BUY transaction (proceeds in ${actualProceedsCurrency})`
            );
          } else {
            console.log(
              `ℹ️ No P&L calculated for cash asset ${sourceTicker} - spending cash is not a taxable event`
            );
          }
        }

        const isDestinationCash = isCashAsset(destinationTicker);
        const isDestinationCrypto = !isDestinationCash && !destinationTicker.includes('.');

        let sourceValueInUSD = costBasisSpentUSD;
        if (sourceAsset && sourceCurrency !== 'USD') {
          sourceValueInUSD = convertCurrencySync(
            sourceQuantity * sourceMarketPriceOnDate,
            sourceCurrency,
            'USD',
            historicalRates || exchangeRates
          );
        }

        let buyTxPricePerCoin: number;
        let buyTxTotalCost: number;
        let buyTxPurchaseCurrency: Currency;

        if (isDestinationCash) {
          buyTxPricePerCoin = 1.0;
          buyTxTotalCost = destinationQuantity;
          buyTxPurchaseCurrency = ['USDT', 'USDC', 'DAI'].includes(destinationTicker.toUpperCase())
            ? 'USD'
            : destCurrency;
        } else if (isDestinationCrypto) {
          buyTxPricePerCoin = destinationQuantity > 0 ? sourceValueInUSD / destinationQuantity : 0;
          buyTxTotalCost = sourceValueInUSD;
          buyTxPurchaseCurrency = 'USD';
        } else {
          buyTxPricePerCoin = destinationQuantity > 0 ? sourceQuantity / destinationQuantity : 0;
          buyTxTotalCost = sourceQuantity;
          buyTxPurchaseCurrency = sourceCurrency;
        }

        const buyTx: Transaction = {
          id: buyTxId,
          type: 'BUY',
          quantity: destinationQuantity,
          pricePerCoin: buyTxPricePerCoin,
          date,
          totalCost: buyTxTotalCost,
          tag: tag || 'DCA',
          createdAt: new Date().toISOString(),
          purchaseCurrency: buyTxPurchaseCurrency,
          exchangeRateAtPurchase: historicalRates,
          sourceTicker,
          sourceQuantity,
          linkedBuySellTransactionId: sellTxId,
          transactionPairId: transactionPairId,
        };

        if (sourceAsset) {
          const isCash = isCashAsset(sourceTicker);
          const sellPricePerCoin = isCash ? 1.0 : sourceMarketPriceOnDate;
          const sellTotalCost = isCash ? sourceQuantity * 1.0 : costBasisFIFOinUSD;
          const proceedsInSaleCurrency = sourceQuantity * sourceMarketPriceOnDate;

          const sellTx: Transaction = {
            id: sellTxId,
            type: 'SELL',
            quantity: sourceQuantity,
            pricePerCoin: sellPricePerCoin,
            date,
            totalCost: sellTotalCost,
            proceeds: proceedsInSaleCurrency,
            proceedsCurrency: destCurrency,
            tag: tag || 'DCA',
            createdAt: new Date().toISOString(),
            destinationTicker,
            destinationQuantity,
            linkedBuySellTransactionId: buyTxId,
            transactionPairId: transactionPairId,
          };

          const updatedSourceTxs = [...sourceAsset.transactions, sellTx];

          const acquisitions = updatedSourceTxs.filter(
            (tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
          );
          const disposals = updatedSourceTxs.filter(
            (tx) => tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
          );

          const totalAcquired = acquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
          const totalDisposed = disposals.reduce((sum, tx) => sum + tx.quantity, 0);
          const newSourceQty = totalAcquired - totalDisposed;

          const totalCostAcquired = acquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
          const totalCostDisposed = disposals.reduce((sum, tx) => sum + tx.totalCost, 0);
          const newSourceCost = totalCostAcquired - totalCostDisposed;

          updateActivePortfolio((portfolio) => {
            if (newSourceQty === 0) {
              return {
                ...portfolio,
                assets: portfolio.assets.filter((a) => a.id !== sourceAsset.id),
                closedPositions: [...(portfolio.closedPositions || []), ...closedPositionsFromSell],
              };
            }

            return {
              ...portfolio,
              assets: portfolio.assets.map((a) =>
                a.id === sourceAsset.id
                  ? {
                      ...a,
                      quantity: newSourceQty,
                      transactions: updatedSourceTxs,
                      totalCostBasis: newSourceCost,
                      avgBuyPrice: newSourceQty > 0 ? newSourceCost / newSourceQty : 0,
                      lastUpdated: new Date().toISOString(),
                    }
                  : a
              ),
              closedPositions: [...(portfolio.closedPositions || []), ...closedPositionsFromSell],
            };
          });
        }

        const existingDest = assets.find(
          (a) => a.ticker.toUpperCase() === destinationTicker.toUpperCase()
        );
        if (existingDest) {
          updateActivePortfolio((portfolio) => ({
            ...portfolio,
            assets: portfolio.assets.map((a) => {
              if (a.id === existingDest.id) {
                const updatedDestTxs = [...a.transactions, buyTx];

                const destAcquisitions = updatedDestTxs.filter(
                  (tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
                );
                const destDisposals = updatedDestTxs.filter(
                  (tx) => tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
                );

                const destTotalAcquired = destAcquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
                const destTotalDisposed = destDisposals.reduce((sum, tx) => sum + tx.quantity, 0);
                const newDestQty = destTotalAcquired - destTotalDisposed;

                const destTotalCostAcquired = destAcquisitions.reduce(
                  (sum, tx) => sum + tx.totalCost,
                  0
                );
                const destTotalCostDisposed = destDisposals.reduce(
                  (sum, tx) => sum + tx.totalCost,
                  0
                );
                const newDestCost = destTotalCostAcquired - destTotalCostDisposed;

                return {
                  ...a,
                  quantity: newDestQty,
                  transactions: updatedDestTxs,
                  totalCostBasis: newDestCost,
                  avgBuyPrice: newDestQty > 0 ? newDestCost / newDestQty : 0,
                  lastUpdated: new Date().toISOString(),
                };
              }
              return a;
            }),
          }));

          console.log(
            `✅ Bought ${destinationQuantity} ${destinationTicker} with ${sourceQuantity} ${sourceTicker}`
          );
        } else {
          const newDestAssetId = Math.random().toString(36).substr(2, 9);
          const newAssetCurrentPrice = isDestinationCash ? 1.0 : 0;
          const newAssetType = isDestinationCash ? 'CASH' : undefined;

          const newDestAsset: Asset = {
            id: newDestAssetId,
            ticker: destinationTicker,
            name: undefined,
            quantity: destinationQuantity,
            currentPrice: newAssetCurrentPrice,
            lastUpdated: new Date().toISOString(),
            sources: [],
            isUpdating: !isDestinationCash,
            transactions: [buyTx],
            avgBuyPrice: buyTx.pricePerCoin,
            totalCostBasis: buyTx.totalCost,
            assetType: newAssetType,
            currency: buyTxPurchaseCurrency,
          };

          updateActivePortfolio((portfolio) => ({
            ...portfolio,
            assets: [...portfolio.assets, newDestAsset],
          }));

          if (!isDestinationCash) {
            try {
              const result = await fetchCryptoPrice(destinationTicker);
              updateActivePortfolio((portfolio) => ({
                ...portfolio,
                assets: portfolio.assets.map((a) =>
                  a.id === newDestAssetId
                    ? {
                        ...a,
                        currentPrice: result.price,
                        sources: result.sources,
                        isUpdating: false,
                        name: result.name || result.symbol || a.name,
                        assetType: result.assetType || 'CRYPTO',
                        currency: result.currency || destCurrency,
                      }
                    : a
                ),
              }));

              const historyData = await fetchAssetHistory(
                destinationTicker,
                result.price,
                result.symbol,
                result.assetType
              );
              if (historyData) {
                updateActivePortfolio((portfolio) => ({
                  ...portfolio,
                  assets: portfolio.assets.map((a) =>
                    a.id === newDestAssetId ? { ...a, priceHistory: historyData } : a
                  ),
                }));
              }
            } catch (error: any) {
              updateActivePortfolio((portfolio) => ({
                ...portfolio,
                assets: portfolio.assets.map((a) =>
                  a.id === newDestAssetId
                    ? { ...a, isUpdating: false, error: error.message || 'Failed' }
                    : a
                ),
              }));
            }
          }

          console.log(
            `✅ Created new position: ${destinationQuantity} ${destinationTicker} with ${sourceQuantity} ${sourceTicker} (buyTxId: ${buyTx.id})`
          );
        }
      } catch (error) {
        console.error('❌ Buy transaction failed:', error);
        throw error;
      }
    },
    [assets, updateActivePortfolio, displayCurrency, exchangeRates]
  );

  /**
   * Handle Portfolio Transfer
   */
  const handlePortfolioTransfer = useCallback(
    (
      asset: Asset,
      quantity: number,
      date: string,
      destinationPortfolioId: string,
      tag?: TransactionTag
    ) => {
      try {
        const transferTxId = Math.random().toString(36).substr(2, 9);
        const destinationPortfolio = portfolios.find((p) => p.id === destinationPortfolioId);

        if (!destinationPortfolio) {
          throw new Error('Destination portfolio not found');
        }

        const sortedAcquisitionTxs = [...asset.transactions]
          .filter((tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let remainingToTransfer = quantity;
        let totalCostBasisTransferred = 0;
        const transferredTxCopies: Transaction[] = [];

        for (const tx of sortedAcquisitionTxs) {
          if (remainingToTransfer <= 0) break;

          const qtyFromThisTx = Math.min(remainingToTransfer, tx.quantity);
          const costFromThisTx = (qtyFromThisTx / tx.quantity) * tx.totalCost;

          transferredTxCopies.push({
            ...tx,
            id: Math.random().toString(36).substr(2, 9),
            quantity: qtyFromThisTx,
            totalCost: costFromThisTx,
            pricePerCoin: tx.pricePerCoin,
            transferredFrom: activePortfolioId,
            tag: tag || tx.tag,
          });

          remainingToTransfer -= qtyFromThisTx;
          totalCostBasisTransferred += costFromThisTx;
        }

        const avgPriceTransferred = quantity > 0 ? totalCostBasisTransferred / quantity : 0;

        const transferTx: Transaction = {
          id: transferTxId,
          type: 'TRANSFER',
          quantity,
          pricePerCoin: avgPriceTransferred,
          date,
          totalCost: totalCostBasisTransferred,
          tag: tag || 'Strategic',
          createdAt: new Date().toISOString(),
          destinationPortfolioId: destinationPortfolioId,
          linkedTransactionId: transferTxId,
        };

        const updatedSourceTxs = [...asset.transactions, transferTx];

        const sourceAcquisitions = updatedSourceTxs.filter(
          (tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
        );
        const sourceDisposals = updatedSourceTxs.filter(
          (tx) => tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
        );

        const totalAcquired = sourceAcquisitions.reduce((sum, tx) => sum + tx.quantity, 0);
        const totalDisposed = sourceDisposals.reduce((sum, tx) => sum + tx.quantity, 0);
        const newSourceQty = totalAcquired - totalDisposed;

        const totalCostAcquired = sourceAcquisitions.reduce((sum, tx) => sum + tx.totalCost, 0);
        const totalCostDisposed = sourceDisposals.reduce((sum, tx) => sum + tx.totalCost, 0);
        const newSourceCost = totalCostAcquired - totalCostDisposed;

        updateActivePortfolio((portfolio) => {
          if (newSourceQty === 0) {
            return {
              ...portfolio,
              assets: portfolio.assets.filter((a) => a.id !== asset.id),
            };
          } else {
            return {
              ...portfolio,
              assets: portfolio.assets.map((a) =>
                a.id === asset.id
                  ? {
                      ...a,
                      quantity: newSourceQty,
                      transactions: updatedSourceTxs,
                      totalCostBasis: newSourceCost,
                      avgBuyPrice: newSourceQty > 0 ? newSourceCost / newSourceQty : 0,
                      lastUpdated: new Date().toISOString(),
                    }
                  : a
              ),
            };
          }
        });

        setPortfolios((prevPortfolios) =>
          prevPortfolios.map((p) => {
            if (p.id === destinationPortfolioId) {
              const existingAsset = p.assets.find((a) => a.ticker === asset.ticker);

              if (existingAsset) {
                const updatedDestTxs = [...existingAsset.transactions, ...transferredTxCopies];

                const destAcquisitions = updatedDestTxs.filter(
                  (tx) => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
                );
                const destDisposals = updatedDestTxs.filter(
                  (tx) => tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
                );

                const destTotalAcquired = destAcquisitions.reduce(
                  (sum, tx) => sum + tx.quantity,
                  0
                );
                const destTotalDisposed = destDisposals.reduce((sum, tx) => sum + tx.quantity, 0);
                const newDestQty = destTotalAcquired - destTotalDisposed;

                const destTotalCostAcquired = destAcquisitions.reduce(
                  (sum, tx) => sum + tx.totalCost,
                  0
                );
                const destTotalCostDisposed = destDisposals.reduce(
                  (sum, tx) => sum + tx.totalCost,
                  0
                );
                const newDestCost = destTotalCostAcquired - destTotalCostDisposed;

                return {
                  ...p,
                  assets: p.assets.map((a) =>
                    a.id === existingAsset.id
                      ? {
                          ...a,
                          quantity: newDestQty,
                          transactions: updatedDestTxs,
                          totalCostBasis: newDestCost,
                          avgBuyPrice: newDestQty > 0 ? newDestCost / newDestQty : 0,
                          lastUpdated: new Date().toISOString(),
                        }
                      : a
                  ),
                };
              } else {
                const newAsset: Asset = {
                  id: Math.random().toString(36).substr(2, 9),
                  ticker: asset.ticker,
                  name: asset.name,
                  quantity,
                  currentPrice: asset.currentPrice,
                  lastUpdated: new Date().toISOString(),
                  sources: asset.sources,
                  isUpdating: false,
                  transactions: transferredTxCopies,
                  avgBuyPrice: totalCostBasisTransferred / quantity,
                  totalCostBasis: totalCostBasisTransferred,
                  coinGeckoId: asset.coinGeckoId,
                  assetType: asset.assetType,
                  currency: asset.currency,
                };

                return {
                  ...p,
                  assets: [...p.assets, newAsset],
                };
              }
            }
            return p;
          })
        );

        console.log(`✅ Transferred ${quantity} ${asset.ticker} to ${destinationPortfolio.name}`);
        console.log(`   Cost basis transferred: ${displayCurrency} ${totalCostBasisTransferred.toFixed(2)}`);
      } catch (error) {
        console.error('❌ Portfolio transfer failed:', error);
        throw error;
      }
    },
    [portfolios, activePortfolioId, updateActivePortfolio, setPortfolios, displayCurrency]
  );

  return {
    handleDeposit,
    handleIncome,
    handleWithdrawal,
    handleBuyWithValidation,
    handlePortfolioTransfer,
  };
};
