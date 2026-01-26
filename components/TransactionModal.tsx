import React, { useState } from 'react';
import { Asset, Currency, TransactionTag, Portfolio } from '../types';
import { X, Download, ShoppingCart, Upload, Gift, ArrowRightLeft, TrendingDown } from 'lucide-react';
import { DepositForm } from './DepositForm';
import { BuyForm } from './BuyForm';
import { WithdrawForm } from './WithdrawForm';
import { IncomeForm } from './IncomeForm';
import { TransferForm } from './TransferForm';
import { SellModal } from './SellModal';

interface TransactionModalProps {
  onClose: () => void;
  onDeposit: (ticker: string, quantity: number, costBasis: number, date: string, depositSource: string, tag?: TransactionTag) => Promise<void>;
  onBuy: (sourceTicker: string, sourceQuantity: number, destinationTicker: string, destinationQuantity: number, date: string, tag?: TransactionTag) => Promise<void>;
  // onSell is now unified with onBuy - it accepts the same parameters (sourceTicker, sourceQty, destTicker, destQty, date, tag)
  onSell: (sourceTicker: string, sourceQuantity: number, destinationTicker: string, destinationQuantity: number, date: string, tag?: TransactionTag) => Promise<void>;
  onWithdraw: (asset: Asset, quantity: number, date: string, withdrawalDestination: string, tag?: TransactionTag) => void;
  onTransfer: (asset: Asset, quantity: number, date: string, destinationPortfolioId: string, tag?: TransactionTag) => void;
  onIncome: (ticker: string, quantity: number, date: string, incomeType: 'dividend' | 'staking' | 'airdrop' | 'interest', incomeSource: string, tag?: TransactionTag) => Promise<void>;
  assets: Asset[];
  portfolios: Portfolio[];
  currentPortfolioId: string;
  displayCurrency: Currency;
  exchangeRates: Record<string, number>;
  // Optional pre-selection for quick transaction from position cards
  initialTab?: TransactionType;
  initialAssetTicker?: string;
}

type TransactionType = 'DEPOSIT' | 'BUY' | 'SELL' | 'WITHDRAW' | 'TRANSFER' | 'INCOME';

