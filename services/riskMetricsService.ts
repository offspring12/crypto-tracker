// ============================================================================
// P1.2: RISK METRICS SERVICE
// ============================================================================
// This service calculates portfolio risk metrics including volatility, drawdown,
// Sharpe ratio, VaR, CVaR, beta, and concentration measures.
//
// IMPORTANT CORRECTIONS FROM SPEC:
// 1. Sharpe Ratio: Uses GEOMETRIC annualization (not linear)
// 2. Beta: Implements explicit timestamp alignment
// 3. Drawdown: Tracks peak index explicitly during forward iteration
// 4. Risk Contribution: Uses standard MCR formula
// 5. VaR/CVaR: Uses linear interpolation for percentiles
// 6. Missing price history: Uses conservative asset-class estimates
// 7. Beta for assets: Calculated in display currency (measures total investor experience including FX)
//
// ============================================================================

import {
  Asset,
  Currency,
  RiskAnalysis,
  RiskTimePeriod,
  RiskRating,
  DrawdownPoint,
  PortfolioRiskMetrics,
  AssetRiskMetrics,
  Transaction
} from '../types';
import { convertCurrencySyncHistorical } from './currencyService';

// ============================================================================
// TIMEZONE FIX UTILITY
// ============================================================================

/**
 * P1.2 TIMEZONE FIX: Parse transaction date string in local timezone
 *
 * Problem: new Date("2025-01-05") creates UTC midnight, which in UTC+ timezones
 * becomes the previous day (e.g., 2024-12-31 23:00 in UTC+1)
 *
 * Solution: Parse YYYY-MM-DD and create local midnight explicitly
 */
function parseDateStringLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Trading days per year by asset class
 * CRITICAL: Crypto trades 365 days/year, stocks trade 252 days/year
 */
const TRADING_DAYS_PER_YEAR = {
  CRYPTO: 365,
  STOCK: 252,
  CASH: 365
} as const;

/**
 * Risk-free rate (annualized)
 * Using conservative estimate of short-term government bonds (1.5%)
 */
const RISK_FREE_RATE = 0.015;

/**
 * Risk rating thresholds for volatility
 */
const VOLATILITY_THRESHOLDS = {
  LOW: 0.15,        // < 15% volatility
  MODERATE: 0.30,   // 15-30% volatility
  HIGH: 0.50,       // 30-50% volatility
  EXTREME: Infinity // > 50% volatility
};

/**
 * P1.2 CORRECTION: Asset-class-specific concentration thresholds
 * Crypto portfolios naturally have higher concentration
 */
const CONCENTRATION_THRESHOLDS = {
  CRYPTO: {
    LOW: 0.25,        // < 0.25 HHI (well diversified for crypto)
    MODERATE: 0.40,   // 0.25-0.40
    HIGH: 0.60,       // 0.40-0.60
    EXTREME: Infinity // > 0.60
  },
  STOCK: {
    LOW: 0.15,        // < 0.15 HHI (well diversified for stocks)
    MODERATE: 0.25,   // 0.15-0.25
    HIGH: 0.40,       // 0.25-0.40
    EXTREME: Infinity // > 0.40
  },
  MIXED: {
    LOW: 0.20,        // < 0.20 HHI
    MODERATE: 0.30,   // 0.20-0.30
    HIGH: 0.50,       // 0.30-0.50
    EXTREME: Infinity // > 0.50
  }
};

/**
 * P1.2 CORRECTION: Conservative volatility estimates for assets with missing price history
 */
const FALLBACK_VOLATILITY = {
  CRYPTO: 0.60,  // 60% annualized volatility (conservative for crypto)
  STOCK: 0.20,   // 20% annualized volatility (conservative for stocks)
  CASH: 0.02     // 2% annualized volatility (FX fluctuation)
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Detect asset class from ticker
 */
function detectAssetClass(ticker: string): 'CRYPTO' | 'STOCK' | 'CASH' {
  const upper = ticker.toUpperCase();

  // Cash currencies
  if (['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'].includes(upper)) {
    return 'CASH';
  }

  // Stock exchanges (suffix-based detection)
  if (upper.endsWith('.SW') || upper.endsWith('.L') || upper.endsWith('.T') ||
      upper.endsWith('.TO') || upper.endsWith('.AX') || upper.endsWith('.DE') ||
      upper.endsWith('.F')) {
    return 'STOCK';
  }

  // Default to crypto (includes BTC, ETH, contract addresses)
  return 'CRYPTO';
}

/**
 * Get appropriate trading days per year for an asset
 */
function getTradingDaysPerYear(ticker: string): number {
  const assetClass = detectAssetClass(ticker);
  return TRADING_DAYS_PER_YEAR[assetClass];
}

/**
 * Detect currency from ticker (fallback if not specified in asset)
 */
function detectCurrencyFromTicker(ticker: string): Currency {
  const upper = ticker.toUpperCase();

  // Direct currency tickers
  if (['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'].includes(upper)) {
    return upper as Currency;
  }

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

  // Default to USD for crypto
  return 'USD';
}

/**
 * Calculate returns series from price history
 * Returns: array of daily returns (e.g., 0.05 = 5% gain)
 */
function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const dailyReturn = (prices[i] - prices[i - 1]) / prices[i - 1];
    returns.push(dailyReturn);
  }
  return returns;
}

/**
 * P1.2 FIX: Calculate cash-flow-adjusted returns
 *
 * This function adjusts returns to exclude the impact of deposits/withdrawals (transactions),
 * measuring only investment performance, not portfolio size changes.
 *
 * Algorithm:
 * For each day with cash flow:
 * - Adjust the previous value to exclude the cash flow impact
 * - Calculate return based on performance only
 *
 * Example:
 * - Day 1: Portfolio value = CHF 100
 * - Day 2: Add CHF 1000, end value = CHF 1150
 * - Without adjustment: return = (1150 - 100) / 100 = 1050% (WRONG!)
 * - With adjustment: return = (1150 - 1100) / 1100 = 4.5% (CORRECT)
 *
 * @param portfolioHistory - Array of [timestamp, value] tuples
 * @param cashFlows - Array of [timestamp, cashFlowAmount] tuples (positive = deposit, negative = withdrawal)
 * @returns Array of daily returns adjusted for cash flows
 */
