// Rebalancing Service
// Calculates portfolio rebalancing suggestions based on target allocations

import {
  Asset,
  Currency,
  RebalancingSettings,
  AllocationDeviation,
  RebalancingTrade,
  RebalancingSuggestion,
} from '../types';
import { convertCurrencySync } from './currencyService';

// Default settings
export const DEFAULT_REBALANCING_SETTINGS: RebalancingSettings = {
  deviationThreshold: 3,    // 3% deviation threshold
  minTradeAmount: 100,      // Minimum 100 in display currency
};

/**
 * Detects the native currency of an asset based on its ticker
 * Used when asset.currency is not explicitly set
 */
const detectAssetCurrency = (ticker: string, assetType?: string): Currency => {
  // Cash/fiat assets
  if (ticker === 'USD' || ticker === 'USDT' || ticker === 'USDC' || ticker === 'DAI') return 'USD';
  if (ticker === 'CHF') return 'CHF';
  if (ticker === 'EUR') return 'EUR';
  if (ticker === 'GBP') return 'GBP';
  if (ticker === 'JPY') return 'JPY';
  if (ticker === 'CAD') return 'CAD';
  if (ticker === 'AUD') return 'AUD';

  // Swiss stocks (.SW suffix)
  if (ticker.endsWith('.SW')) return 'CHF';

  // German stocks (.DE suffix)
  if (ticker.endsWith('.DE')) return 'EUR';

  // UK stocks (.L suffix)
  if (ticker.endsWith('.L')) return 'GBP';

  // Japanese stocks (.T suffix)
  if (ticker.endsWith('.T')) return 'JPY';

  // Default: USD for US stocks and crypto
  return 'USD';
};

/**
 * Calculate the current value of an asset in the display currency
 */
const calculateAssetValueInDisplayCurrency = (
  asset: Asset,
  displayCurrency: Currency,
  exchangeRates: Record<string, number>
): number => {
  const assetCurrency = asset.currency || detectAssetCurrency(asset.ticker, asset.assetType);
  const valueInNativeCurrency = asset.quantity * asset.currentPrice;

  return convertCurrencySync(valueInNativeCurrency, assetCurrency, displayCurrency, exchangeRates);
};

/**
 * Determine the rounding precision for an asset based on its type
 * Crypto: 4-8 decimals, Stocks: 2-4 decimals, Fiat: 2 decimals
 */
const getRoundingPrecision = (ticker: string, assetType?: string): number => {
  // Fiat and stablecoins: 2 decimals
  if (['USD', 'CHF', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'USDT', 'USDC', 'DAI'].includes(ticker)) {
    return 2;
  }

  // Stocks: 2-4 decimals (most exchanges don't allow fractional shares beyond 4)
  if (ticker.includes('.') || assetType?.startsWith('STOCK') || assetType === 'ETF') {
    return 4;
  }

  // Major crypto: 6 decimals
  if (['BTC', 'ETH'].includes(ticker)) {
    return 6;
  }

  // Other crypto: 4 decimals
  return 4;
};

/**
 * Round a quantity to the appropriate precision for the asset
 */
const roundQuantity = (quantity: number, ticker: string, assetType?: string): number => {
  const precision = getRoundingPrecision(ticker, assetType);
  return Math.round(quantity * Math.pow(10, precision)) / Math.pow(10, precision);
};

/**
 * Calculate allocation deviations for all assets with target allocations
 */
export const calculateDeviations = (
  assets: Asset[],
  totalPortfolioValue: number,
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  settings: RebalancingSettings
): { deviations: AllocationDeviation[]; assetsWithoutTarget: number } => {
  const deviations: AllocationDeviation[] = [];
  let assetsWithoutTarget = 0;

  for (const asset of assets) {
    // Skip assets with zero quantity
    if (asset.quantity <= 0) continue;

    // Check if asset has a target allocation
    if (!asset.targetAllocation || asset.targetAllocation <= 0) {
      assetsWithoutTarget++;
      continue;
    }

    const currentValue = calculateAssetValueInDisplayCurrency(asset, displayCurrency, exchangeRates);
    const currentAllocation = totalPortfolioValue > 0 ? (currentValue / totalPortfolioValue) * 100 : 0;
    const targetAllocation = asset.targetAllocation;
    const deviation = currentAllocation - targetAllocation;
    const deviationAmount = (deviation / 100) * totalPortfolioValue;

    // Determine status based on threshold
    let status: 'overweight' | 'underweight' | 'on-target';
    if (Math.abs(deviation) <= settings.deviationThreshold) {
      status = 'on-target';
    } else if (deviation > 0) {
      status = 'overweight';
    } else {
      status = 'underweight';
    }

    deviations.push({
      assetId: asset.id,
      ticker: asset.ticker,
      name: asset.name || asset.ticker,
      currentValue,
      currentAllocation,
      targetAllocation,
      deviation,
      deviationAmount,
      status,
    });
  }

  // Sort by absolute deviation (largest first)
  deviations.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));

  return { deviations, assetsWithoutTarget };
};

