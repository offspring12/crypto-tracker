import React, { useState, useEffect } from 'react';
import { Asset, Currency, TransactionTag } from '../types';
import { X, DollarSign, Calendar, Tag, AlertTriangle, TrendingDown } from 'lucide-react';
import { detectAssetNativeCurrency } from '../services/portfolioService';
import { convertCurrencySync } from '../services/currencyService';

interface SellModalProps {
  asset: Asset;
  onSell: (quantity: number, pricePerCoinOrQtyReceived: number, date: string, proceedsCurrency: string, tag?: TransactionTag, isCryptoToCrypto?: boolean) => Promise<void>;
  onClose: () => void;
  displayCurrency: Currency;
  exchangeRates: Record<string, number>;
}

// Common stablecoins and major cryptos for proceeds selection
const CRYPTO_PROCEEDS_OPTIONS = [
  { value: 'USDT', label: 'USDT (Tether)', category: 'Stablecoin' },
  { value: 'USDC', label: 'USDC (USD Coin)', category: 'Stablecoin' },
  { value: 'DAI', label: 'DAI (Dai Stablecoin)', category: 'Stablecoin' },
  { value: 'BTC', label: 'BTC (Bitcoin)', category: 'Major' },
  { value: 'ETH', label: 'ETH (Ethereum)', category: 'Major' },
  { value: 'SOL', label: 'SOL (Solana)', category: 'Major' },
];

const SELL_TAGS: TransactionTag[] = ['Profit-Taking', 'Rebalance', 'Emergency', 'Strategic'];