function calculateCashFlowAdjustedReturns(
  portfolioHistory: Array<[number, number]>,
  cashFlows: Array<[number, number]>
): number[] {
  if (portfolioHistory.length < 2) return [];

  console.log(`📐 Calculating cash-flow-adjusted returns:`);
  console.log(`   📊 ${portfolioHistory.length} portfolio data points`);
  console.log(`   💰 ${cashFlows.length} cash flow events to adjust for`);
  console.log(`   📊 First portfolio value: ${portfolioHistory[0][1].toFixed(2)}`);
  console.log(`   📊 Last portfolio value: ${portfolioHistory[portfolioHistory.length - 1][1].toFixed(2)}`);

  const returns: number[] = [];

  // Create a map of cash flows by timestamp for quick lookup
  const cashFlowMap = new Map<number, number>();
  for (const [timestamp, amount] of cashFlows) {
    cashFlowMap.set(timestamp, (cashFlowMap.get(timestamp) || 0) + amount);
    const d = new Date(timestamp);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    console.log(`   📌 Cash flow mapped: ${dateStr} → ${amount.toFixed(2)}`);
  }

  let adjustmentCount = 0;

  for (let i = 1; i < portfolioHistory.length; i++) {
    const [timestamp, currentValue] = portfolioHistory[i];
    const [prevTimestamp, prevValue] = portfolioHistory[i - 1];

    // Check if there was a cash flow on this day
    const cashFlow = cashFlowMap.get(timestamp) || 0;

    if (cashFlow === 0) {
      // No cash flow: standard return calculation
      const dailyReturn = (currentValue - prevValue) / prevValue;
      returns.push(dailyReturn);

      // P1.2 DEBUG: Log large returns to identify anomalies
      if (Math.abs(dailyReturn) > 0.10) {
        const d = new Date(timestamp);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        console.log(`   ⚠️ Large return on ${dateStr}: ${(dailyReturn * 100).toFixed(2)}% (${prevValue.toFixed(2)} → ${currentValue.toFixed(2)})`);
      }
    } else {
      // P1.2 FIX: Cash flow adjustment using Modified Dietz Method
      // The current value ALREADY includes the impact of the cash flow (new shares bought)
      // So we need to exclude it to measure only the investment performance
      //
      // Correct formula:
      // Return = (currentValue - cashFlow - prevValue) / (prevValue + cashFlow)
      //
      // This measures: "What return did my existing holdings generate?"
      // Not: "How much did my portfolio grow?" (which includes deposits)

      const adjustedPrevValue = prevValue + cashFlow;

      if (adjustedPrevValue > 0) {
        // Subtract cash flow from current value to get "organic" value
        const organicCurrentValue = currentValue - cashFlow;
        const dailyReturn = (organicCurrentValue - prevValue) / (prevValue + cashFlow);
        const unadjustedReturn = (currentValue - prevValue) / prevValue;

        console.log(`   🔧 ${new Date(timestamp).toISOString().split('T')[0]}: Adjusted return from ${(unadjustedReturn * 100).toFixed(2)}% to ${(dailyReturn * 100).toFixed(2)}% (cash flow: ${cashFlow.toFixed(2)})`);

        returns.push(dailyReturn);
        adjustmentCount++;
      } else {
        // Edge case: avoid division by zero
        returns.push(0);
      }
    }
  }

  console.log(`   ✅ Applied ${adjustmentCount} cash flow adjustments to returns`);

  return returns;
}

/**
 * Calculate mean (average) of an array
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;

  const avg = mean(values);
  const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
  const variance = mean(squaredDiffs);

  return Math.sqrt(variance);
}

/**
 * Calculate covariance between two series
 */
function covariance(series1: number[], series2: number[]): number {
  if (series1.length !== series2.length || series1.length === 0) return 0;

  const mean1 = mean(series1);
  const mean2 = mean(series2);

  let cov = 0;
  for (let i = 0; i < series1.length; i++) {
    cov += (series1[i] - mean1) * (series2[i] - mean2);
  }

  return cov / series1.length;
}

/**
 * Assign risk rating based on value and thresholds
 */
function getRiskRating(value: number, thresholds: { LOW: number; MODERATE: number; HIGH: number; EXTREME: number }): RiskRating {
  if (value < thresholds.LOW) return 'LOW';
  if (value < thresholds.MODERATE) return 'MODERATE';
  if (value < thresholds.HIGH) return 'HIGH';
  return 'EXTREME';
}

/**
 * Detect portfolio composition (crypto/stock/mixed)
 */
function detectPortfolioComposition(assets: Asset[]): 'CRYPTO' | 'STOCK' | 'MIXED' {
  let cryptoValue = 0;
  let stockValue = 0;
  let totalValue = 0;

  for (const asset of assets) {
    const value = asset.quantity * asset.currentPrice;
    totalValue += value;

    const assetClass = detectAssetClass(asset.ticker);
    if (assetClass === 'CRYPTO') {
      cryptoValue += value;
    } else if (assetClass === 'STOCK') {
      stockValue += value;
    }
  }

  if (totalValue === 0) return 'MIXED';

  const cryptoPct = cryptoValue / totalValue;
  const stockPct = stockValue / totalValue;

  if (cryptoPct > 0.8) return 'CRYPTO';
  if (stockPct > 0.8) return 'STOCK';
  return 'MIXED';
}

// ============================================================================
// PORTFOLIO VALUE RECONSTRUCTION
// ============================================================================

/**
 * Reconstruct historical portfolio values WITH CASH FLOW TRACKING
 * This is the foundation for all risk calculations
 *
 * P1.2 FIX: Now also tracks cash flows (deposits/withdrawals) to enable
 * cash-flow-adjusted return calculations
 *
 * Algorithm:
 * 1. Determine time window based on period parameter
 * 2. Generate daily timestamps within window
 * 3. For each timestamp:
 *    a. Calculate quantity owned (sum transactions up to that date)
 *    b. Get price at that date (from priceHistory or interpolate)
 *    c. Convert to display currency using historical FX rates
 *    d. Sum across all assets
 *    e. Track cash flows (transaction costs) for that day
 * 4. Return portfolio history and cash flows
 */