/**
 * Generate rebalancing trades by pairing overweight sells with underweight buys
 */
export const generateTrades = (
  deviations: AllocationDeviation[],
  assets: Asset[],
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  settings: RebalancingSettings
): RebalancingTrade[] => {
  const trades: RebalancingTrade[] = [];

  // Separate overweight and underweight assets
  const overweight = deviations
    .filter(d => d.status === 'overweight')
    .sort((a, b) => b.deviationAmount - a.deviationAmount); // Largest excess first

  const underweight = deviations
    .filter(d => d.status === 'underweight')
    .sort((a, b) => a.deviationAmount - b.deviationAmount); // Largest deficit first (most negative)

  // Create a map of assets by ticker for quick lookup
  const assetMap = new Map<string, Asset>();
  for (const asset of assets) {
    assetMap.set(asset.ticker, asset);
  }

  // Clone arrays so we can modify them
  const sellQueue = overweight.map(d => ({ ...d, remainingAmount: d.deviationAmount }));
  const buyQueue = underweight.map(d => ({ ...d, remainingAmount: Math.abs(d.deviationAmount) }));

  let tradeId = 1;

  // Match sells with buys
  while (sellQueue.length > 0 && buyQueue.length > 0) {
    const seller = sellQueue[0];
    const buyer = buyQueue[0];

    // Determine trade amount (minimum of what seller has and buyer needs)
    const tradeAmount = Math.min(seller.remainingAmount, buyer.remainingAmount);

    // Skip if trade amount is below minimum
    if (tradeAmount < settings.minTradeAmount) {
      // Remove from queues if remaining amounts are too small
      if (seller.remainingAmount < settings.minTradeAmount) {
        sellQueue.shift();
      }
      if (buyer.remainingAmount < settings.minTradeAmount) {
        buyQueue.shift();
      }
      continue;
    }

    // Get asset details for quantity calculations
    const sellAsset = assetMap.get(seller.ticker);
    const buyAsset = assetMap.get(buyer.ticker);

    if (!sellAsset || !buyAsset) {
      // Asset not found, skip
      sellQueue.shift();
      buyQueue.shift();
      continue;
    }

    // Calculate quantities
    const sellAssetCurrency = sellAsset.currency || detectAssetCurrency(sellAsset.ticker, sellAsset.assetType);
    const buyAssetCurrency = buyAsset.currency || detectAssetCurrency(buyAsset.ticker, buyAsset.assetType);

    // Convert trade amount to asset's native currency, then to quantity
    const sellAmountInNative = convertCurrencySync(tradeAmount, displayCurrency, sellAssetCurrency, exchangeRates);
    const buyAmountInNative = convertCurrencySync(tradeAmount, displayCurrency, buyAssetCurrency, exchangeRates);

    const sellQuantity = sellAsset.currentPrice > 0 ? sellAmountInNative / sellAsset.currentPrice : 0;
    const buyQuantity = buyAsset.currentPrice > 0 ? buyAmountInNative / buyAsset.currentPrice : 0;

    // Round quantities appropriately
    const roundedSellQuantity = roundQuantity(sellQuantity, sellAsset.ticker, sellAsset.assetType);
    const roundedBuyQuantity = roundQuantity(buyQuantity, buyAsset.ticker, buyAsset.assetType);

    // Only create trade if quantities are meaningful
    if (roundedSellQuantity > 0 && roundedBuyQuantity > 0) {
      trades.push({
        id: `trade-${tradeId++}`,
        priority: tradeId,
        sellTicker: seller.ticker,
        sellName: seller.name,
        sellAmount: tradeAmount,
        sellQuantity: roundedSellQuantity,
        sellCurrentPrice: sellAsset.currentPrice,
        buyTicker: buyer.ticker,
        buyName: buyer.name,
        buyAmount: tradeAmount,
        buyQuantity: roundedBuyQuantity,
        buyCurrentPrice: buyAsset.currentPrice,
      });
    }

    // Update remaining amounts
    seller.remainingAmount -= tradeAmount;
    buyer.remainingAmount -= tradeAmount;

    // Remove from queues if fully matched
    if (seller.remainingAmount < settings.minTradeAmount) {
      sellQueue.shift();
    }
    if (buyer.remainingAmount < settings.minTradeAmount) {
      buyQueue.shift();
    }
  }

  return trades;
};

