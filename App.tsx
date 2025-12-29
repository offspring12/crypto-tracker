import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Asset, Portfolio, PortfolioSummary, Transaction, HistorySnapshot, TransactionTag, Currency } from './types';
import { fetchCryptoPrice, fetchAssetHistory, delay } from './services/geminiService';
import { fetchExchangeRates } from './services/currencyService';
import { AssetCard } from './components/AssetCard';
import { AddAssetForm } from './components/AddAssetForm';
import { Summary } from './components/Summary';
import { TagAnalytics } from './components/TagAnalytics';
import { ApiKeySettings } from './components/ApiKeySettings';
import { PortfolioManager } from './components/PortfolioManager';
import { Wallet, Download, Upload, Settings, Key, FolderOpen, Plus, Check } from 'lucide-react';

// Portfolio colors for visual distinction
const PORTFOLIO_COLORS = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#f43f5e', // Rose
  '#14b8a6', // Teal
];

// Migration: Convert old structure to new portfolio structure
const migrateToPortfolios = (): Portfolio[] => {
  const oldAssets = localStorage.getItem('portfolio_assets');
  const oldHistory = localStorage.getItem('portfolio_history');
  
  if (!oldAssets && !oldHistory) {
    // No old data, return default empty portfolio
    return [{
      id: Math.random().toString(36).substr(2, 9),
      name: 'Main Portfolio',
      color: PORTFOLIO_COLORS[0],
      assets: [],
      history: [],
      settings: {},
      createdAt: new Date().toISOString()
    }];
  }
  
  // Migrate old data to new structure
  const assets: Asset[] = oldAssets ? JSON.parse(oldAssets) : [];
  const history: HistorySnapshot[] = oldHistory ? JSON.parse(oldHistory) : [];
  
  const migratedPortfolio: Portfolio = {
    id: Math.random().toString(36).substr(2, 9),
    name: 'Main Portfolio',
    color: PORTFOLIO_COLORS[0],
    assets,
    history,
    settings: {},
    createdAt: new Date().toISOString()
  };
  
  // Clean up old keys
  localStorage.removeItem('portfolio_assets');
  localStorage.removeItem('portfolio_history');
  
  console.log('✅ Migrated old portfolio data to new structure');
  return [migratedPortfolio];
};

// Migrate transactions to include required tags and currency
const migrateTransactionTags = (portfolios: Portfolio[]): Portfolio[] => {
  return portfolios.map(portfolio => ({
    ...portfolio,
    assets: portfolio.assets.map(asset => ({
      ...asset,
      assetType: asset.assetType || 'CRYPTO', // Default to CRYPTO
      currency: asset.currency || 'USD', // Default to USD
      transactions: asset.transactions.map(tx => ({
        ...tx,
        tag: tx.tag || 'DCA', // Default untagged transactions to DCA
        createdAt: tx.createdAt || tx.date || new Date().toISOString() // Use transaction date as createdAt if missing
      }))
    }))
  }));
};

