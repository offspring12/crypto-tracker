import React, { useState } from 'react';
import { X, Plus, Edit2, Trash2, Check, FolderOpen } from 'lucide-react';
import { Portfolio } from '../types';

interface PortfolioManagerProps {
  isOpen: boolean;
  onClose: () => void;
  portfolios: Portfolio[];
  activePortfolioId: string;
  onSelectPortfolio: (id: string) => void;
  onCreatePortfolio: (name: string) => void;
  onRenamePortfolio: (id: string, newName: string) => void;
  onDeletePortfolio: (id: string) => void;
}

export const PortfolioManager: React.FC<PortfolioManagerProps> = ({
  isOpen,
  onClose,
  portfolios,
  activePortfolioId,
  onSelectPortfolio,
  onCreatePortfolio,
  onRenamePortfolio,
  onDeletePortfolio
}) => {
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  if (!isOpen) return null;

  const handleCreate = () => {
    if (newPortfolioName.trim()) {
      onCreatePortfolio(newPortfolioName.trim());
      setNewPortfolioName('');
    }
  };

  const handleStartEdit = (portfolio: Portfolio) => {
    setEditingId(portfolio.id);
    setEditingName(portfolio.name);
  };

  const handleSaveEdit = () => {
    if (editingId && editingName.trim()) {
      onRenamePortfolio(editingId, editingName.trim());
      setEditingId(null);
      setEditingName('');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleSelect = (id: string) => {
    onSelectPortfolio(id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-0 md:p-4">
      <div className="bg-slate-800 border-0 md:border border-slate-700 rounded-none md:rounded-2xl shadow-2xl w-full h-full md:max-w-2xl md:h-auto md:max-h-[80vh] p-4 md:p-6 relative overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-700 rounded-lg touch-target"
        >
          <X size={24} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <FolderOpen className="text-white" size={20} />
          </div>
          <h2 className="text-xl font-bold text-white">Manage Portfolios</h2>
        </div>

        {/* Create New Portfolio */}
        <div className="mb-6 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Create New Portfolio
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newPortfolioName}
              onChange={(e) => setNewPortfolioName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Portfolio name..."
              className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder-slate-500"
            />
            <button
              onClick={handleCreate}
              disabled={!newPortfolioName.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
            >
              <Plus size={18} />
              Create
            </button>
          </div>
        </div>

        {/* Portfolio List */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Your Portfolios</h3>
          {portfolios.map(portfolio => {
            const isActive = portfolio.id === activePortfolioId;
            const isEditing = editingId === portfolio.id;
            const totalValue = portfolio.assets.reduce((sum, a) => sum + (a.quantity * a.currentPrice), 0);

            return (
              <div
                key={portfolio.id}
                className={`p-4 rounded-lg border transition-all ${
                  isActive 
                    ? 'bg-indigo-600/10 border-indigo-500/50' 
                    : 'bg-slate-900/30 border-slate-700 hover:border-slate-600'
                }`}
                style={isActive ? { borderLeftColor: portfolio.color, borderLeftWidth: '3px' } : {}}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: portfolio.color }}
                    />
                    
                    {isEditing ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                        autoFocus
                      />
                    ) : (
                      <div 
                        className="flex-1 cursor-pointer"
                        onClick={() => handleSelect(portfolio.id)}
                      >
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-slate-100">
                            {portfolio.name}
                          </h4>
                          {isActive && (
                            <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-400">
                          {portfolio.assets.length} asset{portfolio.assets.length !== 1 ? 's' : ''} · 
                          {' '}${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <button
                          onClick={handleSaveEdit}
                          className="p-2 text-emerald-400 hover:text-emerald-300 transition-colors"
                          title="Save"
                        >
                          <Check size={18} />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-2 text-slate-400 hover:text-slate-300 transition-colors"
                          title="Cancel"
                        >
                          <X size={18} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleStartEdit(portfolio)}
                          className="p-2 text-slate-400 hover:text-indigo-400 transition-colors"
                          title="Rename"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => onDeletePortfolio(portfolio.id)}
                          disabled={portfolios.length === 1}
                          className="p-2 text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title={portfolios.length === 1 ? "Cannot delete last portfolio" : "Delete"}
                        >
                          <Trash2 size={18} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-700">
          <p className="text-xs text-slate-500">
            💡 Tip: Each portfolio maintains its own assets and history. Switch between them anytime.
          </p>
        </div>
      </div>
    </div>
  );
};