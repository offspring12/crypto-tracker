import React, { useState } from 'react';
import { Asset, TransactionTag, Portfolio } from '../types';
import { Calendar, Info, AlertTriangle, Building2 } from 'lucide-react';
import { TagSelector } from './TagSelector';

interface WithdrawFormProps {
  onWithdraw: (asset: Asset, quantity: number, date: string, withdrawalDestination: string, tag?: TransactionTag) => void;
  onClose: () => void;
  assets: Asset[];
  initialAssetTicker?: string;
}
const WITHDRAWAL_DESTINATIONS = ['Bank Account', 'Hardware Wallet', 'Cold Storage', 'Other Exchange', 'Personal Use'];

export const WithdrawForm: React.FC<WithdrawFormProps> = ({
  onWithdraw,
  onClose,
  assets,
  initialAssetTicker
}) => {
  // Find asset ID from ticker if provided
  const initialAsset = initialAssetTicker ? assets.find(a => a.ticker.toUpperCase() === initialAssetTicker.toUpperCase()) : null;
  const [selectedAssetId, setSelectedAssetId] = useState(initialAsset?.id || '');
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [withdrawalDestination, setWithdrawalDestination] = useState('Bank Account');
  const [customDestination, setCustomDestination] = useState('');
  const [tag, setTag] = useState<TransactionTag>('Profit-Taking');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedAsset = assets.find(a => a.id === selectedAssetId);
  const qtyNum = parseFloat(quantity) || 0;
  const hasInsufficientBalance = selectedAsset && qtyNum > selectedAsset.quantity;
  const hasNegativeValues = qtyNum < 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedAsset || qtyNum <= 0) {
      alert('Please select an asset and enter a valid quantity');
      return;
    }

    if (!withdrawalDestination) {
      alert('Please select a withdrawal destination');
      return;
    }

    setIsSubmitting(true);
    try {
      const finalDestination = withdrawalDestination === 'Other Exchange' ? customDestination : withdrawalDestination;
      onWithdraw(selectedAsset, qtyNum, date, finalDestination, tag);
      onClose();
    } catch (error) {
      console.error('Withdrawal failed:', error);
      alert('Failed to create withdrawal. Please try again.');
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
              Quantity must be a positive number. Please correct your input.
            </p>
          </div>
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-4 flex items-start gap-3">
        <Info className="text-amber-400 flex-shrink-0 mt-0.5" size={20} />
        <div className="text-sm text-amber-200">
          <p className="font-medium mb-1">What is a Withdrawal?</p>
          <p className="text-amber-300/80">
            Remove assets from this portfolio (send to bank, cold storage, or transfer to another portfolio).
            Cost basis leaves with the asset.
          </p>
        </div>
      </div>

      {/* Asset Selection */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Select Asset to Withdraw *
        </label>
        <select
          value={selectedAssetId}
          onChange={(e) => {
            setSelectedAssetId(e.target.value);
            setQuantity(''); // Reset quantity when changing asset
          }}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
          required
        >
          <option value="">-- Select an asset --</option>
          {assets
            .filter(a => a.quantity > 0) // Only show assets with balance
            .map(asset => (
              <option key={asset.id} value={asset.id}>
                {asset.ticker} ({asset.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })} available)
              </option>
            ))}
        </select>
      </div>

      {/* Quantity */}
      {selectedAsset && (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Quantity to Withdraw *
          </label>
          <input
            type="number"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.00"
            max={selectedAsset.quantity}
            className={`w-full bg-slate-900 border rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none ${
              hasInsufficientBalance ? 'border-rose-500' : 'border-slate-600'
            }`}
            required
          />
          <div className="flex items-center justify-between mt-2">
            {hasInsufficientBalance ? (
              <p className="text-xs text-rose-400 flex items-center gap-1">
                <AlertTriangle size={12} />
                Insufficient balance
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Available: {selectedAsset.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })} {selectedAsset.ticker}
              </p>
            )}
            <button
              type="button"
              onClick={() => setQuantity(selectedAsset.quantity.toString())}
              className="text-xs text-amber-400 hover:text-amber-300 font-medium"
            >
              Withdraw All
            </button>
          </div>
        </div>
      )}

      {/* Withdrawal Destination */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          <Building2 className="inline mr-2" size={16} />
          Withdrawal Destination *
        </label>
        <select
          value={withdrawalDestination}
          onChange={(e) => setWithdrawalDestination(e.target.value)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
        >
          {WITHDRAWAL_DESTINATIONS.map(dest => (
            <option key={dest} value={dest}>{dest}</option>
          ))}
        </select>
        {withdrawalDestination === 'Other Exchange' && (
          <input
            type="text"
            value={customDestination}
            onChange={(e) => setCustomDestination(e.target.value)}
            placeholder="Enter destination name..."
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none mt-2"
            required
          />
        )}
      </div>

      {/* Date */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          <Calendar className="inline mr-2" size={16} />
          Withdrawal Date *
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
          required
        />
      </div>

      {/* Tag */}
      <TagSelector
        value={tag}
        onChange={setTag}
        transactionType="WITHDRAWAL"
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
          disabled={isSubmitting || !selectedAsset || qtyNum <= 0 || hasInsufficientBalance}
          className="flex-1 px-6 py-3.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors touch-target"
        >
          {isSubmitting ? 'Processing...' : 'Withdraw Asset'}
        </button>
      </div>
    </form>
  );
};
