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

// P3: Cash Flow Management - Extended transaction types
export type TransactionType = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'INCOME';

export type IncomeType = 'dividend' | 'staking' | 'airdrop' | 'interest';

// P1.1B CHANGE: Added purchaseCurrency and exchangeRateAtPurchase for FX-adjusted performance
// P3 CHANGE: Extended transaction types to include DEPOSIT, WITHDRAWAL, INCOME
export interface Transaction {
  id: string;
  type: TransactionType;
  quantity: number;
  pricePerCoin: number;
  date: string;
  totalCost: number; // For SELL transactions, this represents proceeds (positive value)
  tag?: TransactionTag;
  lastEdited?: string;
  createdAt?: string;
  purchaseCurrency?: Currency; // P1.1B NEW: Currency used at purchase time (e.g., 'USD', 'CHF')
  exchangeRateAtPurchase?: Record<Currency, number>; // P1.1B NEW: Snapshot of ALL exchange rates at purchase date

  // P2: Trading Lifecycle - For SELL transactions only
  proceeds?: number; // Total proceeds from sale (market value received)
  proceedsCurrency?: string; // For crypto sells: which asset/currency did you sell to? (e.g., 'USDT', 'ETH', 'BTC')

  // P3: Cash Flow Management - DEPOSIT specific
  costBasis?: number; // User-provided cost basis for crypto/stock deposits
  depositSource?: string; // "Bank Transfer", "Coinbase", etc.

  // P3: WITHDRAWAL specific
  withdrawalDestination?: string; // "Bank Account", "Hardware Wallet", etc.

  // P3: TRANSFER specific (portfolio to portfolio)
  destinationPortfolioId?: string; // ID of destination portfolio for TRANSFER transactions
  linkedTransactionId?: string; // Link to corresponding transaction in destination portfolio
  transferredFrom?: string; // P3: Portfolio ID this transaction was transferred FROM (marks copied transactions in destination)

  // P3: INCOME specific
  incomeType?: IncomeType; // Type of income: dividend, staking, airdrop, interest
  incomeSource?: string; // Source of income (e.g., "Coinbase Staking", "AAPL Dividend")

  // P3: BUY specific - source of funds
  sourceTicker?: string; // What you paid with (e.g., 'USD', 'BTC', 'ETH')
  sourceQuantity?: number; // How much you paid

  // P4: SELL specific - destination of funds (for buy with asset transactions)
  destinationTicker?: string; // What you bought (e.g., 'NESN.SW', 'BTC')
  destinationQuantity?: number; // How much you bought

  // P4: BUY/SELL transaction linking (for buy asset with another asset transactions)
  linkedBuySellTransactionId?: string; // Links BUY transaction to corresponding SELL transaction in source asset (and vice versa)
  transactionPairId?: string; // Unique ID shared by both BUY and SELL in a purchase transaction
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

// ============================================================================
// P2: TRADING LIFECYCLE & CASH MANAGEMENT
// ============================================================================

/**
 * Closed position representing a completed buy-sell cycle
 * Tracks realized P&L using FIFO cost basis
 */
export interface ClosedPosition {
  id: string;
  ticker: string;
  name: string;
  assetType: AssetType;

  // Links to original transactions
  buyTransactionId: string;
  sellTransactionId: string;

  // Entry details
  entryDate: string;
  entryPrice: number;
  entryQuantity: number;
  entryCostBasis: number; // In display currency
  entryCurrency: Currency;
  entryTag?: TransactionTag;

  // Exit details
  exitDate: string;
  exitPrice: number;
  exitQuantity: number;
  exitProceeds: number; // In display currency
  exitCurrency: string; // For crypto, can be 'USDT', 'ETH', etc.; for stocks, native currency
  exitTag?: TransactionTag;

  // P&L (in display currency)
  realizedPnL: number;
  realizedPnLPercent: number;

  // Metadata
  displayCurrency: Currency;
  closedAt: string; // ISO timestamp
  holdingPeriodDays: number;
}

export interface Portfolio {
  id: string;
  name: string;
  color: string;
  assets: Asset[];
  closedPositions: ClosedPosition[]; // P2: Trading Lifecycle - Closed positions history
  history: HistorySnapshot[];
  settings: {
    displayCurrency?: Currency; // Optional: portfolio-level display currency
  };
  benchmarkSettings?: BenchmarkSettings; // Benchmark comparison settings (per-portfolio)
  createdAt: string;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCostBasis: number;

  // P2: Trading Lifecycle - Split P&L
  unrealizedPnL: number;          // From open positions
  unrealizedPnLPercent: number;
  realizedPnL: number;             // From closed positions
  realizedPnLPercent: number;

