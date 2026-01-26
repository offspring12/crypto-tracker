import React, { useState } from 'react';
import { Asset, TransactionTag, Currency, TransactionType, AssetNote } from '../types';
import { convertCurrencySync } from '../services/currencyService';
import { Trash2, RefreshCw, ChevronDown, ChevronUp, AlertCircle, History, TrendingUp, TrendingDown, Signal, SignalLow, Target, AlertTriangle, Edit2, Save, X, Download, ShoppingCart, ArrowRightLeft, Upload, Coins, FileText, Plus } from 'lucide-react';

interface AssetCardProps {
  asset: Asset;
  totalPortfolioValue: number;
  onRemove: (id: string) => void;
  onRemoveTransaction: (assetId: string, txId: string) => void;
  onRefresh: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Asset>) => void;
  onRetryHistory: (id: string) => void;
  onEditTransaction: (assetId: string, txId: string, updates: { quantity?: number; pricePerCoin?: number; date?: string; tag?: TransactionTag }) => void;
  onSell: (asset: Asset) => void; // P2: Trading Lifecycle - Open sell modal
  onQuickTransaction: (asset: Asset, transactionType: TransactionType) => void; // Quick transaction from card
  closedPositions?: any[]; // P2: For calculating SELL transaction P&L
  // Asset Notes
  note?: AssetNote; // Existing note for this asset (if any)
  onNoteClick: (asset: Asset) => void; // Callback when note icon/button is clicked
}

const TAG_COLORS: Record<TransactionTag, string> = {
  DCA: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  FOMO: 'bg-red-500/20 text-red-300 border-red-500/30',
  Strategic: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Rebalance: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  Emergency: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Profit-Taking': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  Research: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  Custom: 'bg-slate-500/20 text-slate-300 border-slate-500/30'
};