const App: React.FC = () => {
  const [portfolios, setPortfolios] = useState<Portfolio[]>(() => {
    const saved = localStorage.getItem('portfolios');
    if (saved) {
      const parsed = JSON.parse(saved);
      return migrateTransactionTags(parsed); // Migrate old data
    }
    // Migration or first load
    return migrateToPortfolios();
  });

  const [activePortfolioId, setActivePortfolioId] = useState<string>(() => {
    const saved = localStorage.getItem('active_portfolio_id');
    return saved || portfolios[0]?.id || '';
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPortfolioManagerOpen, setIsPortfolioManagerOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // P1.1 CHANGE: Lift displayCurrency and exchangeRates to App level
  const [displayCurrency, setDisplayCurrency] = useState<Currency>('USD');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});

  // Get active portfolio
  const activePortfolio = portfolios.find(p => p.id === activePortfolioId) || portfolios[0];
  const assets = activePortfolio?.assets || [];
  const history = activePortfolio?.history || [];

  // Calculate summary - values are aggregated by Summary.tsx with currency conversion
  const summary: PortfolioSummary = useMemo(() => {
    // Don't convert currencies here - Summary.tsx handles display currency conversion
    // Just aggregate the raw values in their native currencies
    const assetData = assets.map(asset => ({
      value: asset.quantity * asset.currentPrice,
      costBasis: asset.totalCostBasis,
      currency: asset.currency || 'USD'
    }));

    // For a multi-currency portfolio, we can't accurately calculate totals here
    // Summary.tsx will convert each asset to display currency and sum them
    // For now, return placeholder values that Summary.tsx will override
    return {
      totalValue: 0, // Will be calculated in Summary.tsx
      totalCostBasis: 0, // Will be calculated in Summary.tsx
      totalPnL: 0, // Will be calculated in Summary.tsx
      totalPnLPercent: 0, // Will be calculated in Summary.tsx
      assetCount: assets.length,
      lastGlobalUpdate: assets.reduce((latest, a) => 
        a.lastUpdated > latest ? a.lastUpdated : latest, 
        assets[0]?.lastUpdated || null
      )
    };
  }, [assets]);

  useEffect(() => {
    const checkApiKey = () => {
      const key = localStorage.getItem('gemini_api_key');
      setHasApiKey(!!key);
    };
    checkApiKey();
    window.addEventListener('storage', checkApiKey);
    return () => window.removeEventListener('storage', checkApiKey);
  }, [isSettingsOpen]);

  // P1.1 CHANGE: Load exchange rates on mount
  useEffect(() => {
    const loadRates = async () => {
      const rates = await fetchExchangeRates();
      setExchangeRates(rates);
      console.log('💱 App: Exchange rates loaded:', rates);
    };
    loadRates();
  }, []);

  // Save portfolios to localStorage
  useEffect(() => {
    localStorage.setItem('portfolios', JSON.stringify(portfolios));
  }, [portfolios]);

  // Save active portfolio ID
  useEffect(() => {
    localStorage.setItem('active_portfolio_id', activePortfolioId);
  }, [activePortfolioId]);

  const updateActivePortfolio = (updater: (portfolio: Portfolio) => Portfolio) => {
    setPortfolios(prev => prev.map(p => 
      p.id === activePortfolioId ? updater(p) : p
    ));
  };

  const recordHistorySnapshot = useCallback((currentAssets: Asset[]) => {
    const totalValue = currentAssets.reduce((sum, a) => sum + (a.quantity * a.currentPrice), 0);
    if (totalValue === 0) return;
    const snapshot: HistorySnapshot = {
      timestamp: Date.now(),
      totalValue,
      assetValues: currentAssets.reduce((acc, a) => ({ ...acc, [a.ticker]: a.quantity * a.currentPrice }), {})
    };
    updateActivePortfolio(portfolio => ({
      ...portfolio,
      history: [...portfolio.history, snapshot].slice(-200) // Keep last 200
    }));
  }, [activePortfolioId]);

  const handleUpdateAsset = (id: string, updates: Partial<Asset>) => {
    updateActivePortfolio(portfolio => ({
      ...portfolio,
      assets: portfolio.assets.map(a => a.id === id ? { ...a, ...updates } : a)
    }));
  };

  const handleRefreshAsset = async (id: string) => {
    const asset = assets.find(a => a.id === id);
    if (!asset) return;
    
    updateActivePortfolio(portfolio => ({
      ...portfolio,
      assets: portfolio.assets.map(a => a.id === id ? { ...a, isUpdating: true } : a)
    }));
    
    try {
      const result = await fetchCryptoPrice(asset.ticker);
      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: portfolio.assets.map(a => a.id === id ? { 
          ...a, 
          currentPrice: result.price, 
          sources: result.sources, 
          lastUpdated: new Date().toISOString(),
          isUpdating: false,
          error: undefined,
          name: result.name || result.symbol || a.name,
          currency: result.currency || 'USD' // ✅ Store currency from API
        } : a)
      }));
    } catch (error: any) {
      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: portfolio.assets.map(a => a.id === id ? { ...a, isUpdating: false, error: error.message || 'Failed' } : a)
      }));
    }
  };

  const handleAddAsset = async (ticker: string, quantity: number, pricePerCoin: number, date: string, currency: Currency = 'USD', tag?: string) => {
    const totalCost = quantity * pricePerCoin;
    const newTx: Transaction = { 
      id: Math.random().toString(36).substr(2, 9), 
      type: 'BUY', 
      quantity, 
      pricePerCoin, 
      date, 
      totalCost,
      tag: tag || 'DCA', // Use provided tag or default to DCA
      createdAt: new Date().toISOString()
    };
    const existingAsset = assets.find(a => a.ticker === ticker);
    
    if (existingAsset) {
      const updatedTransactions = [...existingAsset.transactions, newTx];
      const newTotalQty = existingAsset.quantity + quantity;
      const newTotalCostBasis = existingAsset.totalCostBasis + totalCost;
      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: portfolio.assets.map(a => a.id === existingAsset.id ? { 
          ...a, 
          quantity: newTotalQty, 
          transactions: updatedTransactions, 
          totalCostBasis: newTotalCostBasis, 
          avgBuyPrice: newTotalCostBasis / newTotalQty 
        } : a)
      }));
    } else {
      const newId = Math.random().toString(36).substr(2, 9);
      
      const tempAsset: Asset = { 
        id: newId, 
        ticker, 
        name: undefined,
        quantity, 
        currentPrice: 0, 
        lastUpdated: new Date().toISOString(), 
        sources: [], 
        isUpdating: true, 
        transactions: [newTx], 
        avgBuyPrice: pricePerCoin, 
        totalCostBasis: totalCost,
        assetType: undefined, // Will be auto-detected by API
        currency: currency // Store the currency
      };
      
      updateActivePortfolio(portfolio => ({
        ...portfolio,
        assets: [...portfolio.assets, tempAsset]
      }));
      
      try {
        const result = await fetchCryptoPrice(ticker);
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.map(a => a.id === newId ? { 
            ...a, 
            currentPrice: result.price, 
            sources: result.sources, 
            isUpdating: false,
            name: result.name || result.symbol || a.name,
            assetType: result.assetType || 'CRYPTO', // Auto-detect from API
            currency: result.currency || 'USD' // ✅ Store currency from API
          } : a)
        }));
        
        const historyData = await fetchAssetHistory(ticker, result.price, result.symbol, result.assetType);
        if (historyData) {
          updateActivePortfolio(portfolio => ({
            ...portfolio,
            assets: portfolio.assets.map(a => a.id === newId ? { ...a, priceHistory: historyData } : a)
          }));
        }
      } catch (error: any) {
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: portfolio.assets.map(a => a.id === newId ? { ...a, isUpdating: false, error: error.message || 'Failed' } : a)
        }));
      }
    }
  };

  const handleRemoveTransaction = (assetId: string, txId: string) => {
    updateActivePortfolio(portfolio => ({
      ...portfolio,
      assets: portfolio.assets.map(asset => {
        if (asset.id !== assetId) return asset;
        const updatedTxs = asset.transactions.filter(tx => tx.id !== txId);
        if (updatedTxs.length === 0) return null;
        const newQty = updatedTxs.reduce((sum, tx) => sum + tx.quantity, 0);
        const newCost = updatedTxs.reduce((sum, tx) => sum + tx.totalCost, 0);
        return { ...asset, transactions: updatedTxs, quantity: newQty, totalCostBasis: newCost, avgBuyPrice: newCost / newQty };
      }).filter(a => a !== null) as Asset[]
    }));
  };

  const handleEditTransaction = (assetId: string, txId: string, updates: { quantity: number; pricePerCoin: number; date: string; tag: TransactionTag; customTag?: string }) => {
    updateActivePortfolio(portfolio => ({
      ...portfolio,
      assets: portfolio.assets.map(asset => {
        if (asset.id !== assetId) return asset;
        
        const updatedTransactions = asset.transactions.map(tx => {
          if (tx.id !== txId) return tx;
          
          return {
            ...tx,
            quantity: updates.quantity,
            pricePerCoin: updates.pricePerCoin,
            date: updates.date,
            totalCost: updates.quantity * updates.pricePerCoin,
            tag: updates.tag,
            customTag: updates.customTag,
            lastEdited: new Date().toISOString()
          };
        });
        
        const newQty = updatedTransactions.reduce((sum, tx) => sum + tx.quantity, 0);
        const newCost = updatedTransactions.reduce((sum, tx) => sum + tx.totalCost, 0);
        
        return {
          ...asset,
          transactions: updatedTransactions,
          quantity: newQty,
          totalCostBasis: newCost,
          avgBuyPrice: newCost / newQty
        };
      })
    }));
  };

  const handleRefreshAll = async () => {
    if (isLoading) return;
    setIsLoading(true);
    const updated = [...assets];
    for (let i = 0; i < updated.length; i++) {
      try {
        const res = await fetchCryptoPrice(updated[i].ticker);
        updated[i] = { ...updated[i], currentPrice: res.price, lastUpdated: new Date().toISOString(), name: res.name || res.symbol || updated[i].name };
        updateActivePortfolio(portfolio => ({
          ...portfolio,
          assets: [...updated]
        }));
        await delay(300);
      } catch (e) {}
    }
    recordHistorySnapshot(updated);
    setIsLoading(false);
  };

  const exportPortfolio = () => {
    // Export ALL portfolios + price snapshots + deleted portfolios
    const snapshots: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('price_snapshots_')) {
        const ticker = key.replace('price_snapshots_', '');
        const data = localStorage.getItem(key);
        if (data) snapshots[ticker] = JSON.parse(data);
      }
    }
    
    const deletedPortfolios = JSON.parse(localStorage.getItem('deleted_portfolios') || '[]');
    
    const dataStr = JSON.stringify({ 
      portfolios, 
      deletedPortfolios,
      priceSnapshots: snapshots 
    }, null, 2);
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
        
        if (parsed.portfolios) {
          setPortfolios(parsed.portfolios);
          setActivePortfolioId(parsed.portfolios[0]?.id || '');
        } else if (parsed.assets) {
          // Old format - migrate
          const migratedPortfolios = migrateToPortfolios();
          setPortfolios(migratedPortfolios);
          setActivePortfolioId(migratedPortfolios[0].id);
        }
        
        if (parsed.priceSnapshots) {
          Object.entries(parsed.priceSnapshots).forEach(([ticker, snapshots]) => {
            localStorage.setItem(`price_snapshots_${ticker}`, JSON.stringify(snapshots));
          });
        }
        
        alert("Portfolio imported successfully!");
      } catch (err) {
        alert("Invalid portfolio file.");
      }
    };
    reader.readAsText(file);
  };

  // Portfolio management functions
  const handleCreatePortfolio = (name: string) => {
    const newPortfolio: Portfolio = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      color: PORTFOLIO_COLORS[portfolios.length % PORTFOLIO_COLORS.length],
      assets: [],
      history: [],
      settings: {},
      createdAt: new Date().toISOString()
    };
    setPortfolios([...portfolios, newPortfolio]);
    setActivePortfolioId(newPortfolio.id);
  };

  const handleRenamePortfolio = (id: string, newName: string) => {
    setPortfolios(prev => prev.map(p => 
      p.id === id ? { ...p, name: newName } : p
    ));
  };

  const handleDeletePortfolio = (id: string) => {
    if (portfolios.length === 1) {
      alert("Cannot delete the last portfolio!");
      return;
    }
    
    const portfolio = portfolios.find(p => p.id === id);
    if (portfolio && portfolio.assets.length > 0) {
      const confirmed = window.confirm(
        `"${portfolio.name}" contains ${portfolio.assets.length} asset(s). Are you sure you want to delete it? It will be saved in deleted portfolios (can be restored from export).`
      );
      if (!confirmed) return;
    }
    
    // Save to deleted portfolios before removing
    if (portfolio) {
      const deletedPortfolios = JSON.parse(localStorage.getItem('deleted_portfolios') || '[]');
      deletedPortfolios.push({
        ...portfolio,
        deletedAt: new Date().toISOString()
      });
      localStorage.setItem('deleted_portfolios', JSON.stringify(deletedPortfolios));
      console.log(`💾 Saved deleted portfolio "${portfolio.name}" to backup`);
    }
    
    setPortfolios(prev => prev.filter(p => p.id !== id));
    if (activePortfolioId === id) {
      setActivePortfolioId(portfolios.find(p => p.id !== id)?.id || '');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-20">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg"><Wallet className="text-white" size={24} /></div>
            <h1 className="text-xl font-bold text-white">Portfolio Tracker</h1>
            {activePortfolio && (
              <div className="relative group">
                <button 
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 transition-colors"
                  style={{ borderLeftColor: activePortfolio.color, borderLeftWidth: '3px' }}
                >
                  <FolderOpen size={16} style={{ color: activePortfolio.color }} />
                  <span className="text-sm font-medium" style={{ color: activePortfolio.color }}>
                    {activePortfolio.name}
                  </span>
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {/* Dropdown Menu */}
                <div className="absolute top-full left-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <div className="p-2 max-h-80 overflow-y-auto">
                    {portfolios.map(portfolio => (
                      <button
                        key={portfolio.id}
                        onClick={() => setActivePortfolioId(portfolio.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                          portfolio.id === activePortfolioId
                            ? 'bg-indigo-600/20 text-indigo-400'
                            : 'hover:bg-slate-700/50 text-slate-300'
                        }`}
                      >
                        <div 
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: portfolio.color }}
                        />
                        <span className="flex-1 text-sm font-medium">{portfolio.name}</span>
                        {portfolio.id === activePortfolioId && (
                          <Check size={14} className="text-indigo-400" />
                        )}
                      </button>
                    ))}
                    <div className="border-t border-slate-700 mt-2 pt-2">
                      <button
                        onClick={() => setIsPortfolioManagerOpen(true)}
                        className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-700/50 transition-colors"
                      >
                        <Plus size={14} />
                        <span className="text-sm font-medium">New Portfolio</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsPortfolioManagerOpen(true)} 
              className="p-2 text-slate-400 hover:text-white transition-colors"
              title="Manage Portfolios"
            >
              <FolderOpen size={20} />
            </button>
            <button 
              onClick={() => setIsSettingsOpen(true)} 
              className={`p-2 rounded-lg transition-colors ${hasApiKey ? 'text-emerald-400 hover:text-emerald-300' : 'text-amber-400 hover:text-amber-300 animate-pulse'}`}
              title={hasApiKey ? "API Key Configured" : "Configure API Key"}
            >
              {hasApiKey ? <Key size={20} /> : <Settings size={20} />}
            </button>
            <input type="file" ref={fileInputRef} onChange={importPortfolio} accept=".json" className="hidden" />
            <button onClick={exportPortfolio} className="p-2 text-slate-400 hover:text-white" title="Export Data"><Upload size={20} /></button>
            <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-white" title="Import Data"><Download size={20} /></button>
          </div>
        </div>
      </header>

      {!hasApiKey && (
        <div className="max-w-screen-2xl mx-auto px-8 pt-4">
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

      <main className="max-w-screen-2xl mx-auto px-8 py-8">
        {/* P1.1 CHANGE: Pass displayCurrency, setDisplayCurrency, and exchangeRates to Summary */}
        <Summary 
          summary={summary} 
          assets={assets} 
          onRefreshAll={handleRefreshAll} 
          isGlobalLoading={isLoading}
          displayCurrency={displayCurrency}
          setDisplayCurrency={setDisplayCurrency}
          exchangeRates={exchangeRates}
        />
        
        {/* P1.1 NEW: Add TagAnalytics component */}
        <TagAnalytics 
          assets={assets}
          displayCurrency={displayCurrency}
          exchangeRates={exchangeRates}
        />
        
        <AddAssetForm onAdd={handleAddAsset} isGlobalLoading={isLoading} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {assets.map(asset => (
            <AssetCard 
              key={asset.id} 
              asset={asset} 
              totalPortfolioValue={summary.totalValue} 
              onRemoveTransaction={handleRemoveTransaction} 
              onEditTransaction={handleEditTransaction}
              onRefresh={handleRefreshAsset} 
              onRemove={() => updateActivePortfolio(portfolio => ({
                ...portfolio,
                assets: portfolio.assets.filter(a => a.id !== asset.id)
              }))} 
              onUpdate={handleUpdateAsset} 
              onRetryHistory={() => {}} 
            />
          ))}
        </div>
      </main>

      <ApiKeySettings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <PortfolioManager 
        isOpen={isPortfolioManagerOpen}
        onClose={() => setIsPortfolioManagerOpen(false)}
        portfolios={portfolios}
        activePortfolioId={activePortfolioId}
        onSelectPortfolio={setActivePortfolioId}
        onCreatePortfolio={handleCreatePortfolio}
        onRenamePortfolio={handleRenamePortfolio}
        onDeletePortfolio={handleDeletePortfolio}
      />
    </div>
  );
};

export default App;