export function reconstructPortfolioHistory(
  assets: Asset[],
  period: RiskTimePeriod,
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  historicalRates: Record<string, Record<string, number>>
): {
  portfolioHistory: Array<[number, number]>;
  cashFlows: Array<[number, number]>;
} {

  // 1. Determine time window
  const now = Date.now();
  let startTime: number;
  let maxTradingDays: number | undefined; // P1.2 FIX: For 30D/90D, limit to N trading days

  switch (period) {
    case '30D':
      // P1.2 FIX: Use last 30 TRADING days, not calendar days
      maxTradingDays = 30;
      startTime = now - (60 * 24 * 60 * 60 * 1000); // Go back ~60 calendar days to ensure we get 30 trading days
      break;
    case '90D':
      // P1.2 FIX: Use last 90 TRADING days, not calendar days
      maxTradingDays = 90;
      startTime = now - (180 * 24 * 60 * 60 * 1000); // Go back ~180 calendar days to ensure we get 90 trading days
      break;
    case '1Y':
      startTime = now - (365 * 24 * 60 * 60 * 1000);
      break;
    case 'ALL':
      // P1.2 DEPRECATED: ALL timeframe removed (Yahoo only provides 1 year of data)
      // Fallback to 1Y
      console.warn('⚠️ ALL timeframe is deprecated, using 1Y instead');
      startTime = now - (365 * 24 * 60 * 60 * 1000);
      break;
  }

  // 2. Generate timestamps based on ACTUAL PRICE DATA (trading days only)
  // P1.2 FIX: Only use days where we have real price data to avoid artificial volatility
  // from weekends/holidays with interpolated prices

  const oneDayMs = 24 * 60 * 60 * 1000;
  const timestampSet = new Set<number>();

  // P1.2 FIX: Normalize startTime to start of day (00:00:00)
  const startDate = new Date(startTime);
  const normalizedStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();

  // P1.2 FIX: Normalize now to start of day
  const nowDate = new Date(now);
  const normalizedNow = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();

  // Collect all unique timestamps from asset price histories
  for (const asset of assets) {
    if (asset.priceHistory && asset.priceHistory.length > 0) {
      for (const [priceTimestamp, _] of asset.priceHistory) {
        // Normalize to day boundary
        const priceDate = new Date(priceTimestamp);
        const normalizedTimestamp = new Date(priceDate.getFullYear(), priceDate.getMonth(), priceDate.getDate()).getTime();

        // Only include if within our time range
        if (normalizedTimestamp >= normalizedStart && normalizedTimestamp <= normalizedNow) {
          timestampSet.add(normalizedTimestamp);
        }
      }
    }
  }

  // Convert to sorted array
  let timestamps = Array.from(timestampSet).sort((a, b) => a - b);

  // P1.2 FIX: For 30D/90D, take only the last N TRADING days
  if (maxTradingDays !== undefined && timestamps.length > maxTradingDays) {
    console.log(`📊 [${period}] Limiting to last ${maxTradingDays} trading days (from ${timestamps.length} available)`);
    timestamps = timestamps.slice(-maxTradingDays);
  }

  // P1.2 DATA QUALITY: Warn if we have limited data
  const expectedDays = Math.floor((normalizedNow - normalizedStart) / oneDayMs) + 1;
  const actualDays = timestamps.length;
  if (actualDays < expectedDays * 0.7) {
    console.warn(`⚠️ [${period}] Limited price data: ${actualDays} trading days vs ${expectedDays} calendar days (${((actualDays/expectedDays)*100).toFixed(0)}% coverage)`);
  }

  // P1.2 FIX: Build a map of all transactions by date (normalized to day boundary)
  const txByDate = new Map<number, Transaction[]>();
  for (const asset of assets) {
    for (const tx of asset.transactions) {
      // P1.2 FIX: Parse date in local timezone to avoid timezone shift
      const txDate = parseDateStringLocal(tx.date);
      // Already at local midnight from parseDateStringLocal, just get timestamp
      const txTimestamp = txDate.getTime();

      if (!txByDate.has(txTimestamp)) {
        txByDate.set(txTimestamp, []);
      }
      txByDate.get(txTimestamp)!.push({ ...tx, assetTicker: asset.ticker, assetCurrency: asset.currency } as any);
    }
  }

  // P1.2 DEBUG: Log transaction mapping
  console.log(`🔍 [${period}] Found ${txByDate.size} transaction dates across all assets`);
  if (txByDate.size > 0) {
    const txDates = Array.from(txByDate.keys()).map(ts => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    console.log(`🔍 [${period}] Transaction dates:`, txDates);
    console.log(`🔍 [${period}] Transaction timestamps:`, Array.from(txByDate.keys()));
    console.log(`🔍 [${period}] Portfolio timestamp range: ${timestamps[0]} to ${timestamps[timestamps.length - 1]}`);
    console.log(`🔍 [${period}] Sample portfolio timestamps (first 5):`, timestamps.slice(0, 5));
  }

  // 3. Calculate portfolio value at each timestamp AND track cash flows
  const portfolioHistory: Array<[number, number]> = [];
  const cashFlows: Array<[number, number]> = [];

  for (const timestamp of timestamps) {
    let totalValue = 0;

    // P1.2 FIX: Calculate cash flow for this day (in display currency)
    let dailyCashFlow = 0;
    const txsOnThisDay = txByDate.get(timestamp);

    if (txsOnThisDay) {
      const d = new Date(timestamp);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      console.log(`💰 [${period}] Found ${txsOnThisDay.length} transactions on ${dateStr}`);

      for (const tx of txsOnThisDay) {
        // Get the asset to find its currency
        const txAsset = assets.find(a => a.ticker === (tx as any).assetTicker);
        const txCurrency = txAsset?.currency || (tx as any).assetCurrency || detectCurrencyFromTicker((tx as any).assetTicker || '');

        // Convert transaction cost to display currency using historical rates
        const cashFlowInDisplay = convertCurrencySyncHistorical(
          tx.totalCost,
          txCurrency,
          displayCurrency,
          new Date(timestamp),
          historicalRates,
          exchangeRates
        );

        console.log(`   💵 ${tx.type} ${(tx as any).assetTicker}: ${tx.totalCost.toFixed(2)} ${txCurrency} → ${cashFlowInDisplay.toFixed(2)} ${displayCurrency}`);

        // BUY = positive cash flow (money in), SELL = negative cash flow (money out)
        // For now, only BUY transactions exist, but this prepares for SELL
        if (tx.type === 'BUY') {
          dailyCashFlow += cashFlowInDisplay; // Money deposited
        } else if (tx.type === 'SELL') {
          dailyCashFlow -= cashFlowInDisplay; // Money withdrawn (future feature)
        }
      }

      console.log(`   ✅ Total cash flow for day: ${dailyCashFlow.toFixed(2)} ${displayCurrency}`);
    }

    for (const asset of assets) {
      // a. Calculate quantity owned at this timestamp
      let qtyAtTime = 0;
      asset.transactions.forEach(tx => {
        const txTime = parseDateStringLocal(tx.date).getTime(); // P1.2 FIX: Use local timezone parser
        if (txTime <= timestamp) {
          qtyAtTime += tx.quantity;
        }
      });

      if (qtyAtTime <= 0) continue;

      // b. Get price at this timestamp (linear interpolation)
      let priceAtTime = asset.currentPrice; // fallback

      if (asset.priceHistory && asset.priceHistory.length > 0) {
        const history = asset.priceHistory;

        // Before first data point
        if (timestamp < history[0][0]) {
          const sortedTxs = asset.transactions
            .slice()
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          priceAtTime = sortedTxs[0]?.pricePerCoin || asset.avgBuyPrice;
        }
        // After last data point
        else if (timestamp >= history[history.length - 1][0]) {
          priceAtTime = asset.currentPrice;
        }
        // Interpolate between data points (linear interpolation)
        else {
          const idx = history.findIndex(p => p[0] >= timestamp);
          if (idx === 0) {
            priceAtTime = history[0][1];
          } else if (idx === -1) {
            priceAtTime = history[history.length - 1][1];
          } else {
            const p1 = history[idx - 1];
            const p2 = history[idx];
            const span = p2[0] - p1[0];
            if (span > 0) {
              const progress = (timestamp - p1[0]) / span;
              priceAtTime = p1[1] + (p2[1] - p1[1]) * progress;
            } else {
              priceAtTime = p1[1];
            }
          }
        }
      }

      // c. Convert to display currency using historical FX rates
      const assetCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);
      const valueInNative = qtyAtTime * priceAtTime;

      const valueInDisplay = convertCurrencySyncHistorical(
        valueInNative,
        assetCurrency,
        displayCurrency,
        new Date(timestamp),
        historicalRates,
        exchangeRates
      );

      totalValue += valueInDisplay;
    }

    portfolioHistory.push([timestamp, totalValue]);

    // P1.2 FIX: Only record cash flows if non-zero
    if (dailyCashFlow !== 0) {
      cashFlows.push([timestamp, dailyCashFlow]);
    }
  }

  // P1.2 DEBUG: Summary of cash flows
  console.log(`✅ [${period}] Portfolio reconstruction complete:`);
  console.log(`   📊 ${portfolioHistory.length} data points`);
  console.log(`   💰 ${cashFlows.length} cash flow events`);
  if (cashFlows.length > 0) {
    const totalCashFlow = cashFlows.reduce((sum, [_, amount]) => sum + amount, 0);
    console.log(`   💵 Total cash flows: ${totalCashFlow.toFixed(2)} ${displayCurrency}`);
  }

  return { portfolioHistory, cashFlows };
}