export const TransactionModal: React.FC<TransactionModalProps> = ({
  onClose,
  onDeposit,
  onBuy,
  onSell,
  onWithdraw,
  onTransfer,
  onIncome,
  assets,
  portfolios,
  currentPortfolioId,
  displayCurrency,
  exchangeRates,
  initialTab,
  initialAssetTicker,
}) => {
  const [activeTab, setActiveTab] = useState<TransactionType>(initialTab || 'DEPOSIT');
  const [selectedSellAsset, setSelectedSellAsset] = useState<Asset | null>(null);

  // If initialAssetTicker is provided and tab is SELL, pre-select the asset
  React.useEffect(() => {
    if (initialAssetTicker && initialTab === 'SELL') {
      const asset = assets.find(a => a.ticker === initialAssetTicker);
      if (asset) {
        setSelectedSellAsset(asset);
      }
    }
  }, [initialAssetTicker, initialTab, assets]);

  const tabs = [
    { type: 'DEPOSIT' as TransactionType, label: 'Deposit', icon: Download, color: 'emerald' },
    { type: 'BUY' as TransactionType, label: 'Buy', icon: ShoppingCart, color: 'blue' },
    { type: 'SELL' as TransactionType, label: 'Sell', icon: TrendingDown, color: 'rose' },
    { type: 'WITHDRAW' as TransactionType, label: 'Withdraw', icon: Upload, color: 'amber' },
    { type: 'TRANSFER' as TransactionType, label: 'Transfer', icon: ArrowRightLeft, color: 'indigo' },
    { type: 'INCOME' as TransactionType, label: 'Income', icon: Gift, color: 'purple' },
  ];

  return (
    <>
      {selectedSellAsset && (
        <SellModal
          asset={selectedSellAsset}
          onSell={async (quantity, priceOrQtyReceived, date, proceedsCurrency, tag, isCryptoToCrypto) => {
            // Transform SELL into BUY parameters: "Sell X of A for B" = "Buy B with X of A"
            let destinationQuantity: number;

            if (isCryptoToCrypto) {
              // For crypto-to-crypto, priceOrQtyReceived IS the quantity received
              destinationQuantity = priceOrQtyReceived;
            } else {
              // For stablecoin/fiat, priceOrQtyReceived is price per unit
              // Total proceeds = qty * price, and for fiat/stablecoins, proceeds = quantity
              destinationQuantity = quantity * priceOrQtyReceived;
            }

            // Route through unified buy transaction logic
            await onSell(
              selectedSellAsset.ticker,  // sourceTicker (what we're spending/selling)
              quantity,                   // sourceQuantity (how much we're selling)
              proceedsCurrency,           // destinationTicker (what we're receiving)
              destinationQuantity,        // destinationQuantity (how much we receive)
              date,
              tag
            );
            setSelectedSellAsset(null);
            onClose(); // Also close the main TransactionModal
          }}
          onClose={() => setSelectedSellAsset(null)}
          displayCurrency={displayCurrency}
          exchangeRates={exchangeRates}
        />
      )}
      {/* P3: Hide TransactionModal when SellModal is open */}
      <div className={`fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-0 md:p-4 ${selectedSellAsset ? 'hidden' : ''}`}>
        {/* P3: Increased modal size for better UX - no scrolling needed */}
        <div className="bg-slate-800 rounded-none md:rounded-2xl border-0 md:border border-slate-700 shadow-2xl w-full h-full md:h-auto md:max-w-4xl md:max-h-[95vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 md:p-6 border-b border-slate-700">
            <h2 className="text-xl md:text-2xl font-bold text-white">New Transaction</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors touch-target"
              aria-label="Close modal"
            >
              <X className="text-slate-400" size={24} />
            </button>
          </div>

        {/* Tab Selector */}
        <div className="flex gap-1 p-2 md:p-4 bg-slate-900/50 border-b border-slate-700 overflow-x-auto hide-scrollbar">
          {tabs.map(({ type, label, icon: Icon, color }) => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`
                flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2.5 rounded-lg font-medium transition-all whitespace-nowrap text-sm md:text-base touch-target
                ${activeTab === type
                  ? `bg-${color}-600 text-white shadow-lg`
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300'
                }
              `}
            >
              <Icon size={18} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {activeTab === 'DEPOSIT' && (
            <DepositForm onDeposit={onDeposit} onClose={onClose} initialTicker={initialAssetTicker} />
          )}

          {activeTab === 'BUY' && (
            <BuyForm onBuy={onBuy} onClose={onClose} assets={assets} initialSourceTicker={initialAssetTicker} />
          )}

          {activeTab === 'SELL' && (
            <div className="space-y-6">
              {/* Info Banner */}
              <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4 flex items-start gap-3">
                <TrendingDown className="text-blue-400 flex-shrink-0 mt-0.5" size={20} />
                <div className="text-sm text-blue-200">
                  <p className="font-medium mb-1">Select Asset to Sell</p>
                  <p className="text-blue-300/80">
                    Click on any asset below to open the sell form. You'll be able to specify the quantity, price, and proceeds currency.
                  </p>
                </div>
              </div>

              {/* Asset List - P3: Click to open sell form */}
              {assets.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">Your Assets</h3>
                  <div className="space-y-2">
                    {assets.map(asset => (
                      <button
                        key={asset.id}
                        onClick={() => setSelectedSellAsset(asset)}
                        className="w-full bg-slate-900/50 border border-slate-700 hover:border-rose-500/50 hover:bg-slate-900 rounded-lg p-4 flex items-center justify-between transition-all cursor-pointer"
                      >
                        <div className="text-left">
                          <div className="font-semibold text-white">{asset.ticker}</div>
                          <div className="text-xs text-slate-400">
                            {asset.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })} available
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-slate-300">
                            {asset.currency} {asset.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className="text-xs text-slate-500">per unit</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-8 text-center">
                  <p className="text-slate-400">No assets available to sell</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'WITHDRAW' && (
            <WithdrawForm
              onWithdraw={onWithdraw}
              onClose={onClose}
              assets={assets}
              initialAssetTicker={initialAssetTicker}
            />
          )}

          {activeTab === 'TRANSFER' && (
            <TransferForm
              onTransfer={onTransfer}
              onClose={onClose}
              assets={assets}
              portfolios={portfolios}
              currentPortfolioId={currentPortfolioId}
              initialAssetTicker={initialAssetTicker}
            />
          )}

          {activeTab === 'INCOME' && (
            <IncomeForm onIncome={onIncome} onClose={onClose} initialTicker={initialAssetTicker} />
          )}
        </div>
      </div>
    </div>
    </>
  );
};
