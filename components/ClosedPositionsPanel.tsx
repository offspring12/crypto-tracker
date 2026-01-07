import React, { useState, useMemo } from 'react';
import { ClosedPosition, Currency, TransactionTag } from '../types';
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Calendar, Tag, Undo2, Filter } from 'lucide-react';

interface ClosedPositionsPanelProps {
  closedPositions: ClosedPosition[];
  displayCurrency: Currency;
  onUndo?: (positionId: string) => void;
}

type SortField = 'closedAt' | 'realizedPnL' | 'ticker' | 'holdingPeriodDays';
type SortDirection = 'asc' | 'desc';

export const ClosedPositionsPanel: React.FC<ClosedPositionsPanelProps> = ({
  closedPositions,
  displayCurrency,
  onUndo
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter states
  const [filterTicker, setFilterTicker] = useState<string>('');
  const [filterTag, setFilterTag] = useState<TransactionTag | 'All'>('All');
  const [filterProfitable, setFilterProfitable] = useState<'All' | 'Profit' | 'Loss'>('All');

  // Sort states
  const [sortField, setSortField] = useState<SortField>('closedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Get unique tickers and tags for filters
  const { uniqueTickers, uniqueTags } = useMemo(() => {
    const tickers = new Set(closedPositions.map(p => p.ticker));
    const tags = new Set<TransactionTag>();
    closedPositions.forEach(p => {
      if (p.exitTag) tags.add(p.exitTag);
    });
    return {
      uniqueTickers: Array.from(tickers).sort(),
      uniqueTags: Array.from(tags).sort()
    };
  }, [closedPositions]);

  // Filter and sort positions
  const filteredPositions = useMemo(() => {
    let filtered = [...closedPositions];

    // Apply ticker filter
    if (filterTicker) {
      filtered = filtered.filter(p => p.ticker.toLowerCase().includes(filterTicker.toLowerCase()));
    }

    // Apply tag filter
    if (filterTag !== 'All') {
      filtered = filtered.filter(p => p.exitTag === filterTag);
    }

    // Apply profitability filter
    if (filterProfitable === 'Profit') {
      filtered = filtered.filter(p => p.realizedPnL > 0);
    } else if (filterProfitable === 'Loss') {
      filtered = filtered.filter(p => p.realizedPnL < 0);
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sortField) {
        case 'closedAt':
          aVal = new Date(a.closedAt).getTime();
          bVal = new Date(b.closedAt).getTime();
          break;
        case 'realizedPnL':
          aVal = a.realizedPnL;
          bVal = b.realizedPnL;
          break;
        case 'ticker':
          aVal = a.ticker;
          bVal = b.ticker;
          break;
        case 'holdingPeriodDays':
          aVal = a.holdingPeriodDays;
          bVal = b.holdingPeriodDays;
          break;
        default:
          aVal = 0;
          bVal = 0;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    return filtered;
  }, [closedPositions, filterTicker, filterTag, filterProfitable, sortField, sortDirection]);

  // Calculate summary stats
  const summary = useMemo(() => {
    const totalPnL = filteredPositions.reduce((sum, p) => sum + p.realizedPnL, 0);
    const profitableCount = filteredPositions.filter(p => p.realizedPnL > 0).length;
    const winRate = filteredPositions.length > 0 ? (profitableCount / filteredPositions.length) * 100 : 0;

    return {
      totalPnL,
      count: filteredPositions.length,
      profitableCount,
      winRate
    };
  }, [filteredPositions]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  if (closedPositions.length === 0) {
    return null; // Don't show panel if no closed positions
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-700 rounded-lg">
            <Calendar className="text-slate-300" size={20} />
          </div>
          <div className="text-left">
            <h2 className="text-lg font-bold text-white">Closed Positions</h2>
            <p className="text-xs text-slate-400">
              {closedPositions.length} completed trade{closedPositions.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Summary stats */}
          <div className="text-right">
            <div className={`text-sm font-bold ${summary.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {summary.totalPnL >= 0 ? '+' : ''}{displayCurrency} {summary.totalPnL.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </div>
            <div className="text-xs text-slate-400">
              Win Rate: {summary.winRate.toFixed(0)}%
            </div>
          </div>
          {isExpanded ? <ChevronUp className="text-slate-400" size={20} /> : <ChevronDown className="text-slate-400" size={20} />}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-slate-700">
          {/* Filters */}
          <div className="px-6 py-4 bg-slate-900/50 border-b border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={16} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-300">Filters</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Ticker filter */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Ticker</label>
                <input
                  type="text"
                  value={filterTicker}
                  onChange={(e) => setFilterTicker(e.target.value)}
                  placeholder="Search ticker..."
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              {/* Tag filter */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Tag</label>
                <select
                  value={filterTag}
                  onChange={(e) => setFilterTag(e.target.value as TransactionTag | 'All')}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="All">All Tags</option>
                  {uniqueTags.map(tag => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
              </div>

              {/* Profitability filter */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Result</label>
                <select
                  value={filterProfitable}
                  onChange={(e) => setFilterProfitable(e.target.value as 'All' | 'Profit' | 'Loss')}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="All">All Results</option>
                  <option value="Profit">Profitable Only</option>
                  <option value="Loss">Losses Only</option>
                </select>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/50 text-slate-400 text-xs uppercase">
                <tr>
                  <th
                    className="px-4 py-3 text-left cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('ticker')}
                  >
                    <div className="flex items-center gap-1">
                      Asset <SortIcon field="ticker" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right">Entry</th>
                  <th className="px-4 py-3 text-right">Exit</th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('holdingPeriodDays')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Holding <SortIcon field="holdingPeriodDays" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('realizedPnL')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Realized P&L <SortIcon field="realizedPnL" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('closedAt')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Closed Date <SortIcon field="closedAt" />
                    </div>
                  </th>
                  {onUndo && <th className="px-4 py-3 text-center">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {filteredPositions.length === 0 ? (
                  <tr>
                    <td colSpan={onUndo ? 7 : 6} className="px-4 py-8 text-center text-slate-500">
                      No closed positions match your filters
                    </td>
                  </tr>
                ) : (
                  filteredPositions.map((position) => (
                    <tr key={position.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-medium text-white">{position.ticker}</div>
                            <div className="text-xs text-slate-400">{position.name}</div>
                          </div>
                          {position.exitTag && (
                            <span className="px-2 py-0.5 bg-slate-700 text-xs text-slate-300 rounded">
                              {position.exitTag}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-white">
                          {position.entryQuantity.toLocaleString('en-US', { maximumFractionDigits: 8 })} @ {position.entryCurrency} {position.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs text-slate-400">
                          {new Date(position.entryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-white">
                          {position.exitQuantity.toLocaleString('en-US', { maximumFractionDigits: 8 })} @ {position.exitCurrency} {position.exitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs text-slate-400">
                          {new Date(position.exitDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {position.holdingPeriodDays} day{position.holdingPeriodDays !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className={`flex items-center justify-end gap-1 font-bold ${position.realizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {position.realizedPnL >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                          <span>
                            {position.realizedPnL >= 0 ? '+' : ''}{displayCurrency} {position.realizedPnL.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}
                          </span>
                        </div>
                        <div className={`text-xs ${position.realizedPnLPercent >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {position.realizedPnLPercent >= 0 ? '+' : ''}{position.realizedPnLPercent.toFixed(2)}%
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {new Date(position.closedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      {onUndo && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => onUndo(position.id)}
                            className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors"
                            title="Undo this transaction (restore to open position)"
                          >
                            <Undo2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer summary */}
          {filteredPositions.length > 0 && (
            <div className="px-6 py-3 bg-slate-900/50 border-t border-slate-700 flex items-center justify-between text-xs">
              <div className="text-slate-400">
                Showing {filteredPositions.length} of {closedPositions.length} closed position{closedPositions.length !== 1 ? 's' : ''}
              </div>
              <div className="flex items-center gap-4">
                <div className="text-slate-400">
                  Win Rate: <span className="text-white font-medium">{summary.winRate.toFixed(1)}%</span> ({summary.profitableCount}/{filteredPositions.length})
                </div>
                <div className="text-slate-400">
                  Total: <span className={`font-bold ${summary.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {summary.totalPnL >= 0 ? '+' : ''}{displayCurrency} {summary.totalPnL.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