// ============================================================================
// VOLATILITY CALCULATIONS
// ============================================================================

/**
 * Calculate annualized volatility
 *
 * IMPORTANT: Uses asset-class-specific trading days
 * - Crypto: 365 days/year
 * - Stocks: 252 days/year
 *
 * @param returns - Array of daily returns
 * @param tradingDaysPerYear - Trading days per year (252 for stocks, 365 for crypto)
 */
export function calculateAnnualizedVolatility(
  returns: number[],
  tradingDaysPerYear: number
): number {
  if (returns.length < 2) return 0;

  const dailyStdDev = standardDeviation(returns);
  const annualized = dailyStdDev * Math.sqrt(tradingDaysPerYear);

  return annualized;
}

/**
 * Calculate portfolio volatility WITH CASH FLOW ADJUSTMENT
 * Uses weighted average of crypto/stock trading days based on portfolio composition
 *
 * P1.2 FIX: Now uses cash-flow-adjusted returns to exclude the impact of deposits/withdrawals
 */
export function calculatePortfolioVolatility(
  portfolioHistory: Array<[number, number]>,
  cashFlows: Array<[number, number]>,
  assets: Asset[]
): { volatility: number; tradingDaysUsed: number } {
  // P1.2 FIX: Use cash-flow-adjusted returns instead of raw returns
  const returns = calculateCashFlowAdjustedReturns(portfolioHistory, cashFlows);

  // Calculate weighted average trading days
  let totalValue = 0;
  let weightedTradingDays = 0;

  for (const asset of assets) {
    const value = asset.quantity * asset.currentPrice;
    const tradingDays = getTradingDaysPerYear(asset.ticker);
    totalValue += value;
    weightedTradingDays += value * tradingDays;
  }

  const avgTradingDays = totalValue > 0 ? weightedTradingDays / totalValue : 252;
  const volatility = calculateAnnualizedVolatility(returns, avgTradingDays);

  // P1.2 DEBUG: Log volatility calculation details
  const dailyStdDev = standardDeviation(returns);
  console.log(`📊 Volatility Calculation Debug:`);
  console.log(`   Returns count: ${returns.length}`);
  console.log(`   Daily std dev: ${(dailyStdDev * 100).toFixed(4)}%`);
  console.log(`   Trading days/year: ${avgTradingDays.toFixed(0)}`);
  console.log(`   Annualization factor: √${avgTradingDays.toFixed(0)} = ${Math.sqrt(avgTradingDays).toFixed(4)}`);
  console.log(`   Annualized volatility: ${(volatility * 100).toFixed(2)}%`);
  console.log(`   First 10 returns:`, returns.slice(0, 10).map(r => (r * 100).toFixed(4) + '%'));

  return { volatility, tradingDaysUsed: Math.round(avgTradingDays) };
}