export const SellModal: React.FC<SellModalProps> = ({
  asset,
  onSell,
  onClose,
  displayCurrency,
  exchangeRates
}) => {
  // Use asset's native currency for all price displays (not portfolio display currency)
  const assetCurrency = asset.currency || 'USD';

  const [quantity, setQuantity] = useState('');
  const [pricePerCoin, setPricePerCoin] = useState(asset.currentPrice.toString());
  const [quantityReceived, setQuantityReceived] = useState(''); // P2: For crypto-to-crypto trades
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [proceedsCurrency, setProceedsCurrency] = useState<string>('');
  const [tag, setTag] = useState<TransactionTag>('Profit-Taking');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Determine if this is a crypto asset
  const isCryptoAsset = asset.assetType === 'CRYPTO' ||
                        !asset.assetType ||
                        !asset.ticker.includes('.');

  // P2: Determine if proceeds currency is a major crypto (not a stablecoin or fiat)
  const isCryptoToCrypto = isCryptoAsset && ['BTC', 'ETH', 'SOL'].includes(proceedsCurrency);

  // Initialize proceeds currency based on asset type
  useEffect(() => {
    if (isCryptoAsset) {
      // Default to USDT for crypto
      setProceedsCurrency('USDT');
    } else {
      // For stocks, use native currency
      const nativeCurrency = detectAssetNativeCurrency(asset.ticker);
      setProceedsCurrency(nativeCurrency);
    }
  }, [isCryptoAsset, asset.ticker]);

  // Calculate preview values
  const qtyNum = parseFloat(quantity) || 0;
  const priceNum = parseFloat(pricePerCoin) || 0;
  const qtyReceivedNum = parseFloat(quantityReceived) || 0;

  // P2: For crypto-to-crypto, we derive price from quantity received
  // For stablecoins/fiat, we use the direct price
  const effectivePrice = isCryptoToCrypto && qtyNum > 0 ? qtyReceivedNum / qtyNum : priceNum;
  const totalProceeds = isCryptoToCrypto ? qtyReceivedNum : qtyNum * priceNum;

  // P2: P&L calculation only makes sense for stablecoins/fiat (same currency comparison)
  // For crypto-to-crypto, P&L can't be calculated directly (comparing BTC to ETH doesn't make sense)
  const estimatedPnL = isCryptoToCrypto ? 0 : (effectivePrice - asset.avgBuyPrice) * qtyNum;
  const estimatedPnLPercent = isCryptoToCrypto ? 0 : (asset.avgBuyPrice > 0 ? ((effectivePrice - asset.avgBuyPrice) / asset.avgBuyPrice) * 100 : 0);

  // Validation
  const canSell = qtyNum > 0 && qtyNum <= asset.quantity &&
                  (isCryptoToCrypto ? qtyReceivedNum > 0 : priceNum > 0);
  const isPartialSell = qtyNum > 0 && qtyNum < asset.quantity;
  const isFullSell = qtyNum === asset.quantity;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSell) return;

    setIsSubmitting(true);
    try {
      // P2: For crypto-to-crypto, pass quantity received; otherwise pass price
      const valueToPass = isCryptoToCrypto ? qtyReceivedNum : priceNum;
      await onSell(qtyNum, valueToPass, date, proceedsCurrency, tag, isCryptoToCrypto);
      onClose();
    } catch (error) {
      console.error('Sell failed:', error);
      alert('Failed to sell asset. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-700 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <TrendingDown className="text-rose-400" size={24} />
            <h2 className="text-xl font-bold text-white">Sell {asset.name || asset.ticker}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={24} />
          </button>
        </div>

        {/* Available Balance */}
        <div className="bg-slate-900/50 rounded-lg p-4 mb-6">
          <div className="text-xs text-slate-400 mb-1">Available to Sell</div>
          <div className="text-2xl font-bold text-white">
            {asset.quantity.toLocaleString('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 8
            })} {asset.ticker}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Avg Cost: {assetCurrency} {asset.avgBuyPrice.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })} per unit
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Quantity */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">Quantity to Sell *</label>
            <div className="relative">
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                step="any"
                min="0"
                max={asset.quantity}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white pr-16 focus:ring-2 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                placeholder="0.00"
                required
              />
              <button
                type="button"
                onClick={() => setQuantity(asset.quantity.toString())}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-rose-400 hover:text-rose-300 transition-colors"
              >
                MAX
              </button>
            </div>
            {qtyNum > asset.quantity && (
              <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} />
                Cannot sell more than you own ({asset.quantity.toFixed(8)})
              </p>
            )}
          </div>

          {/* P2: Proceeds Currency - Show right after quantity for crypto */}
          {isCryptoAsset && (
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                Sell to (Proceeds Currency) *
              </label>
              <select
                value={proceedsCurrency}
                onChange={(e) => setProceedsCurrency(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                required
              >
                <optgroup label="Stablecoins">
                  {CRYPTO_PROCEEDS_OPTIONS
                    .filter(opt => opt.category === 'Stablecoin')
                    .map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Major Cryptos">
                  {CRYPTO_PROCEEDS_OPTIONS
                    .filter(opt => opt.category === 'Major')
                    .map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                </optgroup>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Choose which asset you're selling to (crypto-to-crypto swap)
              </p>
            </div>
          )}

          {/* P2: Conditionally show Price or Quantity Received */}
          {isCryptoToCrypto ? (
            /* Quantity Received (for crypto-to-crypto) */
            <div>
              <label className="block text-sm text-slate-300 mb-2">Quantity of {proceedsCurrency} Received *</label>
              <div className="relative">
                <input
                  type="number"
                  value={quantityReceived}
                  onChange={(e) => setQuantityReceived(e.target.value)}
                  step="any"
                  min="0"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                  placeholder={`0.00 ${proceedsCurrency}`}
                  required
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                How many {proceedsCurrency} did you receive for this sale?
              </p>
            </div>
          ) : (
            /* Price per Unit (for stablecoins/fiat) */
            <div>
              <label className="block text-sm text-slate-300 mb-2">Sale Price per Unit *</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="number"
                  value={pricePerCoin}
                  onChange={(e) => setPricePerCoin(e.target.value)}
                  step="any"
                  min="0"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                  placeholder="0.00"
                  required
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Current market price: {assetCurrency} {asset.currentPrice.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </p>
            </div>
          )}

          {/* Date */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">Sale Date *</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                required
              />
            </div>
          </div>

          {/* Tag */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">Transaction Tag *</label>
            <div className="relative">
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <select
                value={tag}
                onChange={(e) => setTag(e.target.value as TransactionTag)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
              >
                {SELL_TAGS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Preview */}
          <div className="bg-slate-900/50 rounded-lg p-4 space-y-2 border border-slate-700">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">
                {isCryptoToCrypto ? 'You Will Receive:' : 'Total Proceeds:'}
              </span>
              <span className="text-white font-bold">
                {isCryptoToCrypto
                  ? `${totalProceeds.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 8
                    })} ${proceedsCurrency}`
                  : `${assetCurrency} ${totalProceeds.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}`
                }
              </span>
            </div>
            {/* P2: Only show P&L for stablecoin/fiat sells (not crypto-to-crypto) */}
            {!isCryptoToCrypto && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Estimated P&L:</span>
                <span className={`font-bold ${estimatedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {estimatedPnL >= 0 ? '+' : ''}{assetCurrency} {estimatedPnL.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                  {' '}({estimatedPnL >= 0 ? '+' : ''}{estimatedPnLPercent.toFixed(2)}%)
                </span>
              </div>
            )}
            {isPartialSell && (
              <div className="flex justify-between text-sm pt-2 border-t border-slate-700">
                <span className="text-slate-400">Remaining Position:</span>
                <span className="text-white">
                  {(asset.quantity - qtyNum).toLocaleString('en-US', { maximumFractionDigits: 8 })} {asset.ticker}
                </span>
              </div>
            )}
          </div>

          {/* Warning for full sell */}
          {isFullSell && qtyNum > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <AlertTriangle className="text-amber-400 mt-0.5 flex-shrink-0" size={18} />
              <div>
                <p className="text-sm text-amber-300 font-medium">Full Position Sale</p>
                <p className="text-xs text-amber-200/80 mt-1">
                  This will close your entire {asset.ticker} position. It will be moved to Closed Positions history.
                </p>
              </div>
            </div>
          )}

          {/* Submit Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-white rounded-lg transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSell || isSubmitting}
              className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
            >
              {isSubmitting ? 'Selling...' : `Sell ${asset.ticker}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
