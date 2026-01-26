/**
 * CSV Export Utility
 *
 * Provides functions for generating and downloading CSV files from transaction data.
 * Uses native browser APIs (Blob, URL) without external dependencies.
 */

import { FlattenedTransaction } from './transactionHelpers';
import { Asset, Currency, ClosedPosition, AssetNote } from '../types';
import { convertCurrencySync } from '../services/currencyService';

/**
 * Holdings data structure for CSV export
 * Contains all calculated fields for a single asset holding
 */
export interface HoldingExportData {
  portfolioName: string;
  assetSymbol: string;
  assetName: string;
  assetType: string;
  strategy: string; // From tag field
  tags: string;
  quantity: number;
  currentPriceDisplay: number;
  currentPriceNative: number;
  nativeCurrency: string;
  currentValue: number;
  allocationPercent: number;
  avgCostDisplay: number;
  totalCostBasis: number;
  originalCurrency: string;
  costBasisMethod: string;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  realizedPnL: number;
  totalPnL: number;
  totalPnLPercent: number;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  numTransactions: number;
  totalInvested: number;
  exportDate: string;
  displayCurrency: string;
  note: string; // User note for this holding
}

/**
 * Escape a value for CSV format
 * Handles: commas, quotes, newlines
 */
function escapeCSVValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // Check if escaping is needed
  const needsEscaping = stringValue.includes(',') ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r');

  if (needsEscaping) {
    // Escape double quotes by doubling them, then wrap in quotes
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Generate CSV content from flattened transactions
 */
export function generateTransactionCSV(transactions: FlattenedTransaction[]): string {
  // Define CSV headers
  const headers = [
    'Date',
    'Time',
    'Type',
    'Portfolio',
    'Asset Ticker',
    'Asset Name',
    'Asset Type',
    'Quantity',
    'Price Per Unit',
    'Total Value',
    'Currency',
    'Tag',
    // BUY specific
    'Source Asset',
    'Source Quantity',
    // SELL specific
    'Proceeds Currency',
    'Proceeds Amount',
    // DEPOSIT specific
    'Deposit Source',
    'Cost Basis',
    // WITHDRAWAL specific
    'Withdrawal Destination',
    // TRANSFER specific
    'Destination Portfolio ID',
    // INCOME specific
    'Income Type',
    'Income Source',
    // Metadata
    'Transaction ID',
    'Linked Transaction ID',
    'Transaction Pair ID',
    'Created At',
    'Last Edited',
  ];

  const rows: string[] = [headers.map(escapeCSVValue).join(',')];

  for (const item of transactions) {
    const tx = item.transaction;

    // Parse date and time
    const dateObj = new Date(tx.date);
    const dateStr = tx.date; // Keep original date string
    const timeStr = tx.createdAt
      ? new Date(tx.createdAt).toLocaleTimeString('en-US', { hour12: false })
      : '';

    const row = [
      dateStr,
      timeStr,
      tx.type,
      item.portfolioName,
      item.assetTicker,
      item.assetName,
      item.assetType,
      tx.quantity,
      tx.pricePerCoin,
      tx.totalCost,
      item.assetCurrency,
      tx.tag || '',
      // BUY specific
      tx.sourceTicker || '',
      tx.sourceQuantity || '',
      // SELL specific
      tx.proceedsCurrency || '',
      tx.proceeds || '',
      // DEPOSIT specific
      tx.depositSource || '',
      tx.costBasis || '',
      // WITHDRAWAL specific
      tx.withdrawalDestination || '',
      // TRANSFER specific
      tx.destinationPortfolioId || '',
      // INCOME specific
      tx.incomeType || '',
      tx.incomeSource || '',
      // Metadata
      tx.id,
      tx.linkedBuySellTransactionId || '',
      tx.transactionPairId || '',
      tx.createdAt || '',
      tx.lastEdited || '',
    ];

    rows.push(row.map(escapeCSVValue).join(','));
  }

  return rows.join('\n');
}

/**
 * Generate a filename for the CSV export
 */
export function generateExportFilename(prefix: string = 'transactions'): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  return `${prefix}_export_${dateStr}.csv`;
}

/**
 * Download CSV content as a file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  // Create a Blob with the CSV content
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  // Create a download link
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  // Append to body, click, and remove
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  URL.revokeObjectURL(url);
}

/**
 * Export transactions to CSV and trigger download
 * Main entry point for CSV export functionality
 */
