import React, { useState, useEffect } from 'react';
import { Plus, Loader2, Calendar, DollarSign, Tag, AlertTriangle } from 'lucide-react';
import { Currency } from '../types';
import { SUPPORTED_CURRENCIES } from '../services/currencyService';

interface AddAssetFormProps {
  onAdd: (ticker: string, quantity: number, pricePerCoin: number, date: string, currency: Currency, tag?: string) => Promise<void>;
  isGlobalLoading: boolean;
}

const PRESET_TAGS = ['DCA', 'FOMO', 'Strategic', 'Rebalance', 'Emergency', 'Profit-Taking', 'Research'];

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
};

/**
 * Check if ticker is a crypto (trades 24/7)
 */
const isCrypto = (ticker: string): boolean => {
  // Contract addresses
  if (ticker.startsWith('0x')) return true;

  // Common crypto tickers
  const cryptoTickers = ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI', 'ATOM', 'LTC'];
  return cryptoTickers.includes(ticker.toUpperCase());
};

/**
 * Fixed market holidays (same date every year)
 */
const FIXED_HOLIDAYS = [
  { month: 1, day: 1, name: "New Year's Day" },           // Jan 1
  { month: 12, day: 25, name: "Christmas Day" },          // Dec 25
  { month: 12, day: 26, name: "Boxing Day" },             // Dec 26 (Swiss/UK)
  { month: 8, day: 1, name: "Swiss National Day" },       // Aug 1 (Swiss only)
  { month: 10, day: 3, name: "German Unity Day" },        // Oct 3 (German only)
  { month: 7, day: 4, name: "Independence Day" },         // Jul 4 (US only)
  { month: 5, day: 1, name: "Labour Day" },               // May 1 (Europe)
];

/**
 * Calculate Easter Sunday for a given year (Computus algorithm)
 */
const getEasterSunday = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
};

/**
 * Check if a date is a market holiday
 */
const isMarketHoliday = (date: Date, ticker: string): { isHoliday: boolean; name?: string } => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-indexed
  const day = date.getDate();

  // Determine market based on ticker suffix
  const isSwiss = ticker.endsWith('.SW');
  const isGerman = ticker.endsWith('.DE');
  const isUS = !isSwiss && !isGerman; // Default to US market

  // Check fixed holidays
  for (const holiday of FIXED_HOLIDAYS) {
    if (holiday.month === month && holiday.day === day) {
      // Market-specific holidays
      if (holiday.name === "Swiss National Day" && !isSwiss) continue;
      if (holiday.name === "German Unity Day" && !isGerman) continue;
      if (holiday.name === "Independence Day" && !isUS) continue;
      if (holiday.name === "Boxing Day" && isUS) continue; // US doesn't observe Boxing Day
      if (holiday.name === "Labour Day" && isUS) continue; // US has different Labor Day

      return { isHoliday: true, name: holiday.name };
    }
  }

  // Easter-dependent holidays (movable holidays)
  const easter = getEasterSunday(year);
  const easterMonth = easter.getMonth() + 1;
  const easterDay = easter.getDate();

  // Good Friday (Easter - 2 days)
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  if (month === goodFriday.getMonth() + 1 && day === goodFriday.getDate()) {
    return { isHoliday: true, name: "Good Friday" };
  }

  // Easter Monday (Easter + 1 day) - Europe only
  if (!isUS) {
    const easterMonday = new Date(easter);
    easterMonday.setDate(easter.getDate() + 1);
    if (month === easterMonday.getMonth() + 1 && day === easterMonday.getDate()) {
      return { isHoliday: true, name: "Easter Monday" };
    }
  }

  return { isHoliday: false };
};

