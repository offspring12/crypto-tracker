import React, { useState } from 'react';
import { Asset, Portfolio, TransactionTag } from '../types';
import { Calendar, Info, ArrowRightLeft } from 'lucide-react';
import { TagSelector } from './TagSelector';

interface TransferFormProps {
  onTransfer: (asset: Asset, quantity: number, date: string, destinationPortfolioId: string, tag?: TransactionTag) => void;
  onClose: () => void;
  assets: Asset[];
  portfolios: Portfolio[];
  currentPortfolioId: string;
  initialAssetTicker?: string;
}

export const TransferForm: React.FC<TransferFormProps> = ({
  onTransfer,
  onClose,
  assets,
  portfolios,
  currentPortfolioId,
  initialAssetTicker
}) => {
  // Find asset ID from ticker if provided
  const initialAsset = initialAssetTicker ? assets.find(a => a.ticker.toUpperCase() === initialAssetTicker.toUpperCase()) : null;
  const [selectedAssetId, setSelectedAssetId] = useState(initialAsset?.id || '');
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [destinationPortfolioId, setDestinationPortfolioId] = useState('');
  const [tag, setTag] = useState<TransactionTag>('Strategic');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedAsset = assets.find(a => a.id === selectedAssetId);
  const qtyNum = parseFloat(quantity) || 0;
  const hasInsufficientBalance = selectedAsset && qtyNum > selectedAsset.quantity;
  const availablePortfolios = portfolios.filter(p => p.id !== currentPortfolioId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedAsset || qtyNum <= 0 || !destinationPortfolioId) {
      alert('Please fill in all required fields with valid values');
      return;
    }

    if (hasInsufficientBalance) {
      alert(`Insufficient balance. You only have ${selectedAsset.quantity} ${selectedAsset.ticker} available.`);
      return;
    }

    setIsSubmitting(true);
    try {
      onTransfer(selectedAsset, qtyNum, date, destinationPortfolioId, tag);
      onClose();
    } catch (error) {
      console.error('Transfer failed:', error);
      alert('Failed to transfer asset. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4 flex items-start gap-3">
        <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={20} />
        <div className="text-sm text-blue-200">
          <p className="font-medium mb-1">What is a Transfer?</p>
          <p className="text-blue-300/80">
            Transfer assets between your portfolios while preserving cost basis. The asset will be removed from this portfolio and added to the destination portfolio. P&L = $0.
          </p>
        </div>
      </div>

      {/* Asset Selection */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Asset to Transfer *
        </label>
        <select
          value={selectedAssetId}
          onChange={(e) => setSelectedAssetId(e.target.value)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          required
        >
          <option value="">-- Select an asset --</option>
          {assets.map(asset => (
            <option key={asset.id} value={asset.id}>
              {asset.ticker} ({asset.quantity.toFixed(8)} available)
            </option>
          ))}
        </select>
      </div>

      {/* Quantity */}
      {selectedAsset && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-300">
              Quantity to Transfer *
            </label>
            <button
              type="button"
              onClick={() => setQuantity(selectedAsset.quantity.toString())}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium"
            >
              Transfer All
            </button>
          </div>
          <input
            type="number"
            step="any"
            min="0"
            max={selectedAsset.quantity}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.00"
            className={`w-full bg-slate-900 border rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${
              hasInsufficientBalance ? 'border-rose-500' : 'border-slate-600'
            }`}
            required
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-slate-400">
              Available: {selectedAsset.quantity.toFixed(8)} {selectedAsset.ticker}
            </p>
            {hasInsufficientBalance && (
              <p className="text-xs text-rose-400 font-medium">
                Insufficient balance
              </p>
            )}
          </div>
        </div>
      )}

      {/* Destination Portfolio */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          <ArrowRightLeft className="inline mr-2" size={16} />
          Destination Portfolio *
        </label>
        {availablePortfolios.length > 0 ? (
          <select
            value={destinationPortfolioId}
            onChange={(e) => setDestinationPortfolioId(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            required
          >
            <option value="">-- Select destination portfolio --</option>
            {availablePortfolios.map(portfolio => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-slate-500">
            No other portfolios available. Create a new portfolio first.
          </div>
        )}
        <p className="text-xs text-slate-500 mt-1">
          The portfolio where this asset will be transferred to
        </p>
      </div>

      {/* Date */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          <Calendar className="inline mr-2" size={16} />
          Transfer Date *
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          required
        />
      </div>

      {/* Tag */}
      <TagSelector
        value={tag}
        onChange={setTag}
        transactionType="TRANSFER"
      />

      {/* Submit Button */}
      <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 px-6 py-3.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors touch-target"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting || !selectedAsset || qtyNum <= 0 || hasInsufficientBalance || !destinationPortfolioId || availablePortfolios.length === 0}
          className="flex-1 px-6 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors touch-target"
        >
          {isSubmitting ? 'Processing...' : 'Transfer Asset'}
        </button>
      </div>
    </form>
  );
};
