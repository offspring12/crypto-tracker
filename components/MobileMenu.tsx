import React from 'react';
import { X, FolderOpen, Settings, Key, Upload, Download, Plus, Check, Wallet, History } from 'lucide-react';
import { Portfolio } from '../types';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  portfolios: Portfolio[];
  activePortfolioId: string;
  activePortfolio: Portfolio | undefined;
  onSelectPortfolio: (id: string) => void;
  onOpenPortfolioManager: () => void;
  onOpenSettings: () => void;
  onExport: () => void;
  onImport: () => void;
  hasApiKey: boolean;
  showTransactionHistory: boolean;
  onToggleView: (showHistory: boolean) => void;
}

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isOpen,
  onClose,
  portfolios,
  activePortfolioId,
  activePortfolio,
  onSelectPortfolio,
  onOpenPortfolioManager,
  onOpenSettings,
  onExport,
  onImport,
  hasApiKey,
  showTransactionHistory,
  onToggleView,
}) => {
  if (!isOpen) return null;

  const handlePortfolioSelect = (id: string) => {
    onSelectPortfolio(id);
    onClose();
  };

  const handleViewToggle = (showHistory: boolean) => {
    onToggleView(showHistory);
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 mobile-overlay"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-slate-900 border-r border-slate-700 z-50 mobile-menu-enter safe-area-inset overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Wallet className="text-white" size={20} />
            </div>
            <span className="text-lg font-bold text-white">Portfolio Tracker</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 touch-target"
          >
            <X size={24} />
          </button>
        </div>

        {/* View Toggle */}
        <div className="p-4 border-b border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">View</p>
          <div className="flex gap-2">
            <button
              onClick={() => handleViewToggle(false)}
              className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-colors touch-target ${
                !showTransactionHistory
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => handleViewToggle(true)}
              className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 touch-target ${
                showTransactionHistory
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <History size={16} />
              Transactions
            </button>
          </div>
        </div>

        {/* Portfolio Selector */}
        <div className="p-4 border-b border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Portfolios</p>
          <div className="space-y-1">
            {portfolios.map((portfolio) => (
              <button
                key={portfolio.id}
                onClick={() => handlePortfolioSelect(portfolio.id)}
                className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors touch-target ${
                  portfolio.id === activePortfolioId
                    ? 'bg-indigo-600/20 text-indigo-400'
                    : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: portfolio.color }}
                />
                <span className="flex-1 text-sm font-medium truncate">{portfolio.name}</span>
                {portfolio.id === activePortfolioId && (
                  <Check size={16} className="text-indigo-400 flex-shrink-0" />
                )}
              </button>
            ))}

            <button
              onClick={() => {
                onOpenPortfolioManager();
                onClose();
              }}
              className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-colors touch-target"
            >
              <Plus size={16} />
              <span className="text-sm font-medium">New Portfolio</span>
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Actions</p>
          <div className="space-y-1">
            <button
              onClick={() => {
                onOpenPortfolioManager();
                onClose();
              }}
              className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 text-slate-300 hover:bg-slate-800 transition-colors touch-target"
            >
              <FolderOpen size={18} />
              <span className="text-sm font-medium">Manage Portfolios</span>
            </button>

            <button
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
              className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors touch-target ${
                hasApiKey
                  ? 'text-emerald-400 hover:bg-slate-800'
                  : 'text-amber-400 hover:bg-slate-800'
              }`}
            >
              {hasApiKey ? <Key size={18} /> : <Settings size={18} />}
              <span className="text-sm font-medium">
                {hasApiKey ? 'API Key Configured' : 'Configure API Key'}
              </span>
            </button>

            <button
              onClick={() => {
                onExport();
                onClose();
              }}
              className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 text-slate-300 hover:bg-slate-800 transition-colors touch-target"
            >
              <Upload size={18} />
              <span className="text-sm font-medium">Export Data</span>
            </button>

            <button
              onClick={() => {
                onImport();
                onClose();
              }}
              className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 text-slate-300 hover:bg-slate-800 transition-colors touch-target"
            >
              <Download size={18} />
              <span className="text-sm font-medium">Import Data</span>
            </button>
          </div>
        </div>

        {/* Active Portfolio Info */}
        {activePortfolio && (
          <div className="p-4 border-t border-slate-800 mt-auto">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: activePortfolio.color }}
              />
              <span>Active: {activePortfolio.name}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
