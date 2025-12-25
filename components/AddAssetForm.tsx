import React, { useState } from 'react';
import { Asset, TransactionTag, TAG_COLORS } from '../types';
import { Trash2, RefreshCw, ChevronDown, ChevronUp, AlertCircle, History, TrendingUp, TrendingDown, Signal, SignalLow, Target, AlertTriangle, Edit2, Check, X, Tag } from 'lucide-react';

interface AssetCardProps {
  asset: Asset;
  totalPortfolioValue: number;
  onRemove: (id: string) => void;
  onRemoveTransaction: (assetId: string, txId: string) => void;
  onRefresh: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Asset>) => void;
  onRetryHistory: (id: string) => void;
  onEditTransaction: (assetId: string, txId: string, updates: { quantity: number; pricePerCoin: number; date: string; tag: TransactionTag; customTag?: string }) => void;
}

const TAG_OPTIONS: TransactionTag[] = ['DCA', 'FOMO', 'Strategic', 'Swing Trade', 'Long-term Hold', 'Dip Buy', 'Custom'];

export const AssetCard: React.FC<AssetCardProps> = ({ 
  asset, 
  totalPortfolioValue, 
  onRemove, 
  onRemoveTransaction, 
  onRefresh, 
  onUpdate, 
  onEditTransaction 
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ quantity: '', pricePerCoin: '', date: '', tag: 'DCA' as TransactionTag, customTag: '' });

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

  const handleStartEdit = (tx: any) => {
    setEditingTxId(tx.id);
    setEditForm({
      quantity: tx.quantity.toString(),
      pricePerCoin: tx.pricePerCoin.toString(),
      date: tx.date,
      tag: tx.tag || 'DCA',
      customTag: tx.customTag || ''
    });
  };

  const handleSaveEdit = (txId: string) => {
    const quantity = parseFloat(editForm.quantity);
    const pricePerCoin = parseFloat(editForm.pricePerCoin);
    
    if (isNaN(quantity) || isNaN(pricePerCoin) || quantity <= 0 || pricePerCoin <= 0) {
      alert('Please enter valid positive numbers');
      return;
    }

    onEditTransaction(asset.id, txId, {
      quantity,
      pricePerCoin,
      date: editForm.date,
      tag: editForm.tag,
      customTag: editForm.tag === 'Custom' ? editForm.customTag : undefined
    });
    
    setEditingTxId(null);
  };

  const handleCancelEdit = () => {
    setEditingTxId(null);
    setEditForm({ quantity: '', pricePerCoin: '', date: '', tag: 'DCA', customTag: '' });
  };

  const getTagDisplay = (tx: any) => {
    const tagText = tx.tag === 'Custom' && tx.customTag ? tx.customTag : tx.tag;
    const tagColor = TAG_COLORS[tx.tag as TransactionTag] || TAG_COLORS['Custom'];
    
    return (
      <span 
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium"
        style={{ backgroundColor: `${tagColor}20`, color: tagColor, borderColor: `${tagColor}40`, borderWidth: '1px' }}
      >
        <Tag size={10} />
        {tagText}
      </span>
    );
  };

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
              <History size={10} /> Transaction History
            </p>
            <div className="max-h-96 overflow-y-auto custom-scrollbar bg-slate-900/30 rounded border border-slate-700/50">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-800/50 text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-2">Date</th>
                    <th className="p-2">Qty</th>
                    <th className="p-2 text-right">Price</th>
                    <th className="p-2 text-right">Cost</th>
                    <th className="p-2 text-right">P&L</th>
                    <th className="p-2">Tag</th>
                    <th className="p-2 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50 text-slate-300">
                  {asset.transactions.map((tx) => {
                    const txPnL = (tx.quantity * asset.currentPrice) - tx.totalCost;
                    const isEditing = editingTxId === tx.id;
                    
                    if (isEditing) {
                      return (
                        <tr key={tx.id} className="bg-indigo-900/10">
                          <td className="p-2">
                            <input
                              type="date"
                              value={editForm.date}
                              onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-[11px] text-white [color-scheme:dark]"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="any"
                              value={editForm.quantity}
                              onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-[11px] text-white font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="any"
                              value={editForm.pricePerCoin}
                              onChange={(e) => setEditForm({ ...editForm, pricePerCoin: e.target.value })}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-[11px] text-white font-mono text-right"
                            />
                          </td>
                          <td className="p-2 text-right font-mono text-slate-400">
                            {currencyFmt.format((parseFloat(editForm.quantity) || 0) * (parseFloat(editForm.pricePerCoin) || 0))}
                          </td>
                          <td className="p-2 text-right">-</td>
                          <td className="p-2">
                            <select
                              value={editForm.tag}
                              onChange={(e) => setEditForm({ ...editForm, tag: e.target.value as TransactionTag })}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-[10px] text-white"
                              style={{ color: TAG_COLORS[editForm.tag] }}
                            >
                              {TAG_OPTIONS.map(tagOption => (
                                <option key={tagOption} value={tagOption} style={{ color: TAG_COLORS[tagOption] }}>
                                  {tagOption}
                                </option>
                              ))}
                            </select>
                            {editForm.tag === 'Custom' && (
                              <input
                                type="text"
                                value={editForm.customTag}
                                onChange={(e) => setEditForm({ ...editForm, customTag: e.target.value })}
                                placeholder="Custom tag..."
                                className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-[10px] text-white mt-1"
                                maxLength={20}
                              />
                            )}
                          </td>
                          <td className="p-2 text-right">
                            <div className="flex gap-1">
                              <button 
                                onClick={() => handleSaveEdit(tx.id)} 
                                className="text-emerald-400 hover:text-emerald-300 transition-colors p-1 rounded hover:bg-emerald-400/10"
                                title="Save"
                              >
                                <Check size={14} />
                              </button>
                              <button 
                                onClick={handleCancelEdit} 
                                className="text-slate-400 hover:text-slate-300 transition-colors p-1 rounded hover:bg-slate-400/10"
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
                          <div className="flex flex-col">
                            <span 
                              className="cursor-help"
                              title={tx.lastEdited 
                                ? `Added: ${new Date(tx.createdAt).toLocaleString()}\nLast edited: ${new Date(tx.lastEdited).toLocaleString()}` 
                                : `Added: ${new Date(tx.createdAt).toLocaleString()}`
                              }
                            >
                              {tx.date}
                            </span>
                            {tx.lastEdited && (
                              <span className="text-[9px] text-slate-600 flex items-center gap-1">
                                <Edit2 size={8} /> edited
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2 font-mono">{tx.quantity.toLocaleString()}</td>
                        <td className="p-2 text-right font-mono">{currencyFmt.format(tx.pricePerCoin)}</td>
                        <td className="p-2 text-right font-mono">{currencyFmt.format(tx.totalCost)}</td>
                        <td className={`p-2 text-right font-mono ${txPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {txPnL >= 0 ? '+' : ''}{currencyFmt.format(txPnL)}
                        </td>
                        <td className="p-2">
                          {getTagDisplay(tx)}
                        </td>
                        <td className="p-2 text-right">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => handleStartEdit(tx)} 
                              className="text-slate-500 hover:text-indigo-400 transition-colors p-1 rounded hover:bg-indigo-400/10"
                              title="Edit transaction"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button 
                              onClick={() => onRemoveTransaction(asset.id, tx.id)} 
                              className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-400/10"
                              title="Delete transaction"
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