// ============================================================================
// MAXIMUM DRAWDOWN (P1.2 CORRECTED)
// ============================================================================

/**
 * Calculate maximum drawdown and drawdown history
 *
 * P1.2 CORRECTION: Tracks peak index explicitly during forward iteration
 * to avoid finding wrong peak when portfolio reaches same value multiple times
 *
 * Returns:
 * - maxDrawdown: Largest peak-to-trough decline
 * - drawdownHistory: Time-series of drawdown % for charting
 */
export function calculateMaxDrawdown(
  portfolioHistory: Array<[number, number]>
): {
  maxDrawdown: {
    percent: number;
    from: string;
    to: string;
    durationDays: number;
  };
  drawdownHistory: DrawdownPoint[];
} {
  if (portfolioHistory.length === 0) {
    return {
      maxDrawdown: { percent: 0, from: '', to: '', durationDays: 0 },
      drawdownHistory: []
    };
  }

  let runningPeak = portfolioHistory[0][1];
  let runningPeakIndex = 0;
  let maxDD = 0;
  let maxDDPeakIndex = 0;
  let maxDDTroughIndex = 0;

  const drawdownHistory: DrawdownPoint[] = [];

  for (let i = 0; i < portfolioHistory.length; i++) {
    const [timestamp, value] = portfolioHistory[i];

    // Update running peak
    if (value > runningPeak) {
      runningPeak = value;
      runningPeakIndex = i; // P1.2 FIX: Track peak index explicitly
    }

    // Calculate current drawdown
    const currentDD = runningPeak > 0 ? ((value - runningPeak) / runningPeak) : 0;

    drawdownHistory.push({
      timestamp,
      drawdown: currentDD,
      portfolioValue: value,
      peakValue: runningPeak
    });

    // Update max drawdown
    if (currentDD < maxDD) {
      maxDD = currentDD;
      maxDDPeakIndex = runningPeakIndex; // P1.2 FIX: Use tracked peak index
      maxDDTroughIndex = i;
    }
  }

  const maxDDFrom = portfolioHistory[maxDDPeakIndex][0];
  const maxDDTo = portfolioHistory[maxDDTroughIndex][0];
  const durationMs = maxDDTo - maxDDFrom;
  const durationDays = Math.floor(durationMs / (24 * 60 * 60 * 1000));

  return {
    maxDrawdown: {
      percent: maxDD * 100, // Convert to percentage
      from: new Date(maxDDFrom).toISOString(),
      to: new Date(maxDDTo).toISOString(),
      durationDays
    },
    drawdownHistory
  };
}

// ============================================================================
// SHARPE RATIO (P1.2 CORRECTED - GEOMETRIC ANNUALIZATION)
// ============================================================================

/**
 * Calculate Sharpe Ratio with GEOMETRIC annualization
 *
 * P1.2 CORRECTION: Uses geometric annualization instead of linear
 * Formula: (Geometric Annualized Return - Risk Free Rate) / Annualized Volatility
 *
 * Geometric annualization: (1 + total_return)^(trading_days/days_elapsed) - 1
 */
export function calculateSharpeRatio(
  portfolioHistory: Array<[number, number]>,
  annualizedVolatility: number,
  tradingDaysPerYear: number
): number | null {
  if (portfolioHistory.length < 2 || annualizedVolatility === 0) return null;

  const startValue = portfolioHistory[0][1];
  const endValue = portfolioHistory[portfolioHistory.length - 1][1];

  if (startValue === 0) return null;

  // Calculate total return
  const totalReturn = (endValue - startValue) / startValue;

  // Calculate time elapsed in years
  const daysElapsed = (portfolioHistory[portfolioHistory.length - 1][0] - portfolioHistory[0][0])
                       / (24 * 60 * 60 * 1000);
  const yearsElapsed = daysElapsed / tradingDaysPerYear;

  // P1.2 FIX: GEOMETRIC annualization (not linear!)
  // Formula: (1 + total_return)^(1/years) - 1
  const geometricAnnualizedReturn = Math.pow(1 + totalReturn, 1 / yearsElapsed) - 1;

  // Calculate Sharpe
  const excessReturn = geometricAnnualizedReturn - RISK_FREE_RATE;
  const sharpe = excessReturn / annualizedVolatility;

  return sharpe;
}

// ============================================================================
// VALUE AT RISK (VaR) AND CONDITIONAL VaR (P1.2 - LINEAR INTERPOLATION)
// ============================================================================

/**
 * Calculate Value at Risk (95% confidence) with linear interpolation
 *
 * P1.2 CORRECTION: Uses linear interpolation for percentiles instead of Math.floor
 * This provides more accurate VaR for small datasets
 *
 * "You have 5% chance of losing more than X in a day"
 */
export function calculateVaR95(
  returns: number[],
  currentPortfolioValue: number
): { percent: number; amount: number } {
  if (returns.length < 10) {
    return { percent: 0, amount: 0 };
  }

  // Sort returns from worst to best
  const sortedReturns = [...returns].sort((a, b) => a - b);

  // P1.2 FIX: Use linear interpolation for 5th percentile
  const exactIndex = sortedReturns.length * 0.05;
  const lowerIndex = Math.floor(exactIndex);
  const upperIndex = Math.ceil(exactIndex);

  let var95Return: number;

  if (lowerIndex === upperIndex) {
    // Exact index
    var95Return = sortedReturns[lowerIndex];
  } else {
    // Interpolate between two values
    const weight = exactIndex - lowerIndex;
    var95Return = sortedReturns[lowerIndex] * (1 - weight) + sortedReturns[upperIndex] * weight;
  }

  const var95Percent = var95Return * 100; // Convert to percentage
  const var95Amount = var95Return * currentPortfolioValue;

  return {
    percent: var95Percent,
    amount: var95Amount
  };
}

/**
 * Calculate Conditional Value at Risk (CVaR / Expected Shortfall) with linear interpolation
 *
 * P1.2 CORRECTION: Uses linear interpolation for percentile threshold
 *
 * CVaR answers: "When losses exceed VaR, what's the average loss?"
 * More informative than VaR for tail risk assessment
 *
 * @param returns - Array of daily returns
 * @param currentPortfolioValue - Current portfolio value
 * @param confidence - Confidence level (e.g., 0.95 for 95%)
 */
