export interface SourceLink {
  title: string;
  url: string;
}

export type TransactionTag = 
  | 'DCA' 
  | 'FOMO' 
  | 'Strategic' 
  | 'Rebalance' 
  | 'Emergency' 
  | 'Profit-Taking' 
  | 'Research' 
  | string; // Allow custom tags

export type AssetType = 'CRYPTO' | 'STOCK_US' | 'STOCK_CH' | 'STOCK_DE' | 'ETF' |'STOCK_UK' | 'STOCK_JP' | 'CASH';

// Supported currencies
export type Currency = 'USD' | 'CHF' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';

// P1.1B CHANGE: Added purchaseCurrency and exchangeRateAtPurchase for FX-adjusted performance
export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  pricePerCoin: number;
  date: string;
  totalCost: number;
  tag?: TransactionTag;
  lastEdited?: string;
  createdAt?: string;
  purchaseCurrency?: Currency; // P1.1B NEW: Currency used at purchase time (e.g., 'USD', 'CHF')
  exchangeRateAtPurchase?: Record<Currency, number>; // P1.1B NEW: Snapshot of ALL exchange rates at purchase date
}

export interface Asset {
  id: string;
  ticker: string;
  name?: string;
  quantity: number;
  currentPrice: number;
  lastUpdated: string;
  sources: SourceLink[];
  isUpdating: boolean;
  error?: string;
  transactions: Transaction[];
  avgBuyPrice: number;
  totalCostBasis: number;
  coinGeckoId?: string;
  priceHistory?: number[][];
  targetAllocation?: number;
  assetType?: AssetType;
  currency?: Currency; // Currency for this asset's prices
}

export interface HistorySnapshot {
  timestamp: number;
  totalValue: number;
  assetValues: Record<string, number>;
}

export interface Portfolio {
  id: string;
  name: string;
  color: string;
  assets: Asset[];
  history: HistorySnapshot[];
  settings: {
    displayCurrency?: Currency; // Optional: portfolio-level display currency
  };
  createdAt: string;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCostBasis: number;
  totalPnL: number;
  totalPnLPercent: number;
  assetCount: number;
  lastGlobalUpdate: string | null;
}

export enum LoadingState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

// P1.1: Tag Analytics Performance Tracking
export interface TagPerformance {
  tag: string;
  totalInvested: number;         // In display currency
  currentValue: number;           // In display currency
  pnl: number;                    // In display currency
  pnlPercent: number;
  transactionCount: number;
  assetBreakdown: Array<{
    ticker: string;
    name: string;
    invested: number;             // In display currency
    currentValue: number;         // In display currency
    pnl: number;                  // In display currency
    pnlPercent: number;
  }>;
}

// ============================================================================
// P1.2: RISK METRICS TYPES
// ============================================================================

/**
 * Time period for risk calculations
 */
export type RiskTimePeriod = '30D' | '90D' | '1Y' | 'ALL';

/**
 * Risk rating levels
 */
export type RiskRating = 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';

/**
 * Portfolio-level risk metrics
 */
export interface PortfolioRiskMetrics {
  // Volatility Metrics
  annualizedVolatility: number;           // Standard deviation of returns (annualized)
  volatilityRating: RiskRating;           // Risk rating based on volatility

  // Downside Risk
  maxDrawdown: {
    percent: number;                      // Maximum peak-to-trough decline (%)
    from: string;                         // Peak date (ISO string)
    to: string;                           // Trough date (ISO string)
    durationDays: number;                 // Days from peak to trough
  };

  // Risk-Adjusted Performance
  sharpeRatio: number | null;             // (Return - RiskFreeRate) / Volatility (geometric annualization)

  // Value at Risk (1-day historical measure)
  valueAtRisk95: {                        // 95% confidence VaR
    percent: number;                      // Daily VaR as percentage
    amount: number;                       // Daily VaR in display currency
  };

  // Conditional Value at Risk / Expected Shortfall (1-day historical measure)
  conditionalVaR95: {
    percent: number;                      // Average loss in worst 5% of days
    amount: number;                       // Average loss amount in display currency
  };

  // Concentration Risk
  concentration: {
    herfindahlIndex: number;              // Sum of squared weights (0-1)
    top1Percent: number;                  // % of portfolio in largest holding
    top3Percent: number;                  // % of portfolio in top 3 holdings
    top5Percent: number;                  // % of portfolio in top 5 holdings
    rating: RiskRating;                   // Concentration risk rating
  };

  // Metadata
  calculationPeriod: RiskTimePeriod;
  dataPoints: number;                     // Number of data points used
  calculationDate: string;                // ISO string
  displayCurrency: Currency;
}

/**
 * Asset-level risk metrics
 */
export interface AssetRiskMetrics {
  assetId: string;
  ticker: string;
  name: string;

  // Risk Metrics
  beta: number;                           // Correlation with portfolio (1.0 = portfolio avg)
  annualizedVolatility: number;           // Asset's standalone volatility
  riskContribution: number;               // % of total portfolio risk (using MCR)

  // Position Info
  portfolioWeight: number;                // % of portfolio value

  // Ratings
  riskRating: RiskRating;                 // Overall risk rating

  // Metadata
  dataPoints: number;
}

/**
 * Complete risk analysis
 */
export interface RiskAnalysis {
  portfolio: PortfolioRiskMetrics;
  assets: AssetRiskMetrics[];
  drawdownHistory: DrawdownPoint[];      // For charting
}

/**
 * Drawdown data point for visualization
 */
export interface DrawdownPoint {
  timestamp: number;                      // Unix timestamp (ms)
  drawdown: number;                       // Drawdown % from peak (negative)
  portfolioValue: number;                 // Portfolio value at this point
  peakValue: number;                      // Running peak value
}

/**
 * Risk alert
 */
export interface RiskAlert {
  id: string;
  severity: 'warning' | 'danger';
  title: string;
  message: string;
}