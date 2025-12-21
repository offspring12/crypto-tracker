import React, { useState } from 'react';
import { Plus, Loader2, Calendar, DollarSign } from 'lucide-react';

interface AddAssetFormProps {
  onAdd: (ticker: string, quantity: number, pricePerCoin: number, date: string) => Promise<void>;
  isGlobalLoading: boolean;
}

export const AddAssetForm: React.FC<AddAssetFormProps> = ({ onAdd, isGlobalLoading }) => {
  const [ticker, setTicker] = useState('');
  const [quantity, setQuantity] = useState('');
  const [totalPaid, setTotalPaid] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !quantity || !totalPaid) return;

    const qtyNum = parseFloat(quantity);
    const totalPaidNum = parseFloat(totalPaid);
    
    // Calculate price per coin derived from total paid
    const calculatedPricePerCoin = qtyNum > 0 ? totalPaidNum / qtyNum : 0;

    setIsSubmitting(true);
    await onAdd(
      ticker, 
      qtyNum, 
      calculatedPricePerCoin,
      date
    );
    
    // Reset form but keep date as today
    setTicker('');
    setQuantity('');
    setTotalPaid('');
    setIsSubmitting(false);
  };

  return (
    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl mb-8">
      <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
        <Plus className="text-indigo-500" size={20} />
        Add Transaction
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="flex-1 w-full">
            <label htmlFor="ticker" className="block text-xs font-medium text-slate-400 mb-1">
              Ticker Symbol
            </label>
            <input
              id="ticker"
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="BTC"
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
              Total Paid (USD)
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