export const AddAssetForm: React.FC<AddAssetFormProps> = ({ onAdd, isGlobalLoading }) => {
  const [ticker, setTicker] = useState('');
  const [quantity, setQuantity] = useState('');
  const [totalPaid, setTotalPaid] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [tag, setTag] = useState('DCA');
  const [customTag, setCustomTag] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Validation warnings
  const [nonTradingDayWarning, setNonTradingDayWarning] = useState<string | null>(null);
  const [priceWarning, setPriceWarning] = useState<string | null>(null);

  // Check for non-trading day when date or ticker changes
  useEffect(() => {
    if (!date || !ticker) {
      setNonTradingDayWarning(null);
      return;
    }

    // Skip check for crypto (trades 24/7)
    if (isCrypto(ticker)) {
      setNonTradingDayWarning(null);
      return;
    }

    // Parse date in local timezone
    const [year, month, day] = date.split('-').map(Number);
    const selectedDate = new Date(year, month - 1, day);

    // Check for weekend
    if (isWeekend(selectedDate)) {
      const dayName = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
      setNonTradingDayWarning(`${dayName} is a weekend. Most stock exchanges are closed.`);
      return;
    }

    // Check for market holiday
    const holidayCheck = isMarketHoliday(selectedDate, ticker);
    if (holidayCheck.isHoliday) {
      setNonTradingDayWarning(`${holidayCheck.name} is a market holiday. Stock exchanges are closed.`);
      return;
    }

    setNonTradingDayWarning(null);
  }, [date, ticker]);

  // Check for suspicious price when inputs change
  useEffect(() => {
    if (!quantity || !totalPaid || parseFloat(quantity) <= 0) {
      setPriceWarning(null);
      return;
    }

    const qtyNum = parseFloat(quantity);
    const totalPaidNum = parseFloat(totalPaid);
    const pricePerCoin = totalPaidNum / qtyNum;

    // Warn if price seems suspiciously low (< $0.01 for non-micro-cap)
    if (pricePerCoin < 0.01 && !isCrypto(ticker)) {
      setPriceWarning(`Price per unit is ${pricePerCoin.toFixed(6)} ${currency}. Is this correct?`);
    }
    // Warn if price seems suspiciously high (> $10,000 per unit for most assets)
    else if (pricePerCoin > 10000 && ticker !== 'BTC') {
      setPriceWarning(`Price per unit is ${pricePerCoin.toLocaleString()} ${currency}. Is this correct?`);
    }
    else {
      setPriceWarning(null);
    }
  }, [quantity, totalPaid, ticker, currency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !quantity || !totalPaid) return;

    const qtyNum = parseFloat(quantity);
    const totalPaidNum = parseFloat(totalPaid);
    
    // Calculate price per coin derived from total paid
    const calculatedPricePerCoin = qtyNum > 0 ? totalPaidNum / qtyNum : 0;

    // Use custom tag if "Custom" is selected and custom tag is filled
    const finalTag = tag === 'Custom' && customTag.trim() ? customTag.trim() : tag;

    setIsSubmitting(true);
    await onAdd(
      ticker, 
      qtyNum, 
      calculatedPricePerCoin,
      date,
      currency,
      finalTag
    );
    
    // Reset form but keep date, currency, and tag
    setTicker('');
    setQuantity('');
    setTotalPaid('');
    setCustomTag('');
    setIsSubmitting(false);
  };

  return (
    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl mb-8">
      <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
        <Plus className="text-indigo-500" size={20} />
        Add Transaction
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="flex-1 w-full">
            <label htmlFor="ticker" className="block text-xs font-medium text-slate-400 mb-1">
              Ticker Symbol
            </label>
            <input
              id="ticker"
              type="text"
              value={ticker}
              onChange={(e) => {
                const value = e.target.value;
                // Only uppercase if it's NOT a contract address
                setTicker(value.startsWith('0x') && value.length > 10 ? value : value.toUpperCase());
              }}
              placeholder="BTC or 0x"
              title="Examples: BTC, ETH, AAPL, NESN.SW (Swiss), SAP.DE (German), 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder-slate-600 uppercase"
              required
            />
          </div>
          <div className="flex-1 w-full">
            <label htmlFor="quantity" className="block text-xs font-medium text-slate-400 mb-1">
              Quantity
            </label>
            <input
              id="quantity"
              type="number"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder-slate-600"
              required
            />
          </div>
          <div className="flex-1 w-full">
            <label htmlFor="totalPaid" className="block text-xs font-medium text-slate-400 mb-1">
              Total Paid
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-500">
                <DollarSign size={16} />
              </span>
              <input
                id="totalPaid"
                type="number"
                step="any"
                value={totalPaid}
                onChange={(e) => setTotalPaid(e.target.value)}
                placeholder="1000.00"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder-slate-600"
                required
              />
            </div>
          </div>
          <div className="flex-1 w-full">
            <label htmlFor="currency" className="block text-xs font-medium text-slate-400 mb-1">
              Currency
            </label>
            <select
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer"
            >
              {SUPPORTED_CURRENCIES.map(curr => (
                <option key={curr.code} value={curr.code}>
                  {curr.flag} {curr.code}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 w-full">
            <label htmlFor="tag" className="block text-xs font-medium text-slate-400 mb-1">
              Tag
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-500 pointer-events-none">
                <Tag size={16} />
              </span>
              <select
                id="tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer appearance-none"
              >
                {PRESET_TAGS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
                <option value="Custom">Custom...</option>
              </select>
              <div className="absolute right-3 top-3 pointer-events-none">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
          <div className="flex-1 w-full">
            <label htmlFor="date" className="block text-xs font-medium text-slate-400 mb-1">
              Date
            </label>
            <div className="relative">
               <span className="absolute left-3 top-2.5 text-slate-500">
                <Calendar size={16} />
              </span>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder-slate-600 [color-scheme:dark]"
                required
              />
            </div>
          </div>
        </div>
        
        {/* Custom tag input - shows only when "Custom" is selected */}
        {tag === 'Custom' && (
          <div className="w-full md:w-1/3">
            <label htmlFor="customTag" className="block text-xs font-medium text-slate-400 mb-1">
              Custom Tag Name
            </label>
            <input
              id="customTag"
              type="text"
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              placeholder="Enter custom tag..."
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder-slate-600"
            />
          </div>
        )}

        {/* Validation Warnings */}
        {(nonTradingDayWarning || priceWarning) && (
          <div className="space-y-2">
            {nonTradingDayWarning && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <AlertTriangle className="text-amber-400 mt-0.5 flex-shrink-0" size={18} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-300">Non-Trading Day Warning</p>
                  <p className="text-xs text-amber-200/80 mt-1">
                    {nonTradingDayWarning} Using non-trading days may cause volatility calculation issues due to interpolated prices.
                  </p>
                </div>
              </div>
            )}

            {priceWarning && (
              <div className="flex items-start gap-2 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                <AlertTriangle className="text-orange-400 mt-0.5 flex-shrink-0" size={18} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-orange-300">Price Sanity Check</p>
                  <p className="text-xs text-orange-200/80 mt-1">
                    {priceWarning} Please verify your quantity and total paid values.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || isGlobalLoading}
          className="w-full md:w-auto self-end bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium px-6 py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 min-w-[120px]"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              Processing...
            </>
          ) : (
            'Add Transaction'
          )}
        </button>
      </form>
    </div>
  );
};