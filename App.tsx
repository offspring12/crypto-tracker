import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Asset, PortfolioSummary, Transaction, HistorySnapshot } from './types';
import { fetchCryptoPrice, fetchAssetHistory, delay } from './services/geminiService';
import { AssetCard } from './components/AssetCard';
import { AddAssetForm } from './components/AddAssetForm';
import { Summary } from './components/Summary';
import { ApiKeySettings } from './components/ApiKeySettings';
import { Wallet, Download, Upload, Settings, Key } from 'lucide-react';

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if API key exists
  useEffect(() => {
    const checkApiKey = () => {
      const key = localStorage.getItem('gemini_api_key');
      setHasApiKey(!!key);
    };
    checkApiKey();
    // Check again when settings modal closes
    window.addEventListener('storage', checkApiKey);
    return () => window.removeEventListener('storage', checkApiKey);
  }, [isSettingsOpen]);

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
      return newHistory.length > 200 ? newHistory.slice(newHistory.length - 200) : newHistory;
    });
  }, []);

  const handleUpdateAsset = (id: string, updates: Partial<Asset>) => {
    setAssets(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  };

  const handleRefreshAsset = async (id: string) => {
    const asset = assets.find(a => a.id === id);
    if (!asset) return;
    
    setAssets(prev => prev.map(a => a.id === id ? { ...a, isUpdating: true } : a));
    try {
      const result = await fetchCryptoPrice(asset.ticker);
      setAssets(prev => prev.map(a => a.id === id ? { 
        ...a, 
        currentPrice: result.price, 
        sources: result.sources, 
        lastUpdated: new Date().toISOString(),
        isUpdating: false,
        error: undefined 
      } : a));
    } catch (error: any) {
       setAssets(prev => prev.map(a => a.id === id ? { ...a, isUpdating: false, error: error.message || 'Failed' } : a));
    }
  };

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
      } catch (error: any) {
         setAssets(prev => prev.map(a => a.id === newId ? { ...a, isUpdating: false, error: error.message || 'Failed' } : a));
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

  const exportPortfolio = () => {
    const dataStr = JSON.stringify({ assets, history }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `portfolio-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  const importPortfolio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.assets) setAssets(parsed.assets);
        if (parsed.history) setHistory(parsed.history);
      } catch (err) {
        alert("Invalid portfolio file.");
      }
    };
    reader.readAsText(file);
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
             <button 
               onClick={() => setIsSettingsOpen(true)} 
               className={`p-2 rounded-lg transition-colors ${hasApiKey ? 'text-emerald-400 hover:text-emerald-300' : 'text-amber-400 hover:text-amber-300 animate-pulse'}`}
               title={hasApiKey ? "API Key Configured" : "Configure API Key"}
             >
               {hasApiKey ? <Key size={20} /> : <Settings size={20} />}
             </button>
             <input type="file" ref={fileInputRef} onChange={importPortfolio} accept=".json" className="hidden" />
             <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-white" title="Import Data"><Upload size={20} /></button>
             <button onClick={exportPortfolio} className="p-2 text-slate-400 hover:text-white" title="Export Data"><Download size={20} /></button>
          </div>
        </div>
      </header>

      {!hasApiKey && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-start gap-3">
            <Key className="text-amber-400 flex-shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <p className="text-amber-200 font-medium mb-1">API Key Required</p>
              <p className="text-amber-200/80 text-sm mb-3">
                To fetch cryptocurrency prices, you need to configure your Gemini API key.
              </p>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Configure API Key
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Summary summary={summary} assets={assets} onRefreshAll={handleRefreshAll} isGlobalLoading={isLoading} />
        <AddAssetForm onAdd={handleAddAsset} isGlobalLoading={isLoading} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {assets.map(asset => (
            <AssetCard 
              key={asset.id} 
              asset={asset} 
              totalPortfolioValue={summary.totalValue} 
              onRemoveTransaction={handleRemoveTransaction} 
              onRefresh={handleRefreshAsset} 
              onRemove={() => setAssets(prev => prev.filter(a => a.id !== asset.id))} 
              onUpdate={handleUpdateAsset} 
              onRetryHistory={() => {}} 
            />
          ))}
        </div>
      </main>

      <ApiKeySettings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
};

export default App;