import React, { useState } from 'react';
import { Asset, TransactionTag } from '../types';
import { DollarSign, Calendar, Info, ArrowRight, AlertTriangle } from 'lucide-react';
import { TagSelector } from './TagSelector';

interface BuyFormProps {
  onBuy: (sourceTicker: string, sourceQuantity: number, destinationTicker: string, destinationQuantity: number, date: string, tag?: TransactionTag) => Promise<void>;
  onClose: () => void;
  assets: Asset[];
  initialSourceTicker?: string;
}

export const BuyForm: React.FC<BuyFormProps> = ({ onBuy, onClose, assets, initialSourceTicker }) => {
  const [sourceTicker, setSourceTicker] = useState(initialSourceTicker || '');
  const [sourceQuantity, setSourceQuantity] = useState('');
  const [destinationTicker, setDestinationTicker] = useState('');
  const [destinationQuantity, setDestinationQuantity] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [tag, setTag] = useState<TransactionTag>('DCA');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sourceQtyNum = parseFloat(sourceQuantity) || 0;
  const destQtyNum = parseFloat(destinationQuantity) || 0;

  // Find source asset for validation hints
  const sourceAsset = assets.find(a => a.ticker.toUpperCase() === sourceTicker.toUpperCase());
  const hasInsufficientBalance = sourceAsset && sourceQtyNum > sourceAsset.quantity;

  // Check for negative values
  const hasNegativeValues = sourceQtyNum < 0 || destQtyNum < 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!sourceTicker.trim() || !destinationTicker.trim() || sourceQtyNum <= 0 || destQtyNum <= 0) {
      alert('Please fill in all required fields with valid values');
      return;
    }

    if (sourceTicker.toUpperCase() === destinationTicker.toUpperCase()) {
      alert('Source and destination tickers must be different');
      return;
    }

    setIsSubmitting(true);
    try {
      await onBuy(
        sourceTicker.trim().toUpperCase(),
        sourceQtyNum,
        destinationTicker.trim().toUpperCase(),
        destQtyNum,
        date,
        tag
      );
      onClose();
    } catch (error) {
      console.error('Buy failed:', error);
      alert('Failed to create buy transaction. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Negative Value Warning */}
      {hasNegativeValues && (
        <div className="bg-rose-900/30 border border-rose-700/50 rounded-lg p-4 flex items-start gap-3">
          <Info className="text-rose-400 flex-shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-rose-200">
            <p className="font-medium mb-1">⚠️ Negative values not allowed</p>
            <p className="text-rose-300/80">
              Quantities must be positive numbers. Please correct your input.
            </p>
          </div>
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4 flex items-start gap-3">
        <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={20} />
        <div className="text-sm text-blue-200">
          <p className="font-medium mb-1">What is a Buy Transaction?</p>
          <p className="text-blue-300/80">
            Exchange one asset for another (e.g., pay 50,000 USD to receive 1 BTC, or pay 2 ETH to receive 100 SOL). You must have deposited the source asset first.
          </p>
        </div>
      </div>

      {/* Destination Asset (what you're buying) */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <DollarSign size={16} />
          What You're Buying (Destination)
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Asset Ticker *
            </label>
            <input
              type="text"
              value={destinationTicker}
              onChange={(e) => setDestinationTicker(e.target.value.toUpperCase())}
              placeholder="BTC, ETH, AAPL, SOL..."
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Quantity Received *
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={destinationQuantity}
              onChange={(e) => setDestinationQuantity(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              required
            />
          </div>
        </div>
      </div>

      {/* Arrow Indicator */}
      <div className="flex justify-center">
        <div className="bg-slate-700 p-3 rounded-full">
          <ArrowRight className="text-blue-400" size={24} />
        </div>
      </div>

      {/* Source Asset (what you're paying with) */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <DollarSign size={16} />
          Paying With (Source)
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Asset Ticker *
            </label>
            <input
              type="text"
              value={sourceTicker}
              onChange={(e) => setSourceTicker(e.target.value.toUpperCase())}
              placeholder="USD, CHF, BTC, ETH..."
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              required
            />
            {sourceAsset && (
              <p className="text-xs text-emerald-400 mt-1">
                ✓ Available: {sourceAsset.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })} {sourceAsset.ticker}
              </p>
            )}
            {sourceTicker && !sourceAsset && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} />
                No {sourceTicker} found. You must deposit {sourceTicker} first.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Quantity to Spend *
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={sourceQuantity}
              onChange={(e) => setSourceQuantity(e.target.value)}
              placeholder="0.00"
              className={`w-full bg-slate-900 border rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${
                hasInsufficientBalance ? 'border-rose-500' : 'border-slate-600'
              }`}
              required
            />
            {hasInsufficientBalance && (
              <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} />
                Insufficient balance. Available: {sourceAsset.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Exchange Rate Preview */}
      {sourceQtyNum > 0 && destQtyNum > 0 && (
        <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
          <p className="text-xs text-slate-400 mb-2">Effective Exchange Rate</p>
          <p className="text-lg font-bold text-blue-400">
            1 {destinationTicker || '???'} = {(sourceQtyNum / destQtyNum).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} {sourceTicker || '???'}
          </p>
        </div>
      )}

      {/* Date */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          <Calendar className="inline mr-2" size={16} />
          Transaction Date *
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
        transactionType="BUY"
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
          disabled={isSubmitting || !sourceTicker.trim() || !destinationTicker.trim() || sourceQtyNum <= 0 || destQtyNum <= 0}
          className="flex-1 px-6 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors touch-target"
        >
          {isSubmitting ? 'Processing...' : 'Create Buy'}
        </button>
      </div>
    </form>
  );
};
