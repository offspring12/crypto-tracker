export interface SourceLink {
  title: string;
  url: string;
}

export type TransactionTag = 
  | 'DCA' 
  | 'FOMO' 
  | 'Strategic' 
  | 'Swing Trade' 
  | 'Long-term Hold' 
  | 'Dip Buy' 
  | 'Custom';

export type AssetType = 'CRYPTO' | 'STOCK' | 'ETF' | 'CASH';

export type Currency = 'USD' | 'CHF';

export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  pricePerCoin: number;
  date: string;
  totalCost: number;
  tag: TransactionTag; // REQUIRED: Transaction tags for analytics
  customTag?: string; // Custom tag text if tag === 'Custom'
  createdAt: string; // Timestamp when transaction was created
  lastEdited?: string; // Track when transaction was last edited
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
  assetType: AssetType; // Type of asset (crypto, stock, etc.)
  currency?: Currency; // Native currency (for stocks, cash)
}

export interface HistorySnapshot {
  timestamp: number;
  totalValue: number;
  assetValues: Record<string, number>;
}

export interface Portfolio {
  id: string;
  name: string;
  color: string; // For visual distinction
  assets: Asset[];
  history: HistorySnapshot[];
  settings: {
    displayCurrency?: Currency; // Portfolio display currency
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

// Tag color mapping
export const TAG_COLORS: Record<TransactionTag, string> = {
  'DCA': '#3b82f6', // Blue
  'FOMO': '#ef4444', // Red
  'Strategic': '#10b981', // Green
  'Swing Trade': '#f97316', // Orange
  'Long-term Hold': '#a855f7', // Purple
  'Dip Buy': '#06b6d4', // Cyan
  'Custom': '#6b7280' // Gray
};

// Asset type display config
export const ASSET_TYPE_CONFIG: Record<AssetType, { icon: string; color: string; label: string }> = {
  'CRYPTO': { icon: '🪙', color: '#a855f7', label: 'Crypto' },
  'STOCK': { icon: '📈', color: '#3b82f6', label: 'Stock' },
  'ETF': { icon: '📊', color: '#10b981', label: 'ETF' },
  'CASH': { icon: '💵', color: '#6b7280', label: 'Cash' }
};