const ASSET_TYPE_CONFIG = {
  CRYPTO: { emoji: '🪙', label: 'Crypto', color: 'border-purple-500/50 bg-purple-500/10 text-purple-300' },
  STOCK_US: { emoji: '📈', label: 'US Stock', color: 'border-blue-500/50 bg-blue-500/10 text-blue-300' },
  STOCK_CH: { emoji: '🇨🇭', label: 'Swiss Stock', color: 'border-red-500/50 bg-red-500/10 text-red-300' },
  STOCK_DE: { emoji: '🇩🇪', label: 'German Stock', color: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-300' },
  ETF: { emoji: '📊', label: 'ETF', color: 'border-teal-500/50 bg-teal-500/10 text-teal-300' },
  CASH: { emoji: '💵', label: 'Cash', color: 'border-gray-500/50 bg-gray-500/10 text-gray-300' }
};

// P1.1B NEW: Helper function for FX-adjusted P&L calculation
const calculateFxAdjustedPnL = (
  tx: any,
  assetCurrency: Currency,
  assetTicker: string,
  currentPrice: number,
  closedPositions?: any[]
): { pnl: number; costBasis: number; currentValue: number } => {

  // P2 FIX: For SELL transactions, P&L comes from closed positions
  if (tx.type === 'SELL') {
    // Find the closed position(s) for this sell transaction
    const relatedClosedPositions = (closedPositions || []).filter(
      (cp: any) => cp.sellTransactionId === tx.id
    );

    const realizedPnL = relatedClosedPositions.reduce((sum: number, cp: any) => sum + cp.realizedPnL, 0);

    return {
      pnl: realizedPnL,
      costBasis: tx.totalCost, // The proceeds
      currentValue: tx.totalCost + realizedPnL // Proceeds = cost basis + profit
    };
  }

  // P3: For WITHDRAWAL and TRANSFER transactions, P&L = 0
  if (tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER') {
    return {
      pnl: 0, // No profit/loss on withdrawals or transfers
      costBasis: tx.totalCost || 0,
      currentValue: tx.totalCost || 0 // Value equals cost basis (no gain/loss)
    };
  }

  // P3: For DEPOSIT and INCOME transactions (acquisitions)
  if (tx.type === 'DEPOSIT' || tx.type === 'INCOME') {
    // P3 FIX: For FIAT currencies, P&L should be FX-based, not price appreciation
    // IMPORTANT: Only check assetTicker (the actual asset), NOT assetCurrency (used for formatting)
    const isFiatCurrency = ['USD', 'CHF', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].includes(assetTicker.toUpperCase());

    if (isFiatCurrency) {
      // For FIAT, P&L = 0 on the transaction level
      // FX gains/losses are tracked at portfolio level through exchangeRates
      return {
        pnl: 0,
        costBasis: tx.totalCost,
        currentValue: tx.totalCost // No price appreciation for FIAT
      };
    }

    // For non-FIAT assets (crypto, stocks)
    const currentValue = tx.quantity * currentPrice;
    const costBasis = tx.totalCost;
    const pnl = currentValue - costBasis;

    return {
      pnl,
      costBasis,
      currentValue
    };
  }

  // For BUY transactions
  // P3 FIX: For FIAT currencies (buying CHF with USD, etc), P&L should be 0
  // IMPORTANT: Only check assetTicker, NOT assetCurrency (stocks can be denominated in CHF but aren't FIAT)
  const isFiatAsset = ['USD', 'CHF', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].includes(assetTicker.toUpperCase());

  if (isFiatAsset) {
    return {
      pnl: 0,
      costBasis: tx.totalCost,
      currentValue: tx.totalCost // No price appreciation for FIAT
    };
  }

  const currentValue = tx.quantity * currentPrice;

  // If transaction has historical FX rates, use them for accurate conversion
  if (tx.exchangeRateAtPurchase && tx.purchaseCurrency) {
    // Convert cost from purchase currency to asset currency using historical rates
    const costBasisInAssetCurrency = convertCurrencySync(
      tx.totalCost,
      tx.purchaseCurrency,
      assetCurrency,
      tx.exchangeRateAtPurchase
    );

    const pnl = currentValue - costBasisInAssetCurrency;

    return {
      pnl,
      costBasis: costBasisInAssetCurrency,
      currentValue
    };
  }

  // Fallback: No FX adjustment (old transactions or missing data)
  const costBasis = tx.totalCost;
  const pnl = currentValue - costBasis;

  return {
    pnl,
    costBasis,
    currentValue
  };
};

export const AssetCard: React.FC<AssetCardProps> = ({ asset, totalPortfolioValue, onRemove, onRemoveTransaction, onRefresh, onUpdate, onEditTransaction, onSell, onQuickTransaction, closedPositions, note, onNoteClick }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ quantity: string; pricePerCoin: string; date: string; tag: TransactionTag; customTag: string }>({
    quantity: '',
    pricePerCoin: '',
    date: '',
    tag: 'DCA',
    customTag: ''
  });

  // Use asset's native currency for display
  const assetCurrency: Currency = asset.currency || 'USD';

  // P2: For stablecoins and crypto, treat as USD for currency formatting
  // Stablecoins like USDT, USDC, DAI are not valid ISO currency codes
  const displayCurrency: Currency = ['USDT', 'USDC', 'DAI', 'BTC', 'ETH', 'SOL'].includes(assetCurrency as string) ? 'USD' : assetCurrency;

  // P3 FIX: Calculate unrealized P&L from CURRENT POSITION ONLY
  // Don't sum all transactions - only calculate P&L on what you currently hold
  // WITHDRAWAL, TRANSFER, SELL transactions have already removed quantity/cost from the position

  // P3 FIX: For FIAT currencies, P&L should always be 0 (no price appreciation)
  const isFiatAsset = ['USD', 'CHF', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].includes(asset.ticker.toUpperCase());

  const currentTotalValue = asset.quantity * asset.currentPrice;

  // P4 FIX: Calculate cost basis by iterating transactions with historical FX rates
  // Convert each transaction's cost using its original currency and historical rate
  let totalCost = 0;
  for (const tx of asset.transactions) {
    if (tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME') {
      // Acquisition transactions - add to cost basis
      if (tx.exchangeRateAtPurchase && tx.purchaseCurrency) {
        // Use historical rate from transaction to convert to asset's display currency
        const costInAssetCurrency = convertCurrencySync(
          tx.totalCost,
          tx.purchaseCurrency,
          assetCurrency,
          tx.exchangeRateAtPurchase
        );
        totalCost += costInAssetCurrency;
      } else {
        // Fallback: use cost as-is (old transactions without FX data)
        totalCost += tx.totalCost;
      }
    } else if (tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER') {
      // Disposal transactions - subtract from cost basis
      if (tx.exchangeRateAtPurchase && tx.purchaseCurrency) {
        const costInAssetCurrency = convertCurrencySync(
          tx.totalCost,
          tx.purchaseCurrency,
          assetCurrency,
          tx.exchangeRateAtPurchase
        );
        totalCost -= costInAssetCurrency;
      } else {
        totalCost -= tx.totalCost;
      }
    }
  }

  const profitLoss = isFiatAsset ? 0 : (currentTotalValue - totalCost);
  const profitLossPercent = isFiatAsset ? 0 : (totalCost > 0 ? (profitLoss / totalCost) * 100 : 0);

  const isProfit = profitLoss >= 0;
  const hasHistory = asset.priceHistory && asset.priceHistory.length > 0;

  const currentAllocation = totalPortfolioValue > 0 ? (currentTotalValue / totalPortfolioValue) * 100 : 0;
  const targetAllocation = asset.targetAllocation || 0;
  const deviation = currentAllocation - targetAllocation;
  const isDeviationSignificant = targetAllocation > 0 && Math.abs(deviation) >= 5;

  const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: displayCurrency });
  const pctFmt = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, signDisplay: "always" });

  const isContractAddress = asset.ticker.startsWith('0x') && asset.ticker.length >= 40;
  
  const assetTypeConfig = ASSET_TYPE_CONFIG[asset.assetType || 'CRYPTO'];

  const handleStartEdit = (tx: any) => {
    setEditingTxId(tx.id);
    const isCustomTag = tx.tag && !['DCA', 'FOMO', 'Strategic', 'Rebalance', 'Emergency', 'Profit-Taking', 'Research'].includes(tx.tag);
    setEditForm({
      quantity: tx.quantity.toString(),
      pricePerCoin: tx.pricePerCoin.toString(),
      date: tx.date,
      tag: isCustomTag ? 'Custom' : (tx.tag || 'DCA'),
      customTag: isCustomTag ? tx.tag : ''
    });
  };

  const handleCancelEdit = () => {
    setEditingTxId(null);
    setEditForm({ quantity: '', pricePerCoin: '', date: '', tag: 'DCA', customTag: '' });
  };

  const handleSaveEdit = (txId: string) => {
    const quantity = parseFloat(editForm.quantity);
    const pricePerCoin = parseFloat(editForm.pricePerCoin);
    
    if (isNaN(quantity) || isNaN(pricePerCoin) || quantity <= 0 || pricePerCoin <= 0) {
      alert('Please enter valid positive numbers');
      return;
    }

    const finalTag = editForm.tag === 'Custom' ? editForm.customTag.trim() : editForm.tag;
    
    onEditTransaction(asset.id, txId, {
      quantity,
      pricePerCoin,
      date: editForm.date,
      tag: finalTag as TransactionTag
    });
    
    handleCancelEdit();
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 md:p-5 shadow-lg relative overflow-hidden transition-all hover:border-slate-600">
      
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-lg md:text-xl font-bold text-slate-100 uppercase flex items-center gap-1.5 md:gap-2">
              {asset.name || asset.ticker}
              {asset.error && <AlertCircle size={16} className="text-red-500" />}
              {hasHistory ? <Signal size={16} className="text-emerald-500/80" /> : <SignalLow size={16} className="text-slate-600" />}
              {isDeviationSignificant && <AlertTriangle size={16} className={deviation > 0 ? 'text-amber-500' : 'text-blue-400'} />}
            </h3>
            {/* Asset Type Badge - Inline next to title */}
            <div className={`px-2 py-0.5 rounded-md border text-[9px] font-bold flex items-center gap-1 flex-shrink-0 ${assetTypeConfig.color}`}>
              <span>{assetTypeConfig.emoji}</span>
              <span className="hidden sm:inline">{assetTypeConfig.label}</span>
              {/* Currency Badge - Only show for non-USD */}
              {asset.currency && asset.currency !== 'USD' && (
                <span className="ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  {asset.currency}
                </span>
              )}
            </div>
          </div>
          {asset.name && isContractAddress && (
            <p className="text-slate-500 text-xs font-mono mb-1">{asset.ticker.slice(0, 10)}...{asset.ticker.slice(-8)}</p>
          )}
          <p className="text-slate-400 text-sm font-mono">{asset.quantity.toLocaleString()} units</p>
        </div>
        <div className="flex items-center justify-between sm:justify-end sm:text-right gap-3 sm:ml-4 flex-shrink-0">
          {/* Asset Note Button/Icon - Moved here for mobile */}
          <button
            onClick={() => onNoteClick(asset)}
            className={`flex items-center gap-1 px-2 py-1 sm:py-0.5 rounded-md border text-[10px] font-medium transition-colors flex-shrink-0 ${
              note
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                : 'bg-slate-700/50 text-slate-400 border-slate-600 hover:bg-slate-600/50 hover:text-slate-300'
            }`}
            title={note ? note.note.substring(0, 50) + (note.note.length > 50 ? '...' : '') : 'Add note to this holding'}
          >
            <FileText size={12} />
            {note ? (
              <span className="hidden sm:inline">Note</span>
            ) : (
              <>
                <Plus size={10} className="opacity-60" />
                <span className="hidden sm:inline">Add</span>
              </>
            )}
          </button>
          <div>
            <p className="text-xl md:text-2xl font-semibold text-slate-100 whitespace-nowrap">{currencyFmt.format(currentTotalValue)}</p>
            <div className={`flex items-center justify-end gap-1 text-sm font-medium ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isProfit ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              <span className="whitespace-nowrap">{currencyFmt.format(profitLoss)} ({pctFmt.format(profitLossPercent / 100)})</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4 bg-slate-900/50 p-3 rounded-lg text-xs">
        <div>
           <p className="text-slate-500 mb-1">Market Price</p>
           <p className="text-slate-200 font-mono">{currencyFmt.format(asset.currentPrice)}</p>
        </div>
        <div className="text-right">
           <p className="text-slate-500 mb-1">Avg Buy</p>
           <p className="text-slate-200 font-mono">{currencyFmt.format(asset.avgBuyPrice)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-4 border-t border-slate-700">
        {/* Transaction action buttons - wrap on mobile */}
        <div className="flex flex-wrap gap-1.5 justify-end">
          <button
            onClick={() => onQuickTransaction(asset, 'DEPOSIT')}
            className="p-2 md:p-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 transition-colors touch-target"
            title="Deposit"
          >
            <Download size={16} className="md:w-3.5 md:h-3.5" />
          </button>
          <button
            onClick={() => onQuickTransaction(asset, 'BUY')}
            className="p-2 md:p-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 transition-colors touch-target"
            title="Buy"
          >
            <ShoppingCart size={16} className="md:w-3.5 md:h-3.5" />
          </button>
          <button
            onClick={() => onSell(asset)}
            className="p-2 md:p-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 transition-colors touch-target"
            title="Sell"
          >
            <TrendingDown size={16} className="md:w-3.5 md:h-3.5" />
          </button>
          <button
            onClick={() => onQuickTransaction(asset, 'TRANSFER')}
            className="p-2 md:p-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 transition-colors touch-target"
            title="Transfer"
          >
            <ArrowRightLeft size={16} className="md:w-3.5 md:h-3.5" />
          </button>
          <button
            onClick={() => onQuickTransaction(asset, 'WITHDRAWAL')}
            className="p-2 md:p-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 transition-colors touch-target"
            title="Withdraw"
          >
            <Upload size={16} className="md:w-3.5 md:h-3.5" />
          </button>
          <button
            onClick={() => onQuickTransaction(asset, 'INCOME')}
            className="p-2 md:p-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-400 transition-colors touch-target"
            title="Income"
          >
            <Coins size={16} className="md:w-3.5 md:h-3.5" />
          </button>
        </div>

        {/* Bottom row: Transactions toggle + Utility buttons */}
        <div className="flex items-center justify-between">
          <button onClick={() => setShowDetails(!showDetails)} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors">
            {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showDetails ? 'Hide' : 'Transactions'}
          </button>
          <div className="flex gap-1.5">
            <button onClick={() => onRefresh(asset.id)} disabled={asset.isUpdating} className={`p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all ${asset.isUpdating ? 'animate-spin' : ''}`} title="Refresh Price">
              <RefreshCw size={14} />
            </button>
            <button onClick={() => onRemove(asset.id)} className="p-1.5 rounded-lg bg-slate-700 hover:bg-red-900/50 hover:text-red-400 text-slate-300 transition-colors" title="Delete Asset">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {showDetails && (
        <div className="mt-4 space-y-4 animate-fadeIn">
          <div className="bg-slate-900/50 p-3 rounded border border-slate-700/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1">
                <Target size={12} /> Target Allocation
              </span>
              <span className="text-xs font-medium text-slate-300">
                {currentAllocation.toFixed(1)}% / {asset.targetAllocation || 0}%
              </span>
            </div>
            <input 
              type="number" 
              value={asset.targetAllocation || 0} 
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                onUpdate(asset.id, { targetAllocation: val });
              }} 
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500" 
              placeholder="Set target %" 
            />
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2 flex items-center gap-1">
              <History size={10} /> History
            </p>
            <div className="max-h-96 overflow-y-auto custom-scrollbar bg-slate-900/30 rounded border border-slate-700/50">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-800/50 text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-2">Date</th>
                    <th className="p-2">Qty</th>
                    <th className="p-2 text-right">Price</th>
                    <th className="p-2 text-right">Total</th>
                    <th className="p-2 text-right">P&L</th>
                    <th className="p-2">Tag</th>
                    <th className="p-2 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50 text-slate-300">
                  {asset.transactions.map((tx) => {
                    // P1.1B CHANGE: Use FX-adjusted P&L calculation
                    const { pnl: txPnL } = calculateFxAdjustedPnL(tx, assetCurrency, asset.ticker, asset.currentPrice, closedPositions);
                    
                    const isEditing = editingTxId === tx.id;
                    const txTag = tx.tag || 'DCA';
                    const isCustomTag = !['DCA', 'FOMO', 'Strategic', 'Rebalance', 'Emergency', 'Profit-Taking', 'Research'].includes(txTag);
                    const displayTag = isCustomTag ? txTag : txTag;

                    if (isEditing) {
                      const calculatedTotal = (parseFloat(editForm.quantity) || 0) * (parseFloat(editForm.pricePerCoin) || 0);
                      
                      return (
                        <tr key={tx.id} className="bg-indigo-900/20">
                          <td className="p-2">
                            <input
                              type="date"
                              value={editForm.date}
                              onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px] text-white"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="any"
                              value={editForm.quantity}
                              onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px] text-white font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="any"
                              value={editForm.pricePerCoin}
                              onChange={(e) => setEditForm({ ...editForm, pricePerCoin: e.target.value })}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px] text-white font-mono text-right"
                            />
                          </td>
                          <td className="p-2 text-right font-mono text-slate-400">
                            {currencyFmt.format(calculatedTotal)}
                          </td>
                          <td className="p-2"></td>
                          <td className="p-2">
                            <select
                              value={editForm.tag}
                              onChange={(e) => setEditForm({ ...editForm, tag: e.target.value as TransactionTag })}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px] text-white"
                            >
                              <option value="DCA">DCA</option>
                              <option value="FOMO">FOMO</option>
                              <option value="Strategic">Strategic</option>
                              <option value="Rebalance">Rebalance</option>
                              <option value="Emergency">Emergency</option>
                              <option value="Profit-Taking">Profit-Taking</option>
                              <option value="Research">Research</option>
                              <option value="Custom">Custom</option>
                            </select>
                            {editForm.tag === 'Custom' && (
                              <input
                                type="text"
                                value={editForm.customTag}
                                onChange={(e) => setEditForm({ ...editForm, customTag: e.target.value.slice(0, 20) })}
                                placeholder="Custom tag..."
                                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px] text-white mt-1"
                              />
                            )}
                          </td>
                          <td className="p-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleSaveEdit(tx.id)}
                                className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors"
                                title="Save"
                              >
                                <Save size={14} />
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                className="p-1 text-slate-400 hover:bg-slate-700 rounded transition-colors"
                                title="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={tx.id} className="hover:bg-white/5 group">
                        <td className="p-2 text-slate-400">
                          {tx.date}
                          {tx.lastEdited && (
                            <span 
                              className="ml-1 text-[9px] text-indigo-400 cursor-help" 
                              title={`Last edited: ${new Date(tx.lastEdited).toLocaleString()}`}
                            >
                              edited
                            </span>
                          )}
                        </td>
                        <td className="p-2 font-mono">{tx.quantity.toLocaleString()}</td>
                        <td className="p-2 text-right font-mono">{currencyFmt.format(tx.pricePerCoin)}</td>
                        <td className="p-2 text-right font-mono">{currencyFmt.format(tx.totalCost)}</td>
                        <td className={`p-2 text-right font-mono ${txPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {txPnL >= 0 ? '+' : ''}{currencyFmt.format(txPnL)}
                        </td>
                        <td className="p-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${TAG_COLORS[isCustomTag ? 'Custom' : txTag]}`}>
                            {displayTag}
                          </span>
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleStartEdit(tx)}
                              className="p-1 text-indigo-400 hover:bg-indigo-400/10 rounded transition-colors"
                              title="Edit"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button 
                              onClick={() => onRemoveTransaction(asset.id, tx.id)} 
                              className="p-1 text-slate-500 hover:text-red-400 transition-colors hover:bg-red-400/10 rounded"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};