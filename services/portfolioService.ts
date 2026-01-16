import { Asset, Transaction, ClosedPosition, Currency, TransactionTag } from '../types';
import { convertCurrencySync } from './currencyService';

// ============================================================================
// P2: TRADING LIFECYCLE & CASH MANAGEMENT SERVICE
// ============================================================================

/**
 * Check if an asset is a cash/fiat/stablecoin position
 */
export function isCashAsset(ticker: string): boolean {
  const cashTickers = ['USD', 'USDT', 'USDC', 'DAI', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD'];
  return cashTickers.includes(ticker.toUpperCase());
}

/**
 * Calculate realized P&L from a sell transaction using FIFO cost basis
 *
 * @param asset - The asset being sold
 * @param sellQuantity - Quantity to sell
 * @param sellPricePerCoin - Sale price per unit
 * @param sellCurrency - Currency of sale proceeds
 * @param sellDate - Date of sale (ISO string)
 * @param displayCurrency - Portfolio display currency
 * @param exchangeRates - Current exchange rates
 * @param sellTag - Optional tag for the sell transaction
 * @param sellTransactionId - ID of the sell transaction
 *
 * @returns Object containing:
 *   - realizedPnL: Total P&L in display currency
 *   - realizedPnLPercent: P&L as percentage
 *   - avgCostBasis: Average cost basis per unit
 *   - closedPositions: Array of closed position records
 *   - remainingTransactions: Updated BUY transactions after FIFO consumption
 */
export function calculateRealizedPnL(
  asset: Asset,
  sellQuantity: number,
  sellPricePerCoin: number,
  sellCurrency: Currency | string, // Can be Currency or crypto ticker
  sellDate: string,
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  sellTag?: TransactionTag,
  sellTransactionId?: string,
  proceedsValueUSD?: number // P2: For crypto-to-crypto, the USD value of received crypto
): {
  realizedPnL: number;
  realizedPnLPercent: number;
  avgCostBasis: number;
  closedPositions: ClosedPosition[];
  remainingTransactions: Transaction[];
} {
  // Sort acquisition transactions by date (FIFO)
  // Include BUY, DEPOSIT, and INCOME as valid acquisition methods
  const acquisitionTransactions = [...asset.transactions]
    .filter(tx => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let remainingToSell = sellQuantity;
  let totalCostBasis = 0;
  let totalProceeds = 0;
  const closedPositions: ClosedPosition[] = [];
  const remainingTransactions: Transaction[] = [];

  for (const tx of acquisitionTransactions) {
    if (remainingToSell <= 0) {
      // This transaction wasn't touched, keep it as-is
      remainingTransactions.push(tx);
      continue;
    }

    const qtyFromThisTx = Math.min(remainingToSell, tx.quantity);
    const isPartialConsumption = qtyFromThisTx < tx.quantity;

    // Calculate cost basis for this lot
    const costBasisFromThisTx = qtyFromThisTx * tx.pricePerCoin;
    const proceedsFromThisTx = qtyFromThisTx * sellPricePerCoin;

    // Convert to display currency
    const txCurrency = tx.purchaseCurrency || asset.currency || 'USD';
    const costInDisplay = convertCurrencySync(
      costBasisFromThisTx,
      txCurrency,
      displayCurrency,
      exchangeRates
    );

    // For sell currency, check if it's a fiat Currency or crypto ticker
    let proceedsInDisplay: number;
    const sellCurrencyUpper = typeof sellCurrency === 'string' ? sellCurrency.toUpperCase() : sellCurrency;

    // P2: If proceedsValueUSD is provided (crypto-to-crypto), use it
    if (proceedsValueUSD !== undefined) {
      // For crypto-to-crypto trades, we have the actual USD value of received crypto
      // Calculate this lot's portion of total proceeds
      const lotPortion = qtyFromThisTx / sellQuantity;
      const lotProceedsUSD = proceedsValueUSD * lotPortion;

      // Convert from USD to display currency
      proceedsInDisplay = displayCurrency === 'USD'
        ? lotProceedsUSD
        : convertCurrencySync(lotProceedsUSD, 'USD', displayCurrency, exchangeRates);
    }
    // If selling to a fiat currency (CHF, USD, etc.)
    else if (['USD', 'CHF', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].includes(sellCurrencyUpper)) {
      proceedsInDisplay = convertCurrencySync(
        proceedsFromThisTx,
        sellCurrencyUpper as Currency,
        displayCurrency,
        exchangeRates
      );
    } else {
      // Selling to crypto (USDT, BTC, ETH, etc.) - proceeds are already in that crypto
      // We need to convert crypto value to display currency
      // For stablecoins, assume 1:1 with USD
      if (['USDT', 'USDC', 'DAI'].includes(sellCurrencyUpper)) {
        proceedsInDisplay = convertCurrencySync(
          proceedsFromThisTx,
          'USD',
          displayCurrency,
          exchangeRates
        );
      } else {
        // For other cryptos without USD value provided - shouldn't happen now
        console.warn(`⚠️ No USD value provided for crypto-to-crypto trade to ${sellCurrency}`);
        proceedsInDisplay = proceedsFromThisTx;
      }
    }

    totalCostBasis += costInDisplay;
    totalProceeds += proceedsInDisplay;

    // Calculate P&L for this lot
    const pnl = proceedsInDisplay - costInDisplay;
    const pnlPercent = costInDisplay > 0 ? (pnl / costInDisplay) * 100 : 0;

    // Calculate holding period
    const entryDate = new Date(tx.date);
    const exitDate = new Date(sellDate);
    const holdingDays = Math.floor(
      (exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Create closed position record
    closedPositions.push({
      id: Math.random().toString(36).substr(2, 9),
      ticker: asset.ticker,
      name: asset.name || asset.ticker,
      assetType: asset.assetType || 'CRYPTO',

      buyTransactionId: tx.id,
      sellTransactionId: sellTransactionId || Math.random().toString(36).substr(2, 9),

      entryDate: tx.date,
      entryPrice: tx.pricePerCoin,
      entryQuantity: qtyFromThisTx,
      entryCostBasis: costInDisplay,
      entryCurrency: txCurrency,
      entryTag: tx.tag,

      exitDate: sellDate,
      exitPrice: sellPricePerCoin,
      exitQuantity: qtyFromThisTx,
      exitProceeds: proceedsInDisplay,
      exitCurrency: sellCurrency.toString(),
      exitTag: sellTag,

      realizedPnL: pnl,
      realizedPnLPercent: pnlPercent,

      displayCurrency,
      closedAt: new Date().toISOString(),
      holdingPeriodDays: holdingDays
    });

    // If we only consumed part of this transaction, create a new transaction for the remainder
    if (isPartialConsumption) {
      const remainingQty = tx.quantity - qtyFromThisTx;
      remainingTransactions.push({
        ...tx,
        quantity: remainingQty,
        totalCost: remainingQty * tx.pricePerCoin
      });
    }

    remainingToSell -= qtyFromThisTx;
  }

  // Add any SELL transactions from the original asset (preserve sell history)
  const sellTransactions = asset.transactions.filter(tx => tx.type === 'SELL');
  remainingTransactions.push(...sellTransactions);

  const avgCostBasis = sellQuantity > 0 ? totalCostBasis / sellQuantity : 0;
  const realizedPnL = totalProceeds - totalCostBasis;
  const realizedPnLPercent = totalCostBasis > 0 ? (realizedPnL / totalCostBasis) * 100 : 0;

  return {
    realizedPnL,
    realizedPnLPercent,
    avgCostBasis,
    closedPositions,
    remainingTransactions
  };
}

/**
 * Create or update a cash/stablecoin position from sell proceeds
 *
 * @param assets - Current portfolio assets
 * @param proceeds - Amount of proceeds (in quantity, not value)
 * @param proceedsCurrency - Currency/ticker of proceeds (e.g., 'USD', 'USDT', 'CHF')
 * @param date - Transaction date
 * @param tag - Transaction tag
 *
 * @returns Updated cash asset (new or existing)
 */
export function createOrUpdateCashPosition(
  assets: Asset[],
  proceeds: number,
  proceedsCurrency: string,
  date: string,
  tag?: TransactionTag
): Asset {
  const cashTicker = proceedsCurrency.toUpperCase();
  const existingCash = assets.find(a => a.ticker === cashTicker);

  // P2: Stablecoins (USDT, USDC, DAI) are pegged to USD
  const assetCurrency: Currency = ['USDT', 'USDC', 'DAI'].includes(cashTicker) ? 'USD' : (proceedsCurrency as Currency);

  const newTx: Transaction = {
    id: Math.random().toString(36).substr(2, 9),
    type: 'BUY',
    quantity: proceeds,
    pricePerCoin: 1.0, // Cash/stablecoins always $1 per unit
    date,
    totalCost: proceeds,
    tag: tag || 'Profit-Taking',
    createdAt: new Date().toISOString(),
    purchaseCurrency: assetCurrency,
    exchangeRateAtPurchase: undefined
  };

  if (existingCash) {
    // Update existing cash position
    return {
      ...existingCash,
      quantity: existingCash.quantity + proceeds,
      transactions: [...existingCash.transactions, newTx],
      totalCostBasis: existingCash.totalCostBasis + proceeds,
      avgBuyPrice: 1.0,
      lastUpdated: new Date().toISOString()
    };
  } else {
    // Create new cash position
    const assetName = ['USDT', 'USDC', 'DAI'].includes(cashTicker)
      ? `${cashTicker} (Stablecoin)`
      : `${cashTicker} Cash`;

    // P2: Stablecoins (USDT, USDC, DAI) are pegged to USD, so use USD as currency
    const assetCurrency: Currency = ['USDT', 'USDC', 'DAI'].includes(cashTicker) ? 'USD' : (proceedsCurrency as Currency);

    return {
      id: Math.random().toString(36).substr(2, 9),
      ticker: cashTicker,
      name: assetName,
      quantity: proceeds,
      currentPrice: 1.0,
      lastUpdated: new Date().toISOString(),
      sources: [{ title: 'Fixed', url: '' }],
      isUpdating: false,
      transactions: [newTx],
      avgBuyPrice: 1.0,
      totalCostBasis: proceeds,
      assetType: 'CASH',
      currency: assetCurrency
    };
  }
}

/**
 * Detect the native currency of an asset based on its ticker
 * Used to determine which cash position to create for stock sells
 */
export function detectAssetNativeCurrency(ticker: string): Currency {
  const upper = ticker.toUpperCase();

  // If the ticker IS a currency, return it directly
  if (upper === 'CHF') return 'CHF';
  if (upper === 'EUR') return 'EUR';
  if (upper === 'GBP') return 'GBP';
  if (upper === 'JPY') return 'JPY';
  if (upper === 'CAD') return 'CAD';
  if (upper === 'AUD') return 'AUD';
  if (upper === 'USD') return 'USD';

  // Swiss stocks
  if (upper.endsWith('.SW')) return 'CHF';

  // London stocks
  if (upper.endsWith('.L')) return 'GBP';

  // Tokyo stocks
  if (upper.endsWith('.T')) return 'JPY';

  // Toronto stocks
  if (upper.endsWith('.TO')) return 'CAD';

  // Australian stocks
  if (upper.endsWith('.AX')) return 'AUD';

  // German/Frankfurt stocks
  if (upper.endsWith('.DE') || upper.endsWith('.F')) return 'EUR';

  // Default to USD for US stocks and crypto
  return 'USD';
}

/**
 * Get historical price of an asset on a specific date from priceHistory
 * Falls back to currentPrice if historical data unavailable
 *
 * @param asset - Asset to get price for
 * @param targetDate - Date to get price for (ISO string)
 * @returns Price on that date, or current price if not found
 */
export function getHistoricalPrice(asset: Asset, targetDate: string): number {
  if (!asset.priceHistory || asset.priceHistory.length === 0) {
    console.warn(`⚠️ No price history for ${asset.ticker}, using current price`);
    return asset.currentPrice;
  }

  const targetTime = new Date(targetDate).getTime();

  // Find the closest price snapshot to the target date
  let closestPrice = asset.currentPrice;
  let closestDiff = Infinity;

  for (const [timestamp, price] of asset.priceHistory) {
    const diff = Math.abs(timestamp - targetTime);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestPrice = price;
    }
  }

  // Log if we're using a price from a different day (more than 1 day difference)
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (closestDiff > oneDayMs) {
    console.warn(`⚠️ Historical price for ${asset.ticker} on ${targetDate} is ${closestDiff / oneDayMs} days off, using closest available`);
  }

  return closestPrice;
}
