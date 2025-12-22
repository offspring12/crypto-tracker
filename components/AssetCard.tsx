import React, { useState } from 'react';
import { Asset } from '../types';
import { Trash2, RefreshCw, ChevronDown, ChevronUp, AlertCircle, History, TrendingUp, TrendingDown, Signal, SignalLow, Target, AlertTriangle } from 'lucide-react';

interface AssetCardProps {
  asset: Asset;
  totalPortfolioValue: number;
  onRemove: (id: string) => void;
  onRemoveTransaction: (assetId: string, txId: string) => void;
  onRefresh: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Asset>) => void;
  onRetryHistory: (id: string) => void;
}

export const AssetCard: React.FC<AssetCardProps> = ({ asset, totalPortfolioValue, onRemove, onRemoveTransaction, onRefresh, onUpdate }) => {
  const [showDetails, setShowDetails] = useState(false);

  const currentTotalValue = asset.quantity * asset.currentPrice;
  const totalCost = asset.totalCostBasis;
  const profitLoss = currentTotalValue - totalCost;
  const profitLossPercent = totalCost > 0 ? (profitLoss / totalCost) * 100 : 0;
  
  const isProfit = profitLoss >= 0;
  const hasHistory = asset.priceHistory && asset.priceHistory.length > 0;

  const currentAllocation = totalPortfolioValue > 0 ? (currentTotalValue / totalPortfolioValue) * 100 : 0;
  const targetAllocation = asset.targetAllocation || 0;
  const deviation = currentAllocation - targetAllocation;
  const isDeviationSignificant = targetAllocation > 0 && Math.abs(deviation) >= 5;

  const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const pctFmt = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, signDisplay: "always" });

  const isContractAddress = asset.ticker.startsWith('0x') && asset.ticker.length >= 40;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg relative overflow-hidden transition-all hover:border-slate-600">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="text-xl font-bold text-slate-100 uppercase flex items-center gap-2">
            {asset.name || asset.ticker}
            {asset.error && <AlertCircle size={16} className="text-red-500" />}
            {hasHistory ? <Signal size={16} className="text-emerald-500/80" /> : <SignalLow size={16} className="text-slate-600" />}
            {isDeviationSignificant && <AlertTriangle size={16} className={deviation > 0 ? 'text-amber-500' : 'text-blue-400'} />}
          </h3>
          {asset.name && isContractAddress && (
            <p className="text-slate-500 text-xs font-mono mb-1">{asset.ticker.slice(0, 10)}...{asset.ticker.slice(-8)}</p>
          )}
          <p className="text-slate-400 text-sm font-mono">{asset.quantity.toLocaleString()} units</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-slate-100">{currencyFmt.format(currentTotalValue)}</p>
          <div className={`flex items-center justify-end gap-1 text-sm font-medium ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isProfit ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{currencyFmt.format(profitLoss)} ({pctFmt.format(profitLossPercent / 100)})</span>
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

      <div className="flex items-center justify-between pt-4 border-t border-slate-700">
        <button onClick={() => setShowDetails(!showDetails)} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors">
          {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showDetails ? 'Hide' : 'Transactions'}
        </button>
        <div className="flex gap-2">
           <button onClick={() => onRefresh(asset.id)} disabled={asset.isUpdating} className={`p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all ${asset.isUpdating ? 'animate-spin' : ''}`}>
            <RefreshCw size={16} />
          </button>
          <button onClick={() => onRemove(asset.id)} className="p-2 rounded-lg bg-slate-700 hover:bg-red-900/50 hover:text-red-400 text-slate-300 transition-colors">
            <Trash2 size={16} />
          </button>
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
            <div className="max-h-48 overflow-y-auto custom-scrollbar bg-slate-900/30 rounded border border-slate-700/50">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-800/50 text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-2">Date</th>
                    <th className="p-2">Qty</th>
                    <th className="p-2 text-right">Cost</th>
                    <th className="p-2 text-right">P&L</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50 text-slate-300">
                  {asset.transactions.map((tx) => {
                    const txPnL = (tx.quantity * asset.currentPrice) - tx.totalCost;
                    return (
                      <tr key={tx.id} className="hover:bg-white/5">
                        <td className="p-2 text-slate-400">{tx.date}</td>
                        <td className="p-2 font-mono">{tx.quantity}</td>
                        <td className="p-2 text-right font-mono">{currencyFmt.format(tx.totalCost)}</td>
                        <td className={`p-2 text-right font-mono ${txPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {txPnL >= 0 ? '+' : ''}{currencyFmt.format(txPnL)}
                        </td>
                        <td className="p-2 text-right">
                          <button 
                            onClick={() => onRemoveTransaction(asset.id, tx.id)} 
                            className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-400/10"
                          >
                            <Trash2 size={12} />
                          </button>
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