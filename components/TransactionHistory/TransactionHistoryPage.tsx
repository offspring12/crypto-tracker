/**
 * Transaction History Page
 *
 * Main page component for viewing, searching, and filtering all transactions
 * across portfolios. Provides bulk actions and CSV export functionality.
 */

import React, { useMemo, useState } from 'react';
import { Portfolio, Currency } from '../../types';
import { useTransactionFilters } from '../../hooks/useTransactionFilters';
import { exportTransactionsToCSV, exportAllTransactionsToCSV } from '../../utils/csvExport';
import { getTransactionTypeInfo, FlattenedTransaction, flattenTransactions } from '../../utils/transactionHelpers';
import { getPageNumbers } from '../../hooks/usePagination';
import {
  Search,
  X,
  Download,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Link2,
  Link2Off,
  Filter,
  RotateCcw,
  Layers,
  FolderOpen,
} from 'lucide-react';

interface TransactionHistoryPageProps {
  portfolios: Portfolio[];
  displayCurrency: Currency;
  exchangeRates: Record<string, number>;
  activePortfolioId: string;
  activePortfolioName: string;
  onEditTransaction?: (assetId: string, txId: string) => void;
  onDeleteTransaction?: (assetId: string, txId: string) => void;
}

/**
 * Tag color mapping (matches AssetCard.tsx)
 */
const TAG_COLORS: Record<string, string> = {
  DCA: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  FOMO: 'bg-red-500/20 text-red-300 border-red-500/30',
  Strategic: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Rebalance: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  Emergency: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Profit-Taking': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  Research: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
};

const getTagColorClass = (tag: string | undefined): string => {
  if (!tag) return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  return TAG_COLORS[tag] || 'bg-slate-500/20 text-slate-300 border-slate-500/30';
};