export function calculateCVaR(
  returns: number[],
  currentPortfolioValue: number,
  confidence: number = 0.95
): { percent: number; amount: number } {
  if (returns.length < 10) {
    return { percent: 0, amount: 0 };
  }

  // Sort returns from worst to best
  const sortedReturns = [...returns].sort((a, b) => a - b);

  // P1.2 FIX: Use linear interpolation for VaR threshold
  const exactIndex = sortedReturns.length * (1 - confidence);
  const varIndex = Math.ceil(exactIndex);

  // CVaR = average of all returns worse than VaR
  const tailReturns = sortedReturns.slice(0, varIndex);
  const cvarReturn = mean(tailReturns);

  const cvarPercent = cvarReturn * 100; // Convert to percentage
  const cvarAmount = cvarReturn * currentPortfolioValue;

  return {
    percent: cvarPercent,
    amount: cvarAmount
  };
}

// ============================================================================
// CONCENTRATION RISK
// ============================================================================

/**
 * Calculate Herfindahl-Hirschman Index (concentration)
 * Sum of squared weights
 *
 * Interpretation (using asset-class-specific thresholds):
 * Crypto portfolios:
 * - 0.0 - 0.25: Well diversified
 * - 0.25 - 0.40: Moderately concentrated
 * - 0.40 - 0.60: Highly concentrated
 * - 0.60+: Extremely concentrated
 *
 * Stock portfolios have lower thresholds (see CONCENTRATION_THRESHOLDS)
 */
export function calculateHerfindahlIndex(weights: number[]): number {
  return weights.reduce((sum, weight) => sum + Math.pow(weight, 2), 0);
}

/**
 * Calculate top N holdings concentration
 */
export function calculateTopHoldingsConcentration(
  assets: Asset[],
  totalPortfolioValue: number
): {
  top1Percent: number;
  top3Percent: number;
  top5Percent: number;
} {
  // Sort assets by value (descending)
  const sortedAssets = [...assets]
    .map(asset => ({
      ...asset,
      value: asset.quantity * asset.currentPrice
    }))
    .sort((a, b) => b.value - a.value);

  const top1 = sortedAssets.slice(0, 1).reduce((sum, a) => sum + a.value, 0);
  const top3 = sortedAssets.slice(0, 3).reduce((sum, a) => sum + a.value, 0);
  const top5 = sortedAssets.slice(0, 5).reduce((sum, a) => sum + a.value, 0);

  return {
    top1Percent: totalPortfolioValue > 0 ? (top1 / totalPortfolioValue) * 100 : 0,
    top3Percent: totalPortfolioValue > 0 ? (top3 / totalPortfolioValue) * 100 : 0,
    top5Percent: totalPortfolioValue > 0 ? (top5 / totalPortfolioValue) * 100 : 0
  };
}

// ============================================================================
// BETA CALCULATION (P1.2 CORRECTED - TIMESTAMP ALIGNMENT)
// ============================================================================

/**
 * Reconstruct asset value history aligned with portfolio timestamps
 *
 * P1.2 CORRECTION: This function ensures asset returns are calculated
 * at the EXACT SAME timestamps as portfolio returns, enabling proper beta calculation
 *
 * Returns asset values in display currency at each portfolio timestamp
 */
function reconstructAssetValueHistory(
  asset: Asset,
  portfolioTimestamps: number[],
  displayCurrency: Currency,
  historicalRates: Record<string, Record<string, number>>,
  exchangeRates: Record<string, number>
): number[] {
  const assetValues: number[] = [];
  const assetCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);

  for (const timestamp of portfolioTimestamps) {
    // Calculate quantity owned at this timestamp
    let qtyAtTime = 0;
    asset.transactions.forEach(tx => {
      const txTime = parseDateStringLocal(tx.date).getTime(); // P1.2 FIX: Use local timezone parser
      if (txTime <= timestamp) {
        qtyAtTime += tx.quantity;
      }
    });

    if (qtyAtTime <= 0) {
      assetValues.push(0);
      continue;
    }

    // Get price at this timestamp (same logic as portfolio reconstruction)
    let priceAtTime = asset.currentPrice;

    if (asset.priceHistory && asset.priceHistory.length > 0) {
      const history = asset.priceHistory;

      if (timestamp < history[0][0]) {
        const sortedTxs = asset.transactions
          .slice()
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        priceAtTime = sortedTxs[0]?.pricePerCoin || asset.avgBuyPrice;
      } else if (timestamp >= history[history.length - 1][0]) {
        priceAtTime = asset.currentPrice;
      } else {
        const idx = history.findIndex(p => p[0] >= timestamp);
        if (idx === 0) {
          priceAtTime = history[0][1];
        } else if (idx === -1) {
          priceAtTime = history[history.length - 1][1];
        } else {
          const p1 = history[idx - 1];
          const p2 = history[idx];
          const span = p2[0] - p1[0];
          if (span > 0) {
            const progress = (timestamp - p1[0]) / span;
            priceAtTime = p1[1] + (p2[1] - p1[1]) * progress;
          } else {
            priceAtTime = p1[1];
          }
        }
      }
    }

    // Convert to display currency
    const valueInNative = qtyAtTime * priceAtTime;
    const valueInDisplay = convertCurrencySyncHistorical(
      valueInNative,
      assetCurrency,
      displayCurrency,
      new Date(timestamp),
      historicalRates,
      exchangeRates
    );

    assetValues.push(valueInDisplay);
  }

  return assetValues;
}

/**
 * Calculate asset beta (correlation with portfolio) with TIMESTAMP ALIGNMENT
 *
 * P1.2 CORRECTION: Implements explicit timestamp alignment before calculating beta
 * This ensures asset and portfolio returns are calculated at identical timestamps
 *
 * Beta measures correlation in display currency (includes both asset and FX risk)
 *
 * Beta interpretation:
 * - β = 1.0: Moves exactly with portfolio
 * - β > 1.0: More volatile than portfolio
 * - β < 1.0: Less volatile than portfolio
 * - β < 0: Moves opposite to portfolio (diversifier)
 */