export function exportTransactionsToCSV(
  transactions: FlattenedTransaction[],
  filenamePrefix: string = 'transactions'
): void {
  if (transactions.length === 0) {
    console.warn('No transactions to export');
    return;
  }

  const csvContent = generateTransactionCSV(transactions);
  const filename = generateExportFilename(filenamePrefix);

  downloadCSV(csvContent, filename);

  console.log(`Exported ${transactions.length} transactions to ${filename}`);
}

/**
 * Generate a summary row for the CSV (optional footer)
 */
export function generateCSVSummary(transactions: FlattenedTransaction[]): string {
  const totalTransactions = transactions.length;
  const totalValue = transactions.reduce((sum, t) => sum + t.transaction.totalCost, 0);

  const byType = transactions.reduce((acc, t) => {
    acc[t.transaction.type] = (acc[t.transaction.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const summaryLines = [
    '',
    `Total Transactions: ${totalTransactions}`,
    `Total Value: ${totalValue.toLocaleString()}`,
    '',
    'Breakdown by Type:',
    ...Object.entries(byType).map(([type, count]) => `  ${type}: ${count}`),
  ];

  return summaryLines.join('\n');
}

// ============================================================================
// HOLDINGS CSV EXPORT
// ============================================================================

/**
 * Helper to detect currency from ticker when asset.currency is missing
 */
function detectCurrencyFromTicker(ticker: string): string {
  const upper = ticker.toUpperCase();

  // Cash currencies
  if (['CHF', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'USD'].includes(upper)) {
    return upper;
  }

  // Stock exchanges by suffix
  if (upper.endsWith('.SW')) return 'CHF';
  if (upper.endsWith('.DE') || upper.endsWith('.F')) return 'EUR';
  if (upper.endsWith('.L')) return 'GBP';
  if (upper.endsWith('.T')) return 'JPY';
  if (upper.endsWith('.TO')) return 'CAD';
  if (upper.endsWith('.AX')) return 'AUD';

  return 'USD';
}

/**
 * Calculate holding export data for a single asset
 */
export function calculateHoldingData(
  asset: Asset,
  portfolioName: string,
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  totalPortfolioValue: number,
  closedPositions: ClosedPosition[],
  note?: string
): HoldingExportData {
  const nativeCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);
  const exportDate = new Date().toISOString().split('T')[0];

  // Current price in native currency
  const currentPriceNative = asset.currentPrice;

  // Convert current price to display currency
  const fxCurrency = ['USDT', 'USDC', 'DAI'].includes(nativeCurrency) ? 'USD' : nativeCurrency;
  const currentPriceDisplay = convertCurrencySync(currentPriceNative, fxCurrency, displayCurrency, exchangeRates);

  // Current value in display currency
  const currentValue = asset.quantity * currentPriceDisplay;

  // Allocation percentage
  const allocationPercent = totalPortfolioValue > 0 ? (currentValue / totalPortfolioValue) * 100 : 0;

  // Calculate cost basis from transactions (in display currency)
  let totalCostBasis = 0;
  let totalInvested = 0;
  const acquisitionTransactions = asset.transactions.filter(
    tx => tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'INCOME'
  );

  for (const tx of acquisitionTransactions) {
    let costInDisplay = 0;
    if (tx.exchangeRateAtPurchase && tx.purchaseCurrency) {
      costInDisplay = convertCurrencySync(
        tx.totalCost,
        tx.purchaseCurrency,
        displayCurrency,
        tx.exchangeRateAtPurchase
      );
    } else {
      costInDisplay = convertCurrencySync(tx.totalCost, fxCurrency, displayCurrency, exchangeRates);
    }
    totalCostBasis += costInDisplay;
    totalInvested += costInDisplay;
  }

  // Subtract disposal transactions from cost basis
  const disposalTransactions = asset.transactions.filter(
    tx => tx.type === 'SELL' || tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER'
  );

  for (const tx of disposalTransactions) {
    let costInDisplay = 0;
    if (tx.exchangeRateAtPurchase && tx.purchaseCurrency) {
      costInDisplay = convertCurrencySync(
        tx.totalCost,
        tx.purchaseCurrency,
        displayCurrency,
        tx.exchangeRateAtPurchase
      );
    } else {
      costInDisplay = convertCurrencySync(tx.totalCost, fxCurrency, displayCurrency, exchangeRates);
    }
    totalCostBasis -= costInDisplay;
  }

  // Average cost per unit
  const avgCostDisplay = asset.quantity > 0 ? totalCostBasis / asset.quantity : 0;

  // Unrealized P&L
  const unrealizedPnL = currentValue - totalCostBasis;
  const unrealizedPnLPercent = totalCostBasis > 0 ? (unrealizedPnL / totalCostBasis) * 100 : 0;

  // Realized P&L from closed positions for this asset
  const assetClosedPositions = closedPositions.filter(
    pos => pos.ticker.toUpperCase() === asset.ticker.toUpperCase()
  );
  const realizedPnL = assetClosedPositions.reduce((sum, pos) => sum + pos.realizedPnL, 0);

  // Total P&L
  const totalPnL = unrealizedPnL + realizedPnL;
  const totalCostBasisWithRealized = totalCostBasis + assetClosedPositions.reduce((sum, pos) => sum + pos.entryCostBasis, 0);
  const totalPnLPercent = totalCostBasisWithRealized > 0 ? (totalPnL / totalCostBasisWithRealized) * 100 : 0;

  // Transaction dates and count
  const sortedTransactions = [...asset.transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const firstPurchaseDate = sortedTransactions.length > 0 ? sortedTransactions[0].date : 'N/A';
  const lastPurchaseDate = sortedTransactions.length > 0
    ? sortedTransactions[sortedTransactions.length - 1].date
    : 'N/A';
  const numTransactions = asset.transactions.length;

  // Collect unique tags (strategy)
  const tags = [...new Set(asset.transactions.map(tx => tx.tag).filter(Boolean))];
  const strategy = tags[0] || ''; // Primary strategy is first tag

  // Original currency (most common purchase currency)
  const purchaseCurrencies = asset.transactions
    .map(tx => tx.purchaseCurrency)
    .filter(Boolean);
  const originalCurrency = purchaseCurrencies.length > 0
    ? purchaseCurrencies[0] || nativeCurrency
    : nativeCurrency;

  return {
    portfolioName,
    assetSymbol: asset.ticker,
    assetName: asset.name || asset.ticker,
    assetType: asset.assetType || 'CRYPTO',
    strategy,
    tags: tags.join(', '),
    quantity: asset.quantity,
    currentPriceDisplay,
    currentPriceNative,
    nativeCurrency,
    currentValue,
    allocationPercent,
    avgCostDisplay,
    totalCostBasis,
    originalCurrency: originalCurrency as string,
    costBasisMethod: 'FIFO',
    unrealizedPnL,
    unrealizedPnLPercent,
    realizedPnL,
    totalPnL,
    totalPnLPercent,
    firstPurchaseDate,
    lastPurchaseDate,
    numTransactions,
    totalInvested,
    exportDate,
    displayCurrency,
    note: note || '',
  };
}

/**
 * Generate CSV content from holdings data
 */
export function generateHoldingsCSV(holdings: HoldingExportData[]): string {
  // CSV headers matching the 25+ column spec
  const headers = [
    'Portfolio Name',
    'Asset Symbol',
    'Asset Name',
    'Asset Type',
    'Strategy',
    'Tags',
    'Quantity Held',
    `Current Price (Display)`,
    `Current Price (Native)`,
    'Native Currency',
    `Current Value`,
    'Allocation %',
    `Avg Cost Per Unit`,
    `Total Cost Basis`,
    'Original Currency',
    'Cost Basis Method',
    `Unrealized P&L`,
    'Unrealized P&L %',
    `Realized P&L`,
    `Total P&L`,
    'Total P&L %',
    'First Purchase Date',
    'Last Purchase Date',
    'Num Transactions',
    `Total Invested`,
    'Export Date',
    'Display Currency',
    'Notes', // User notes for this holding
  ];

  const rows: string[] = [headers.map(escapeCSVValue).join(',')];

  for (const holding of holdings) {
    const row = [
      holding.portfolioName,
      holding.assetSymbol,
      holding.assetName,
      holding.assetType,
      holding.strategy,
      holding.tags,
      holding.quantity,
      holding.currentPriceDisplay.toFixed(2),
      `${holding.currentPriceNative.toFixed(2)} ${holding.nativeCurrency}`,
      holding.nativeCurrency,
      holding.currentValue.toFixed(2),
      `${holding.allocationPercent.toFixed(2)}%`,
      holding.avgCostDisplay.toFixed(2),
      holding.totalCostBasis.toFixed(2),
      holding.originalCurrency,
      holding.costBasisMethod,
      holding.unrealizedPnL.toFixed(2),
      `${holding.unrealizedPnLPercent.toFixed(2)}%`,
      holding.realizedPnL.toFixed(2),
      holding.totalPnL.toFixed(2),
      `${holding.totalPnLPercent.toFixed(2)}%`,
      holding.firstPurchaseDate,
      holding.lastPurchaseDate,
      holding.numTransactions,
      holding.totalInvested.toFixed(2),
      holding.exportDate,
      holding.displayCurrency,
      holding.note, // User note
    ];

    rows.push(row.map(escapeCSVValue).join(','));
  }

  return rows.join('\n');
}

/**
 * Generate filename for holdings export
 */
export function generateHoldingsFilename(portfolioName: string): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  // Sanitize portfolio name for filename
  const safeName = portfolioName.replace(/[^a-zA-Z0-9]/g, '_');
  return `holdings_${safeName}_${dateStr}.csv`;
}

/**
 * Generate filename for all transactions export
 */
export function generateAllTransactionsFilename(portfolioName: string): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const safeName = portfolioName.replace(/[^a-zA-Z0-9]/g, '_');
  return `transactions_all_${safeName}_${dateStr}.csv`;
}

/**
 * Export holdings to CSV and trigger download
 * Main entry point for holdings CSV export
 */
export function exportHoldingsToCSV(
  assets: Asset[],
  portfolioName: string,
  displayCurrency: Currency,
  exchangeRates: Record<string, number>,
  closedPositions: ClosedPosition[],
  assetNotes?: AssetNote[]
): { success: boolean; count: number; error?: string } {
  if (assets.length === 0) {
    return { success: false, count: 0, error: 'No holdings to export' };
  }

  try {
    // Calculate total portfolio value first (for allocation %)
    let totalPortfolioValue = 0;
    for (const asset of assets) {
      const nativeCurrency = asset.currency || detectCurrencyFromTicker(asset.ticker);
      const fxCurrency = ['USDT', 'USDC', 'DAI'].includes(nativeCurrency) ? 'USD' : nativeCurrency;
      const valueInDisplay = convertCurrencySync(
        asset.quantity * asset.currentPrice,
        fxCurrency,
        displayCurrency,
        exchangeRates
      );
      totalPortfolioValue += valueInDisplay;
    }

    // Calculate holding data for each asset
    const holdingsData: HoldingExportData[] = assets
      .filter(asset => asset.quantity > 0) // Only export assets with holdings
      .map(asset => {
        // Find note for this asset
        const assetNote = assetNotes?.find(
          n => n.assetSymbol.toUpperCase() === asset.ticker.toUpperCase()
        );
        return calculateHoldingData(
          asset,
          portfolioName,
          displayCurrency,
          exchangeRates,
          totalPortfolioValue,
          closedPositions,
          assetNote?.note
        );
      });

    if (holdingsData.length === 0) {
      return { success: false, count: 0, error: 'No holdings with positive quantity to export' };
    }

    const csvContent = generateHoldingsCSV(holdingsData);
    const filename = generateHoldingsFilename(portfolioName);

    downloadCSV(csvContent, filename);

    console.log(`Exported ${holdingsData.length} holdings to ${filename}`);
    return { success: true, count: holdingsData.length };
  } catch (error) {
    console.error('Error exporting holdings:', error);
    return { success: false, count: 0, error: String(error) };
  }
}

/**
 * Export all transactions to CSV (ignoring filters)
 * Uses existing generateTransactionCSV but with custom filename
 */
export function exportAllTransactionsToCSV(
  transactions: FlattenedTransaction[],
  portfolioName: string = 'All_Portfolios'
): { success: boolean; count: number; error?: string } {
  if (transactions.length === 0) {
    return { success: false, count: 0, error: 'No transactions to export' };
  }

  try {
    const csvContent = generateTransactionCSV(transactions);
    const filename = generateAllTransactionsFilename(portfolioName);

    downloadCSV(csvContent, filename);

    console.log(`Exported ${transactions.length} transactions to ${filename}`);
    return { success: true, count: transactions.length };
  } catch (error) {
    console.error('Error exporting transactions:', error);
    return { success: false, count: 0, error: String(error) };
  }
}