  totalPnL: number;                // Sum of realized + unrealized
  totalPnLPercent: number;
  assetCount: number;
  closedPositionCount: number;     // P2: Count of closed positions
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

// ============================================================================
// REBALANCING TYPES
// ============================================================================

/**
 * User-configurable rebalancing settings
 */
export interface RebalancingSettings {
  deviationThreshold: number;    // Minimum deviation % to trigger suggestion (default: 3%)
  minTradeAmount: number;        // Minimum trade amount in display currency (default: 100)
}

/**
 * Allocation deviation for a single asset
 */
export interface AllocationDeviation {
  assetId: string;
  ticker: string;
  name: string;
  currentValue: number;          // Current value in display currency
  currentAllocation: number;     // Current allocation as percentage (0-100)
  targetAllocation: number;      // Target allocation as percentage (0-100)
  deviation: number;             // currentAllocation - targetAllocation
  deviationAmount: number;       // Deviation in display currency (positive = overweight)
  status: 'overweight' | 'underweight' | 'on-target';
}

/**
 * A single suggested rebalancing trade (sell → buy pair)
 */
export interface RebalancingTrade {
  id: string;
  priority: number;              // 1 = highest priority (largest deviation)

  // Sell side
  sellTicker: string;
  sellName: string;
  sellAmount: number;            // Amount in display currency
  sellQuantity: number;          // Quantity of asset to sell
  sellCurrentPrice: number;      // Current price per unit

  // Buy side
  buyTicker: string;
  buyName: string;
  buyAmount: number;             // Amount in display currency (should match sellAmount)
  buyQuantity: number;           // Quantity of asset to buy
  buyCurrentPrice: number;       // Current price per unit
}

/**
 * Complete rebalancing suggestion result
 */
export interface RebalancingSuggestion {
  // Portfolio context
  portfolioId: string;
  totalPortfolioValue: number;   // In display currency
  displayCurrency: Currency;
  calculatedAt: string;          // ISO timestamp

  // Settings used for calculation
  settings: RebalancingSettings;

  // Allocation analysis
  deviations: AllocationDeviation[];
  assetsWithoutTarget: number;   // Count of assets with no target allocation

  // Suggested trades
  trades: RebalancingTrade[];
  totalRebalanceAmount: number;  // Total value to be rebalanced in display currency

  // Summary counts
  overweightCount: number;
  underweightCount: number;
  onTargetCount: number;

  // Projected allocations after rebalancing
  projectedAllocations: Array<{
    ticker: string;
    name: string;
    beforeAllocation: number;
    afterAllocation: number;
    targetAllocation: number;
  }>;
}

// ============================================================================
// BENCHMARK COMPARISON TYPES
// ============================================================================

/**
 * Cached benchmark price data fetched from Yahoo Finance
 */
export interface BenchmarkData {
  ticker: string;
  name: string;
  priceHistory: number[][];  // Array of [timestamp (ms), price] tuples
  lastUpdated: number;       // Unix timestamp (ms) when data was fetched
  currency: string;          // Currency of the benchmark (e.g., 'USD', 'CHF')
}

/**
 * Individual benchmark configuration
 */
export interface BenchmarkConfig {
  ticker: string;
  name: string;
  color: string;
  visible: boolean;
  isCustom: boolean;         // true for user-added benchmarks
}

/**
 * Portfolio-level benchmark settings
 */
export interface BenchmarkSettings {
  benchmarks: BenchmarkConfig[];
  maxVisibleBenchmarks: number;  // Maximum benchmarks visible at once (default: 3)
}

/**
 * Default benchmark options available to all portfolios
 */
export const DEFAULT_BENCHMARKS: Omit<BenchmarkConfig, 'visible'>[] = [
  {
    ticker: '^SSMI',
    name: 'SMI (Swiss)',
    color: '#F97316',  // Orange
    isCustom: false,
  },
  {
    ticker: '^GSPC',
    name: 'S&P 500',
    color: '#22C55E',  // Green
    isCustom: false,
  },
  {
    ticker: 'URTH',
    name: 'MSCI World',
    color: '#A855F7',  // Purple
    isCustom: false,
  },
  {
    ticker: 'BTC-USD',
    name: 'Bitcoin',
    color: '#EAB308',  // Yellow
    isCustom: false,
  },
];

/**
 * Normalized benchmark data point for chart rendering
 * All values normalized to percentage change from start
 */
export interface NormalizedBenchmarkPoint {
  timestamp: number;
  percentChange: number;  // Percentage change from starting point
}

/**
 * Processed benchmark data ready for chart display
 */
export interface ChartBenchmarkData {
  ticker: string;
  name: string;
  color: string;
  data: NormalizedBenchmarkPoint[];
  returnPercent: number;  // Total return for the selected period
}