export interface SourceLink {
  title: string;
  url: string;
}

export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  pricePerCoin: number;
  date: string;
  totalCost: number;
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
  // New fields for P&L
  transactions: Transaction[];
  avgBuyPrice: number;
  totalCostBasis: number;
  // New field for Historical Data
  coinGeckoId?: string;
  priceHistory?: number[][]; // Array of [timestamp, price]
  // New field for Target Allocation
  targetAllocation?: number; // Percentage (0-100)
}

export interface HistorySnapshot {
  timestamp: number;
  totalValue: number;
  assetValues: Record<string, number>; // ticker -> value at that time
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