export const TransactionHistoryPage: React.FC<TransactionHistoryPageProps> = ({
  portfolios,
  displayCurrency,
  exchangeRates,
  activePortfolioId,
  activePortfolioName,
  onEditTransaction,
  onDeleteTransaction,
}) => {
  // Portfolio scope toggle: true = all portfolios, false = current portfolio only
  const [showAllPortfolios, setShowAllPortfolios] = useState(true);
  // Mobile filters expanded state
  const [mobileFiltersExpanded, setMobileFiltersExpanded] = useState(false);

  // Filter portfolios based on toggle
  const scopedPortfolios = useMemo(() => {
    if (showAllPortfolios) {
      return portfolios;
    }
    return portfolios.filter(p => p.id === activePortfolioId);
  }, [portfolios, activePortfolioId, showAllPortfolios]);

  const {
    // Search
    searchInputValue,
    setSearchValue,
    clearSearch,
    isSearchDebouncing,

    // Filters
    filters,
    setTransactionTypes,
    setAssetTickers,
    setTags,
    setDateFrom,
    setDateTo,
    hasActiveFilters,
    resetAllFilters,
    filterOptions,

    // Sort
    sortConfig,
    toggleSort,

    // Linked view
    showCombinedView,
    setShowCombinedView,

    // Selection
    selectedIds,
    toggleSelection,
    selectAll,
    clearSelection,
    isAllSelected,

    // Results
    filteredTransactions,
    paginatedTransactions,
    totalCount,
    filteredCount,

    // Pagination
    pagination,
  } = useTransactionFilters(scopedPortfolios);

  // Currency formatter
  const currencyFmt = useMemo(() => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: displayCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [displayCurrency]);

  // Handle CSV export (filtered/selected transactions)
  const handleExport = () => {
    const toExport = selectedIds.size > 0
      ? filteredTransactions.filter(t => selectedIds.has(t.transaction.id))
      : filteredTransactions;

    exportTransactionsToCSV(toExport, 'transactions');
  };

  // Handle CSV export (ALL transactions in current scope, ignoring filters)
  const handleExportAll = () => {
    const allTransactions = flattenTransactions(scopedPortfolios);
    const filename = showAllPortfolios ? 'All_Portfolios' : activePortfolioName;
    const result = exportAllTransactionsToCSV(allTransactions, filename);
    if (!result.success) {
      console.warn(result.error);
    }
  };

  // Sort indicator component
  const SortIndicator: React.FC<{ field: typeof sortConfig.field }> = ({ field }) => {
    if (sortConfig.field !== field) {
      return <span className="text-slate-600 ml-1">⇅</span>;
    }
    return sortConfig.direction === 'asc' ? (
      <ChevronUp size={14} className="inline ml-1" />
    ) : (
      <ChevronDown size={14} className="inline ml-1" />
    );
  };

  // Render transaction row
  const renderTransactionRow = (item: FlattenedTransaction) => {
    const tx = item.transaction;
    const typeInfo = getTransactionTypeInfo(tx.type);
    const isSelected = selectedIds.has(tx.id);

    // Check if this transaction is part of a linked pair
    const isLinkedTransaction = tx.linkedBuySellTransactionId != null;

    // Format description for linked transactions
    let linkDescription = '';
    if (isLinkedTransaction) {
      if (showCombinedView) {
        // Combined view: full description
        if (tx.type === 'BUY' && tx.sourceTicker) {
          linkDescription = `Buy ${tx.quantity.toLocaleString()} ${item.assetTicker} with ${tx.sourceQuantity?.toLocaleString() || '?'} ${tx.sourceTicker}`;
        } else if (tx.type === 'SELL' && tx.proceedsCurrency) {
          linkDescription = `Sell ${tx.quantity.toLocaleString()} ${item.assetTicker} for ${tx.proceedsCurrency}`;
        }
      } else {
        // Expanded view: show what this transaction is linked to
        if (tx.type === 'BUY' && tx.sourceTicker) {
          linkDescription = `Paid with ${tx.sourceQuantity?.toLocaleString() || '?'} ${tx.sourceTicker}`;
        } else if (tx.type === 'SELL' && tx.proceedsCurrency) {
          // Find the linked BUY to show destination quantity
          const linkedBuy = item.linkedTransaction;
          if (linkedBuy) {
            linkDescription = `Exchanged for ${linkedBuy.transaction.quantity.toLocaleString()} ${linkedBuy.assetTicker}`;
          } else {
            linkDescription = `Exchanged for ${tx.proceedsCurrency}`;
          }
        }
      }
    }

    return (
      <tr
        key={tx.id}
        className={`hover:bg-white/5 border-b border-slate-700/50 ${
          isSelected ? 'bg-indigo-500/10' : ''
        }`}
      >
        {/* Selection checkbox */}
        <td className="p-3 w-10">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelection(tx.id)}
            className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
          />
        </td>

        {/* Date */}
        <td className="p-3 text-slate-400 whitespace-nowrap">
          {tx.date}
        </td>

        {/* Type */}
        <td className="p-3">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${typeInfo.bgClass}`}>
              {typeInfo.label}
            </span>
            {isLinkedTransaction && (
              <span title="Linked transaction">
                <Link2 size={12} className="text-indigo-400" />
              </span>
            )}
          </div>
        </td>

        {/* Asset / Description */}
        <td className="p-3">
          <div className="font-medium text-slate-200">{item.assetTicker}</div>
          {linkDescription && (
            <div className="text-xs text-indigo-400/70 flex items-center gap-1">
              <span>{linkDescription}</span>
            </div>
          )}
        </td>

        {/* Quantity */}
        <td className="p-3 text-right font-mono text-slate-300">
          {tx.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}
        </td>

        {/* Price */}
        <td className="p-3 text-right font-mono text-slate-300">
          {currencyFmt.format(tx.pricePerCoin)}
        </td>

        {/* Total */}
        <td className="p-3 text-right font-mono text-slate-200">
          {currencyFmt.format(tx.totalCost)}
        </td>

        {/* Tag */}
        <td className="p-3">
          {tx.tag && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${getTagColorClass(tx.tag)}`}>
              {tx.tag}
            </span>
          )}
        </td>

        {/* Portfolio */}
        <td className="p-3 text-slate-500 text-sm">
          {item.portfolioName}
        </td>
      </tr>
    );
  };

  // Render mobile transaction card
  const renderTransactionCard = (item: FlattenedTransaction) => {
    const tx = item.transaction;
    const typeInfo = getTransactionTypeInfo(tx.type);
    const isSelected = selectedIds.has(tx.id);
    const isLinkedTransaction = tx.linkedBuySellTransactionId != null;

    return (
      <div
        key={tx.id}
        className={`bg-slate-800 border rounded-lg p-4 mb-3 ${
          isSelected ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700'
        }`}
        onClick={() => toggleSelection(tx.id)}
      >
        {/* Header: Asset + Type */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white">{item.assetTicker}</span>
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${typeInfo.bgClass}`}>
              {typeInfo.label}
            </span>
            {isLinkedTransaction && <Link2 size={14} className="text-indigo-400" />}
          </div>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              toggleSelection(tx.id);
            }}
            className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500 w-5 h-5"
          />
        </div>

        {/* Date */}
        <div className="text-sm text-slate-400 mb-3">{tx.date}</div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-slate-500 text-xs">Quantity</span>
            <div className="font-mono text-slate-200">
              {tx.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}
            </div>
          </div>
          <div className="text-right">
            <span className="text-slate-500 text-xs">@ Price</span>
            <div className="font-mono text-slate-200">
              {currencyFmt.format(tx.pricePerCoin)}
            </div>
          </div>
        </div>

        {/* Total */}
        <div className="mt-3 pt-3 border-t border-slate-700 flex justify-between items-center">
          <span className="text-slate-400 text-sm">Total</span>
          <span className="text-lg font-bold text-white">{currencyFmt.format(tx.totalCost)}</span>
        </div>

        {/* Footer: Tag + Portfolio */}
        <div className="mt-3 flex items-center justify-between">
          {tx.tag ? (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${getTagColorClass(tx.tag)}`}>
              {tx.tag}
            </span>
          ) : (
            <span />
          )}
          <span className="text-xs text-slate-500">{item.portfolioName}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-slate-900 min-h-screen">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 md:px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl md:text-2xl font-bold text-white">Transaction History</h1>
          <div className="text-xs md:text-sm text-slate-400">
            {filteredCount.toLocaleString()} of {totalCount.toLocaleString()}
          </div>
        </div>

        {/* Search Bar - Always Visible */}
        <div className="relative w-full mb-3">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchInputValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search transactions..."
            className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-10 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base"
          />
          {searchInputValue && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
            >
              <X size={18} />
            </button>
          )}
          {isSearchDebouncing && (
            <span className="absolute right-10 top-1/2 -translate-y-1/2 text-xs text-slate-500">
              ...
            </span>
          )}
        </div>

        {/* Mobile: Filter Toggle + Quick Actions */}
        <div className="flex md:hidden items-center gap-2 mb-3">
          <button
            onClick={() => setMobileFiltersExpanded(!mobileFiltersExpanded)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors touch-target ${
              mobileFiltersExpanded || hasActiveFilters
                ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                : 'bg-slate-800 border-slate-600 text-slate-400'
            }`}
          >
            <Filter size={16} />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-indigo-500 text-white rounded-full">
                {(filters.transactionTypes.length > 0 ? 1 : 0) +
                  (filters.assetTickers.length > 0 ? 1 : 0) +
                  (filters.tags.length > 0 ? 1 : 0) +
                  (filters.dateFrom || filters.dateTo ? 1 : 0)}
              </span>
            )}
            {mobileFiltersExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {/* Export Button - Mobile */}
          <button
            onClick={handleExport}
            disabled={filteredCount === 0}
            className="flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium transition-colors touch-target"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>

        {/* Mobile: Collapsible Filters */}
        {mobileFiltersExpanded && (
          <div className="md:hidden space-y-3 mb-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
            {/* Type + Asset Row */}
            <div className="grid grid-cols-2 gap-2">
              <select
                value={filters.transactionTypes.length === 1 ? filters.transactionTypes[0] : ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setTransactionTypes(value ? [value as any] : []);
                }}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Types</option>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
                <option value="DEPOSIT">Deposit</option>
                <option value="WITHDRAWAL">Withdraw</option>
                <option value="TRANSFER">Transfer</option>
                <option value="INCOME">Income</option>
              </select>

              <select
                value={filters.assetTickers.length === 1 ? filters.assetTickers[0] : ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setAssetTickers(value ? [value] : []);
                }}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Assets</option>
                {filterOptions.assets.map(asset => (
                  <option key={asset.ticker} value={asset.ticker}>
                    {asset.ticker}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range Row */}
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => setDateFrom(e.target.value || null)}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="From"
              />
              <input
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => setDateTo(e.target.value || null)}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="To"
              />
            </div>

            {/* Tag + Portfolio Scope */}
            <div className="grid grid-cols-2 gap-2">
              <select
                value={filters.tags.length === 1 ? filters.tags[0] : ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setTags(value ? [value] : []);
                }}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Tags</option>
                {filterOptions.tags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>

              <button
                onClick={() => setShowAllPortfolios(!showAllPortfolios)}
                className={`flex items-center justify-center gap-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  showAllPortfolios
                    ? 'bg-slate-800 border-slate-600 text-slate-400'
                    : 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                }`}
              >
                {showAllPortfolios ? <Layers size={14} /> : <FolderOpen size={14} />}
                <span className="truncate">{showAllPortfolios ? 'All' : activePortfolioName}</span>
              </button>
            </div>

            {/* Reset Button */}
            {hasActiveFilters && (
              <button
                onClick={resetAllFilters}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium transition-colors"
              >
                <RotateCcw size={14} />
                Reset Filters
              </button>
            )}
          </div>
        )}

        {/* Desktop: Filter Bar - Row 1 */}
        <div className="hidden md:flex flex-wrap items-center gap-3 mb-3">
          {/* Transaction Type Filter */}
          <select
            multiple={false}
            value={filters.transactionTypes.length === 1 ? filters.transactionTypes[0] : ''}
            onChange={(e) => {
              const value = e.target.value;
              setTransactionTypes(value ? [value as any] : []);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Types</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
            <option value="DEPOSIT">Deposit</option>
            <option value="WITHDRAWAL">Withdraw</option>
            <option value="TRANSFER">Transfer</option>
            <option value="INCOME">Income</option>
          </select>

          {/* Asset Filter */}
          <select
            value={filters.assetTickers.length === 1 ? filters.assetTickers[0] : ''}
            onChange={(e) => {
              const value = e.target.value;
              setAssetTickers(value ? [value] : []);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Assets</option>
            {filterOptions.assets.map(asset => (
              <option key={asset.ticker} value={asset.ticker}>
                {asset.ticker} - {asset.name}
              </option>
            ))}
          </select>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filters.dateFrom || ''}
              onChange={(e) => setDateFrom(e.target.value || null)}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="From"
            />
            <span className="text-slate-500">to</span>
            <input
              type="date"
              value={filters.dateTo || ''}
              onChange={(e) => setDateTo(e.target.value || null)}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="To"
            />
          </div>
        </div>

        {/* Desktop: Filter Bar - Row 2 */}
        <div className="hidden md:flex flex-wrap items-center gap-3">
          {/* Tag Filter */}
          <select
            value={filters.tags.length === 1 ? filters.tags[0] : ''}
            onChange={(e) => {
              const value = e.target.value;
              setTags(value ? [value] : []);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Tags</option>
            {filterOptions.tags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>

          {/* Portfolio Scope Toggle */}
          <button
            onClick={() => setShowAllPortfolios(!showAllPortfolios)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              showAllPortfolios
                ? 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-300'
                : 'bg-purple-500/20 border-purple-500/50 text-purple-300'
            }`}
            title={showAllPortfolios ? 'Showing all portfolios' : `Showing only ${activePortfolioName}`}
          >
            {showAllPortfolios ? <Layers size={16} /> : <FolderOpen size={16} />}
            {showAllPortfolios ? 'All Portfolios' : activePortfolioName}
          </button>

          {/* Linked Transaction Toggle */}
          <button
            onClick={() => setShowCombinedView(!showCombinedView)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              showCombinedView
                ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-300'
            }`}
          >
            {showCombinedView ? <Link2 size={16} /> : <Link2Off size={16} />}
            {showCombinedView ? 'Combined View' : 'Expanded View'}
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              onClick={resetAllFilters}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium transition-colors"
            >
              <RotateCcw size={16} />
              Reset Filters
            </button>
          )}

          {/* Export Buttons */}
          <div className="flex items-center gap-2">
            {/* Export Filtered - Primary style */}
            <button
              onClick={handleExport}
              disabled={filteredCount === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium transition-colors"
              title="Export currently filtered/selected transactions"
            >
              <Download size={16} />
              Export Filtered ({selectedIds.size > 0 ? selectedIds.size : filteredCount})
            </button>

            {/* Export All - Secondary/outline style */}
            <button
              onClick={handleExportAll}
              disabled={totalCount === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-500/50 hover:border-emerald-500 bg-transparent hover:bg-emerald-500/10 disabled:border-slate-600 disabled:text-slate-500 text-emerald-400 hover:text-emerald-300 text-sm font-medium transition-colors"
              title="Export all transactions (ignores filters)"
            >
              <Download size={16} />
              Export All ({totalCount})
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="px-4 md:px-6 py-4">
        {filteredCount === 0 ? (
          <div className="text-center py-12">
            <Filter size={48} className="mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg mb-2">No transactions found</p>
            <p className="text-slate-500 text-sm">
              {hasActiveFilters
                ? 'Try adjusting your filters or search query'
                : 'Add some transactions to get started'}
            </p>
            {hasActiveFilters && (
              <button
                onClick={resetAllFilters}
                className="mt-4 text-indigo-400 hover:text-indigo-300 text-sm"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Bulk Selection Info */}
            {selectedIds.size > 0 && (
              <div className="mb-4 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg flex items-center gap-4">
                <span className="text-indigo-300">
                  {selectedIds.size} transaction{selectedIds.size !== 1 ? 's' : ''} selected
                </span>
                <button
                  onClick={clearSelection}
                  className="text-indigo-400 hover:text-indigo-300 text-sm"
                >
                  Clear selection
                </button>
              </div>
            )}

            {/* Mobile: Card View */}
            <div className="md:hidden">
              {paginatedTransactions.map(renderTransactionCard)}
            </div>

            {/* Desktop: Table View */}
            <div className="hidden md:block bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-900/50 text-slate-400 text-sm">
                    <tr>
                      <th className="p-3 w-10">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={() => isAllSelected ? clearSelection() : selectAll()}
                          className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                        />
                      </th>
                      <th
                        className="p-3 cursor-pointer hover:text-slate-300 select-none"
                        onClick={() => toggleSort('date')}
                      >
                        Date <SortIndicator field="date" />
                      </th>
                      <th
                        className="p-3 cursor-pointer hover:text-slate-300 select-none"
                        onClick={() => toggleSort('type')}
                      >
                        Type <SortIndicator field="type" />
                      </th>
                      <th
                        className="p-3 cursor-pointer hover:text-slate-300 select-none"
                        onClick={() => toggleSort('asset')}
                      >
                        Asset <SortIndicator field="asset" />
                      </th>
                      <th
                        className="p-3 text-right cursor-pointer hover:text-slate-300 select-none"
                        onClick={() => toggleSort('quantity')}
                      >
                        Quantity <SortIndicator field="quantity" />
                      </th>
                      <th
                        className="p-3 text-right cursor-pointer hover:text-slate-300 select-none"
                        onClick={() => toggleSort('price')}
                      >
                        Price <SortIndicator field="price" />
                      </th>
                      <th
                        className="p-3 text-right cursor-pointer hover:text-slate-300 select-none"
                        onClick={() => toggleSort('total')}
                      >
                        Total <SortIndicator field="total" />
                      </th>
                      <th
                        className="p-3 cursor-pointer hover:text-slate-300 select-none"
                        onClick={() => toggleSort('tag')}
                      >
                        Tag <SortIndicator field="tag" />
                      </th>
                      <th className="p-3">Portfolio</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {paginatedTransactions.map(renderTransactionRow)}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 md:gap-4 w-full md:w-auto justify-between md:justify-start">
                <span className="text-slate-400 text-xs md:text-sm">
                  {pagination.displayStart}-{pagination.displayEnd} of {filteredCount}
                </span>
                <select
                  value={pagination.pageSize}
                  onChange={(e) => pagination.setPageSize(Number(e.target.value) as any)}
                  className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={pagination.goToFirstPage}
                  disabled={!pagination.hasPreviousPage}
                  className="p-2 rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-400 touch-target"
                >
                  <ChevronsLeft size={18} />
                </button>
                <button
                  onClick={pagination.goToPreviousPage}
                  disabled={!pagination.hasPreviousPage}
                  className="p-2 rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-400 touch-target"
                >
                  <ChevronLeft size={18} />
                </button>

                {/* Mobile: Show fewer page numbers */}
                <span className="md:hidden px-3 py-1 text-sm text-slate-400">
                  {pagination.currentPage} / {pagination.totalPages}
                </span>

                {/* Desktop: Full page numbers */}
                <div className="hidden md:flex items-center gap-1">
                  {getPageNumbers(pagination.currentPage, pagination.totalPages).map((page, index) => (
                    page === 'ellipsis' ? (
                      <span key={`ellipsis-${index}`} className="px-2 text-slate-500">...</span>
                    ) : (
                      <button
                        key={page}
                        onClick={() => pagination.goToPage(page)}
                        className={`px-3 py-1 rounded text-sm ${
                          page === pagination.currentPage
                            ? 'bg-indigo-600 text-white'
                            : 'hover:bg-slate-700 text-slate-400'
                        }`}
                      >
                        {page}
                      </button>
                    )
                  ))}
                </div>

                <button
                  onClick={pagination.goToNextPage}
                  disabled={!pagination.hasNextPage}
                  className="p-2 rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-400 touch-target"
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={pagination.goToLastPage}
                  disabled={!pagination.hasNextPage}
                  className="p-2 rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-400 touch-target"
                >
                  <ChevronsRight size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