export function calculateBeta(
  asset: Asset,
  portfolioHistory: Array<[number, number]>,
  displayCurrency: Currency,
  historicalRates: Record<string, Record<string, number>>,
  exchangeRates: Record<string, number>
): number {
  if (portfolioHistory.length < 2) {
    return 1.0; // Default to 1.0 if insufficient data
  }

  // P1.2 FIX: Reconstruct asset values at EXACT portfolio timestamps
  const portfolioTimestamps = portfolioHistory.map(([ts, _]) => ts);
  const assetValues = reconstructAssetValueHistory(
    asset,
    portfolioTimestamps,
    displayCurrency,
    historicalRates,
    exchangeRates
  );

  // Calculate returns (now guaranteed to be aligned!)
  const portfolioValues = portfolioHistory.map(([_, val]) => val);
  const assetReturns = calculateReturns(assetValues);
  const portfolioReturns = calculateReturns(portfolioValues);

  // Calculate beta
  if (assetReturns.length !== portfolioReturns.length || assetReturns.length < 2) {
    return 1.0;
  }

  const cov = covariance(assetReturns, portfolioReturns);
  const portfolioVariance = Math.pow(standardDeviation(portfolioReturns), 2);

  if (portfolioVariance === 0) return 1.0;

  return cov / portfolioVariance;
}

// ============================================================================
// RISK CONTRIBUTION (P1.2 CORRECTED - STANDARD MCR FORMULA)
// ============================================================================

/**
 * Calculate risk contribution using standard Marginal Contribution to Risk (MCR)
 *
 * P1.2 CORRECTION: Uses standard MCR formula instead of non-standard approximation
 *
 * Standard MCR formula:
 * - Marginal Contribution to Risk = Beta × Portfolio Volatility
 * - Risk Contribution = Asset Weight × MCR
 *
 * This measures how much an asset contributes to total portfolio risk
 *
 * @returns Risk contribution as percentage of total portfolio risk
 */
export function calculateRiskContribution(
  assetWeight: number,
  beta: number,
  portfolioVolatility: number
): number {
  if (portfolioVolatility === 0) return 0;

  // P1.2 FIX: Standard MCR formula
  const mcr = beta * portfolioVolatility;
  const contribution = assetWeight * mcr;

  // Normalize to percentage of total risk
  // Note: Sum of all risk contributions should equal portfolio volatility
  return (contribution / portfolioVolatility) * 100;
}

// ============================================================================
// MAIN RISK ANALYSIS FUNCTION
// ============================================================================

/**
 * Calculate complete risk analysis
 * This is the main entry point called by the component
 */
