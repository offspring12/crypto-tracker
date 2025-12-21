import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Asset, PortfolioSummary, Transaction, HistorySnapshot } from './types';
import { fetchCryptoPrice, fetchAssetHistory, delay } from './services/geminiService';
import { AssetCard } from './components/AssetCard';
import { AddAssetForm } from './components/AddAssetForm';
import { Summary } from './components/Summary';
import { LayoutDashboard, Wallet, Download, Upload, FileJson } from 'lucide-react';

const App: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>(() => {
    const saved = localStorage.getItem('portfolio_assets');
    return saved ? JSON.parse(saved) : [];
  });

  const [history, setHistory] = useState<HistorySnapshot[]>(() => {
    const saved = localStorage.getItem('portfolio_history');
    return saved ? JSON.parse(saved) : [];
  });

  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summary: PortfolioSummary = assets.reduce((acc, asset) => {
    const assetValue = asset.quantity * asset.currentPrice;
    return {
      totalValue: acc.totalValue + assetValue,
      totalCostBasis: acc.totalCostBasis + asset.totalCostBasis,
      totalPnL: acc.totalPnL + (assetValue - asset.totalCostBasis),
      totalPnLPercent: 0,
      assetCount: acc.assetCount + 1,
      lastGlobalUpdate: asset.lastUpdated > (acc.lastGlobalUpdate || '') ? asset.lastUpdated : acc.lastGlobalUpdate
    };
  }, { 
    totalValue: 0, totalCostBasis: 0, totalPnL: 0, totalPnLPercent: 0, assetCount: 0, lastGlobalUpdate: null as string | null 
  });

  if (summary.totalCostBasis > 0) {
    summary.totalPnLPercent = (summary.totalPnL / summary.totalCostBasis) * 100;
  }

  useEffect(() => localStorage.setItem('portfolio_assets', JSON.stringify(assets)), [assets]);
  useEffect(() => localStorage.setItem('portfolio_history', JSON.stringify(history)), [history]);

  const recordHistorySnapshot = useCallback((currentAssets: Asset[]) => {
    const totalValue = currentAssets.reduce((sum, a) => sum + (a.quantity * a.currentPrice), 0);
    if (totalValue === 0) return;
    const snapshot: HistorySnapshot = {
      timestamp: Date.now(),
      totalValue,
      assetValues: currentAssets.reduce((acc, a) => ({ ...acc, [a.ticker]: a.quantity * a.currentPrice }), {})
    };
    setHistory(prev => {
      const newHistory = [...prev, snapshot];
      return newHistory.length > 100 ? newHistory.slice(newHistory.length - 100) : newHistory;
    });
  }, []);

  const handleAddAsset = async (ticker: string, quantity: number, pricePerCoin: number, date: string) => {
    const totalCost = quantity * pricePerCoin;
    const newTx: Transaction = { id: Math.random().toString(36).substr(2, 9), type: 'BUY', quantity, pricePerCoin, date, totalCost };
    const existingAsset = assets.find(a => a.ticker === ticker);
    
    if (existingAsset) {
      const updatedTransactions = [...existingAsset.transactions, newTx];
      const newTotalQty = existingAsset.quantity + quantity;
      const newTotalCostBasis = existingAsset.totalCostBasis + totalCost;
      setAssets(prev => prev.map(a => a.id === existingAsset.id ? { 
        ...a, quantity: newTotalQty, transactions: updatedTransactions, totalCostBasis: newTotalCostBasis, avgBuyPrice: newTotalCostBasis / newTotalQty 
      } : a));
    } else {
      const newId = Math.random().toString(36).substr(2, 9);
      const tempAsset: Asset = { id: newId, ticker, quantity, currentPrice: 0, lastUpdated: new Date().toISOString(), sources: [], isUpdating: true, transactions: [newTx], avgBuyPrice: pricePerCoin, totalCostBasis: totalCost };
      setAssets(prev => [...prev, tempAsset]);
      try {
        const result = await fetchCryptoPrice(ticker);
        setAssets(prev => prev.map(a => a.id === newId ? { ...a, currentPrice: result.price, sources: result.sources, isUpdating: false } : a));
        const historyData = await fetchAssetHistory(ticker);
        if (historyData) setAssets(prev => prev.map(a => a.id === newId ? { ...a, priceHistory: historyData } : a));
      } catch (error) {
         setAssets(prev => prev.map(a => a.id === newId ? { ...a, isUpdating: false, error: 'Failed' } : a));
      }
    }
  };

  const handleRemoveTransaction = (assetId: string, txId: string) => {
    setAssets(prev => {
      return prev.map(asset => {
        if (asset.id !== assetId) return asset;
        const updatedTxs = asset.transactions.filter(tx => tx.id !== txId);
        if (updatedTxs.length === 0) return null;
        const newQty = updatedTxs.reduce((sum, tx) => sum + tx.quantity, 0);
        const newCost = updatedTxs.reduce((sum, tx) => sum + tx.totalCost, 0);
        return { ...asset, transactions: updatedTxs, quantity: newQty, totalCostBasis: newCost, avgBuyPrice: newCost / newQty };
      }).filter(a => a !== null) as Asset[];
    });
  };

  const handleRefreshAll = async () => {
    if (isLoading) return;
    setIsLoading(true);
    const updated = [...assets];
    for (let i = 0; i < updated.length; i++) {
      try {
        const res = await fetchCryptoPrice(updated[i].ticker);
        updated[i] = { ...updated[i], currentPrice: res.price, lastUpdated: new Date().toISOString() };
        setAssets([...updated]);
        await delay(300);
      } catch (e) {}
    }
    recordHistorySnapshot(updated);
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-20">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg"><Wallet className="text-white" size={24} /></div>
            <h1 className="text-xl font-bold text-white">Portfolio Tracker</h1>
          </div>
          <div className="flex items-center gap-2">
             <input type="file" ref={fileInputRef} onChange={(e) => {}} accept=".json" className="hidden" />
             <button onClick={() => {}} className="p-2 text-slate-400 hover:text-white"><Upload size={20} /></button>
             <button onClick={() => {}} className="p-2 text-slate-400 hover:text-white"><Download size={20} /></button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Summary summary={summary} assets={assets} onRefreshAll={handleRefreshAll} isGlobalLoading={isLoading} />
        <AddAssetForm onAdd={handleAddAsset} isGlobalLoading={isLoading} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {assets.map(asset => (
            <AssetCard key={asset.id} asset={asset} totalPortfolioValue={summary.totalValue} onRemoveTransaction={handleRemoveTransaction} onRefresh={() => {}} onRemove={() => setAssets(prev => prev.filter(a => a.id !== asset.id))} onUpdate={() => {}} onRetryHistory={() => {}} />
          ))}
        </div>
      </main>
    </div>
  );
};

export default App;