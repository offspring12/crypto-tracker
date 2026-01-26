import React, { useState } from 'react';
import { TransactionTag, Currency } from '../types';
import { Calendar, Info, Building2 } from 'lucide-react';
import { TagSelector } from './TagSelector';

// Currency symbol mapping
const getCurrencySymbol = (currency: Currency): string => {
  const symbols: Record<Currency, string> = {
    USD: '$',
    CHF: 'CHF',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CAD: 'C$',
    AUD: 'A$',
  };
  return symbols[currency] || currency;
};

interface DepositFormProps {
  onDeposit: (ticker: string, quantity: number, costBasis: number, date: string, depositSource: string, tag?: TransactionTag, costBasisCurrency?: Currency) => Promise<void>;
  onClose: () => void;
  initialTicker?: string;
}
const DEPOSIT_SOURCES = ['Bank Transfer', 'Coinbase', 'Binance', 'Kraken', 'External Wallet', 'Other Exchange'];
const CURRENCIES: Currency[] = ['USD', 'CHF', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];

// Helper to detect currency from ticker
const detectCurrencyFromTicker = (ticker: string): Currency => {
  const upper = ticker.toUpperCase();
  if (upper === 'CHF' || upper.endsWith('.SW')) return 'CHF';
  if (upper === 'EUR' || upper.endsWith('.DE') || upper.endsWith('.F')) return 'EUR';
  if (upper === 'GBP' || upper.endsWith('.L')) return 'GBP';
  if (upper === 'JPY' || upper.endsWith('.T')) return 'JPY';
  if (upper === 'CAD' || upper.endsWith('.TO')) return 'CAD';
  if (upper === 'AUD' || upper.endsWith('.AX')) return 'AUD';
  return 'USD';
};

export const DepositForm: React.FC<DepositFormProps> = ({ onDeposit, onClose, initialTicker }) => {
  const [ticker, setTicker] = useState(initialTicker || '');
  const [currency, setCurrency] = useState<Currency>(initialTicker ? detectCurrencyFromTicker(initialTicker) : 'USD');
  const [quantity, setQuantity] = useState('');
  const [costBasis, setCostBasis] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [depositSource, setDepositSource] = useState('Bank Transfer');
  const [customSource, setCustomSource] = useState('');
  const [tag, setTag] = useState<TransactionTag>('DCA');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const qtyNum = parseFloat(quantity) || 0;
  const costNum = parseFloat(costBasis) || 0;
  const pricePerUnit = qtyNum > 0 ? costNum / qtyNum : 0;

  // Check for negative values
  const hasNegativeValues = qtyNum < 0 || costNum < 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!ticker.trim() || qtyNum <= 0 || costNum <= 0) {
      alert('Please fill in all required fields with valid values');
      return;
    }

    setIsSubmitting(true);
    try {
      const finalSource = depositSource === 'Other Exchange' ? customSource : depositSource;
      await onDeposit(ticker.trim().toUpperCase(), qtyNum, costNum, date, finalSource, tag, currency);
      onClose();
    } catch (error) {
      console.error('Deposit failed:', error);
      alert('Failed to create deposit. Please try again.');
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
              Quantity and cost basis must be positive numbers. Please correct your input.
            </p>
          </div>
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4 flex items-start gap-3">
        <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={20} />
        <div className="text-sm text-blue-200">
          <p className="font-medium mb-1">What is a Deposit?</p>
          <p className="text-blue-300/80">
            Record assets entering this portfolio (bank transfers, exchanges, or transfers from another wallet).
            Provide the cost basis to track profit/loss accurately.
          </p>
        </div>
      </div>

      {/* Ticker */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Asset Ticker *
        </label>
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="BTC, ETH, AAPL, NESN.SW..."
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
          required
        />
        <p className="text-xs text-slate-500 mt-1">
          For stocks, include exchange suffix (e.g., AAPL for US, NESN.SW for Swiss)
        </p>
      </div>

      {/* Currency Selector */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Cost Basis Currency *
        </label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as Currency)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
          required
        >
          {CURRENCIES.map(curr => (
            <option key={curr} value={curr}>{curr}</option>
          ))}
        </select>
        <p className="text-xs text-slate-500 mt-1">
          💡 US stocks should use USD, Swiss stocks (.SW) use CHF, EU stocks (.DE/.F) use EUR
        </p>
      </div>

      {/* Quantity & Cost Basis Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Quantity *
          </label>
          <div className="relative">
            <input
              type="number"
              step="any"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Total Cost Basis ({currency}) *
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium">
              {getCurrencySymbol(currency)}
            </span>
            <input
              type="number"
              step="any"
              min="0"
              value={costBasis}
              onChange={(e) => setCostBasis(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-12 pr-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
              required
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            What you originally paid for this asset
          </p>
        </div>
      </div>

      {/* Price Per Unit (Calculated) */}
      {qtyNum > 0 && costNum > 0 && (
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Calculated Price Per Unit</p>
          <p className="text-lg font-bold text-emerald-400">
            {pricePerUnit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} {currency}
          </p>
        </div>
      )}

      {/* Date */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          <Calendar className="inline mr-2" size={16} />
          Deposit Date *
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
          required
        />
      </div>

      {/* Deposit Source */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          <Building2 className="inline mr-2" size={16} />
          Deposit Source *
        </label>
        <select
          value={depositSource}
          onChange={(e) => setDepositSource(e.target.value)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
        >
          {DEPOSIT_SOURCES.map(source => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
        {depositSource === 'Other Exchange' && (
          <input
            type="text"
            value={customSource}
            onChange={(e) => setCustomSource(e.target.value)}
            placeholder="Enter exchange name..."
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none mt-2"
            required
          />
        )}
      </div>

      {/* Tag */}
      <TagSelector
        value={tag}
        onChange={setTag}
        transactionType="DEPOSIT"
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
          disabled={isSubmitting || !ticker.trim() || qtyNum <= 0 || costNum <= 0}
          className="flex-1 px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors touch-target"
        >
          {isSubmitting ? 'Creating...' : 'Create Deposit'}
        </button>
      </div>
    </form>
  );
};