/**
 * Calculate projected allocations after rebalancing trades
 */
export const calculateProjectedAllocations = (
  deviations: AllocationDeviation[],
  trades: RebalancingTrade[],
  totalPortfolioValue: number
): RebalancingSuggestion['projectedAllocations'] => {
  // Start with current values
  const valueAdjustments = new Map<string, number>();

  // Calculate net adjustments from trades
  for (const trade of trades) {
    // Seller loses value
    const currentSellAdjust = valueAdjustments.get(trade.sellTicker) || 0;
    valueAdjustments.set(trade.sellTicker, currentSellAdjust - trade.sellAmount);

    // Buyer gains value
    const currentBuyAdjust = valueAdjustments.get(trade.buyTicker) || 0;
    valueAdjustments.set(trade.buyTicker, currentBuyAdjust + trade.buyAmount);
  }

  // Calculate projected allocations
  return deviations.map(d => {
    const adjustment = valueAdjustments.get(d.ticker) || 0;
    const projectedValue = d.currentValue + adjustment;
    const afterAllocation = totalPortfolioValue > 0 ? (projectedValue / totalPortfolioValue) * 100 : 0;

    return {
      ticker: d.ticker,
      name: d.name,
      beforeAllocation: d.currentAllocation,
      afterAllocation,
      targetAllocation: d.targetAllocation,
    };
  });
};

/**
 * Main function: Generate complete rebalancing suggestions
 */
export const generateRebalancingSuggestions = (
  portfolioId: string,
  assets: Asset[],
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  settings: RebalancingSettings = DEFAULT_REBALANCING_SETTINGS
): RebalancingSuggestion => {
  // Calculate total portfolio value
  let totalPortfolioValue = 0;
  for (const asset of assets) {
    if (asset.quantity > 0) {
      totalPortfolioValue += calculateAssetValueInDisplayCurrency(asset, displayCurrency, exchangeRates);
    }
  }

  // Calculate deviations
  const { deviations, assetsWithoutTarget } = calculateDeviations(
    assets,
    totalPortfolioValue,
    displayCurrency,
    exchangeRates,
    settings
  );

  // Generate trades
  const trades = generateTrades(deviations, assets, displayCurrency, exchangeRates, settings);

  // Calculate total rebalance amount
  const totalRebalanceAmount = trades.reduce((sum, t) => sum + t.sellAmount, 0);

  // Calculate projected allocations
  const projectedAllocations = calculateProjectedAllocations(deviations, trades, totalPortfolioValue);

  // Count statuses
  const overweightCount = deviations.filter(d => d.status === 'overweight').length;
  const underweightCount = deviations.filter(d => d.status === 'underweight').length;
  const onTargetCount = deviations.filter(d => d.status === 'on-target').length;

  return {
    portfolioId,
    totalPortfolioValue,
    displayCurrency,
    calculatedAt: new Date().toISOString(),
    settings,
    deviations,
    assetsWithoutTarget,
    trades,
    totalRebalanceAmount,
    overweightCount,
    underweightCount,
    onTargetCount,
    projectedAllocations,
  };
};

/**
 * Get the count of assets that need rebalancing (for badge display)
 * Returns the number of assets with deviations beyond the threshold
 */
export const getRebalancingAlertCount = (
  assets: Asset[],
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  settings: RebalancingSettings = DEFAULT_REBALANCING_SETTINGS
): number => {
  // Calculate total portfolio value
  let totalPortfolioValue = 0;
  for (const asset of assets) {
    if (asset.quantity > 0) {
      totalPortfolioValue += calculateAssetValueInDisplayCurrency(asset, displayCurrency, exchangeRates);
    }
  }

  if (totalPortfolioValue === 0) return 0;

  let count = 0;
  for (const asset of assets) {
    if (asset.quantity <= 0) continue;
    if (!asset.targetAllocation || asset.targetAllocation <= 0) continue;

    const currentValue = calculateAssetValueInDisplayCurrency(asset, displayCurrency, exchangeRates);
    const currentAllocation = (currentValue / totalPortfolioValue) * 100;
    const deviation = Math.abs(currentAllocation - asset.targetAllocation);

    if (deviation > settings.deviationThreshold) {
      count++;
    }
  }

  return count;
};

/**
 * Format currency amount for display
 */
export const formatCurrencyAmount = (amount: number, currency: Currency): string => {
  const symbols: Record<Currency, string> = {
    USD: '$',
    CHF: 'CHF ',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CAD: 'CA$',
    AUD: 'A$',
  };

  const symbol = symbols[currency] || currency + ' ';
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return amount < 0 ? `-${symbol}${formatted}` : `${symbol}${formatted}`;
};
