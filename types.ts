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