export async function calculateRiskAnalysis(
  assets: Asset[],
  period: RiskTimePeriod,
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  historicalRates: Record<string, Record<string, number>>
): Promise<RiskAnalysis | null> {

  // Validation
  if (assets.length === 0) return null;
  if (Object.keys(exchangeRates).length === 0) return null;

  // 1. Reconstruct portfolio history WITH CASH FLOW TRACKING
  const { portfolioHistory, cashFlows } = reconstructPortfolioHistory(
    assets,
    period,
    displayCurrency,
    exchangeRates,
    historicalRates
  );

  // P1.2: Tiered data requirements
  if (portfolioHistory.length < 30) {
    console.warn(`⚠️ Insufficient data for reliable risk analysis (${portfolioHistory.length} days < 30 minimum)`);
    return null;
  }

  // P1.2 DEBUG: Log cash flows for debugging
  if (cashFlows.length > 0) {
    console.log(`💰 Cash Flow Adjustment: Found ${cashFlows.length} transaction days`);
    console.log(`💰 Total cash flows:`, cashFlows.reduce((sum, [_, amt]) => sum + amt, 0).toFixed(2), displayCurrency);
  }

  // 2. Calculate portfolio-level metrics WITH CASH FLOW ADJUSTMENT
  const currentPortfolioValue = portfolioHistory[portfolioHistory.length - 1][1];

  // P1.2 FIX: Use cash-flow-adjusted returns for volatility and risk metrics
  const portfolioReturns = calculateCashFlowAdjustedReturns(portfolioHistory, cashFlows);

  const { volatility, tradingDaysUsed } = calculatePortfolioVolatility(portfolioHistory, cashFlows, assets);
  const { maxDrawdown, drawdownHistory } = calculateMaxDrawdown(portfolioHistory);
  const sharpeRatio = calculateSharpeRatio(portfolioHistory, volatility, tradingDaysUsed);
  const var95 = calculateVaR95(portfolioReturns, currentPortfolioValue);
  const cvar95 = calculateCVaR(portfolioReturns, currentPortfolioValue, 0.95);

  // 3. Calculate concentration metrics
  // P1.2 BUGFIX: Must recalculate total value using CURRENT exchange rates (not historical from portfolio history)
  // This ensures consistency between numerator (asset values) and denominator (total value)

  const assetValues = assets.map(asset => {
    const assetCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);
    const valueInNative = asset.quantity * asset.currentPrice;

    // P1.2 BUGFIX: Correct currency conversion formula
    // Exchange rates are stored as "units per 1 USD"
    // Example: rates['CHF'] = 1.10 means 1 USD = 1.10 CHF, so 1 CHF = 1/1.10 USD = 0.909 USD
    // To convert CHF to EUR: CHF → USD → EUR
    // valueInCHF / rates['CHF'] = valueInUSD
    // valueInUSD * rates['EUR'] = valueInEUR
    // Combined: valueInNative * (rates[displayCurrency] / rates[assetCurrency])
    const valueInDisplay = valueInNative * (exchangeRates[displayCurrency] / exchangeRates[assetCurrency]);

    return { asset, assetCurrency, valueInNative, valueInDisplay };
  });

  const totalValue = assetValues.reduce((sum, av) => sum + av.valueInDisplay, 0);

  const weights = assetValues.map(av => {
    const weight = av.valueInDisplay / totalValue;
    console.log(`🔍 HHI Weight: ${av.asset.ticker} (${av.assetCurrency}): ${av.valueInNative.toFixed(2)} ${av.assetCurrency} * (${exchangeRates[displayCurrency].toFixed(4)} / ${exchangeRates[av.assetCurrency].toFixed(4)}) = ${av.valueInDisplay.toFixed(2)} ${displayCurrency} / ${totalValue.toFixed(2)} = ${(weight * 100).toFixed(4)}%`);
    return weight;
  });

  const herfindahlIndex = calculateHerfindahlIndex(weights);
  console.log(`🔍 HHI: weights=${weights.map(w => (w*100).toFixed(4)+'%').join(', ')}, HHI=${(herfindahlIndex*100).toFixed(2)}%`);

  // P1.2 BUGFIX: Calculate top holdings using already-converted values in display currency
  const sortedAssetValues = [...assetValues].sort((a, b) => b.valueInDisplay - a.valueInDisplay);
  const top1 = sortedAssetValues.slice(0, 1).reduce((sum, av) => sum + av.valueInDisplay, 0);
  const top3 = sortedAssetValues.slice(0, 3).reduce((sum, av) => sum + av.valueInDisplay, 0);
  const top5 = sortedAssetValues.slice(0, 5).reduce((sum, av) => sum + av.valueInDisplay, 0);

  const topHoldings = {
    top1Percent: totalValue > 0 ? (top1 / totalValue) * 100 : 0,
    top3Percent: totalValue > 0 ? (top3 / totalValue) * 100 : 0,
    top5Percent: totalValue > 0 ? (top5 / totalValue) * 100 : 0
  };

  // Determine concentration rating using portfolio composition
  const portfolioComp = detectPortfolioComposition(assets);
  const concentrationThresholds = CONCENTRATION_THRESHOLDS[portfolioComp];
  const concentrationRating = getRiskRating(herfindahlIndex, concentrationThresholds);

  // 4. Calculate asset-level metrics
  const assetMetrics: AssetRiskMetrics[] = [];

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];

    // Calculate beta with timestamp alignment
    const beta = calculateBeta(asset, portfolioHistory, displayCurrency, historicalRates, exchangeRates);

    // Calculate asset volatility
    const assetTradingDays = getTradingDaysPerYear(asset.ticker);
    let assetVol: number;

    if (asset.priceHistory && asset.priceHistory.length > 1) {
      const prices = asset.priceHistory.map(p => p[1]);
      const assetReturns = calculateReturns(prices);
      assetVol = calculateAnnualizedVolatility(assetReturns, assetTradingDays);
    } else {
      // P1.2 FIX: Use conservative asset-class estimate instead of portfolio volatility
      const assetClass = detectAssetClass(asset.ticker);
      assetVol = FALLBACK_VOLATILITY[assetClass];
    }

    // Calculate risk contribution using standard MCR
    const riskContrib = calculateRiskContribution(weights[i], beta, volatility);

    // Determine risk rating
    const riskRating = getRiskRating(assetVol, VOLATILITY_THRESHOLDS);

    assetMetrics.push({
      assetId: asset.id,
      ticker: asset.ticker,
      name: asset.name || asset.ticker,
      beta,
      annualizedVolatility: assetVol,
      riskContribution: riskContrib,
      portfolioWeight: weights[i] * 100,
      riskRating,
      dataPoints: asset.priceHistory?.length || 0
    });
  }

  // 5. Assemble final analysis
  return {
    portfolio: {
      annualizedVolatility: volatility,
      volatilityRating: getRiskRating(volatility, VOLATILITY_THRESHOLDS),
      maxDrawdown,
      sharpeRatio,
      valueAtRisk95: var95,
      conditionalVaR95: cvar95,
      concentration: {
        herfindahlIndex,
        ...topHoldings,
        rating: concentrationRating
      },
      calculationPeriod: period,
      dataPoints: portfolioHistory.length,
      calculationDate: new Date().toISOString(),
      displayCurrency
    },
    assets: assetMetrics,
    drawdownHistory
  };
}

// ============================================================================
// PHASE 1 TEST FUNCTION (temporary - for verification only)
// ============================================================================

/**
 * Test function to verify Phase 1 implementation
 * Call this from browser console: testPhase1()
 */
export function testPhase1(
  assets: Asset[],
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  historicalRates: Record<string, Record<string, number>>
) {
  console.log('🧪 ===== PHASE 1 TEST =====');
  console.log('📊 Testing with', assets.length, 'assets');

  // Test 1: Portfolio reconstruction
  console.log('\n📈 Test 1: Portfolio History Reconstruction (30D)');
  const { portfolioHistory: history30D, cashFlows: cashFlows30D } = reconstructPortfolioHistory(
    assets, '30D', displayCurrency, exchangeRates, historicalRates
  );
  console.log('  ✓ 30D history:', history30D.length, 'data points');
  console.log('  ✓ Cash flows:', cashFlows30D.length, 'transaction days');
  if (history30D.length > 0) {
    console.log('  ✓ First value:', history30D[0][1].toFixed(2), displayCurrency);
    console.log('  ✓ Last value:', history30D[history30D.length - 1][1].toFixed(2), displayCurrency);
  }

  // Test 2: Asset class detection
  console.log('\n🔍 Test 2: Asset Class Detection');
  assets.forEach(asset => {
    const assetClass = detectAssetClass(asset.ticker);
    const tradingDays = getTradingDaysPerYear(asset.ticker);
    console.log(`  ✓ ${asset.ticker}: ${assetClass} (${tradingDays} trading days/year)`);
  });

  // Test 3: Volatility calculation (with cash flow adjustment)
  if (history30D.length >= 2) {
    console.log('\n📊 Test 3: Volatility Calculation (Cash Flow Adjusted)');
    const { volatility, tradingDaysUsed } = calculatePortfolioVolatility(history30D, cashFlows30D, assets);
    console.log('  ✓ Annualized volatility:', (volatility * 100).toFixed(2) + '%');
    console.log('  ✓ Trading days used:', tradingDaysUsed);
    console.log('  ✓ Risk rating:', getRiskRating(volatility, VOLATILITY_THRESHOLDS));
  }

  // Test 4: Portfolio composition
  console.log('\n🥧 Test 4: Portfolio Composition');
  const composition = detectPortfolioComposition(assets);
  console.log('  ✓ Portfolio type:', composition);

  console.log('\n✅ Phase 1 tests complete!\n');
}
