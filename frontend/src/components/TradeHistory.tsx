import React, { useState, useMemo } from 'react';

interface Trade {
  id: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  entryPrice: number;
  sl?: number;
  tp?: number;
  lotSize: number;
  openTime: string;
  closeTime?: string;
  closePrice?: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'OPEN' | 'CLOSED';
  matchedMessage: {
    initial: string;
    edited?: string;
  };
  peakPrice?: number;
  strategyId?: string;
  strategyName?: string;
  mode?: 'LIVE' | 'PAPER';
}

export interface Strategy {
  id: string;
  name: string;
  isActive: boolean;
  channels: string[];
  trading: {
    lotSize: number;
    symbol: string;
    closeTimeoutMinutes: number;
    maxRetries: number;
    retryDelayMs: number;
    trailingStopDistance: number;
    listenToReplies: boolean;
  };
}

interface StrategySummaryRow {
  strategyId: string;
  strategyName: string;
  spotPnlSum: number;
  spotPnlAvg: number;
  totalTrades: number;
  winRate: number;
  wins: number;
  losses: number;
  bestTrade: number | null;
  worstTrade: number | null;
  avgTrade: number;
  avgWin: number | null;
  avgLoss: number | null;
  largestDD: number | null;
  earliestOpen: string | null;
  latestClose: string | null;
}

interface TradeHistoryProps {
  trades: Trade[];
  strategies?: Strategy[];
}

const TradeTooltip: React.FC<{ trade: Trade }> = ({ trade }) => {
  return (
    <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-10">
      <div className="bg-trade-black border border-trade-green rounded-lg p-3 text-xs w-64 shadow-lg">
        <div className="mb-2">
          <span className="text-trade-gray">Initial Message:</span>
          <p className="text-trade-green mt-1 font-mono">{trade.matchedMessage.initial}</p>
        </div>
        {trade.matchedMessage.edited && (
          <div>
            <span className="text-trade-gray">Edited Message:</span>
            <p className="text-trade-yellow mt-1 font-mono whitespace-pre-wrap">{trade.matchedMessage.edited}</p>
          </div>
        )}
      </div>
    </div>
  );
};

type DateFilter = '24h' | '7d' | '30d' | 'all';

export const TradeHistory: React.FC<TradeHistoryProps> = ({ trades, strategies }) => {
  const [showTooltip, setShowTooltip] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  const formatPrice = (price: number) => price.toFixed(2);

  // Filter and sort trades
  const filteredTrades = useMemo(() => {
    const now = new Date();
    let filtered = trades;

    // Apply date filter
    if (dateFilter !== 'all') {
      const cutoffDate = new Date();
      switch (dateFilter) {
        case '24h':
          cutoffDate.setHours(now.getHours() - 24);
          break;
        case '7d':
          cutoffDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          cutoffDate.setDate(now.getDate() - 30);
          break;
      }
      
      filtered = trades.filter(trade => {
        const closeTime = trade.closeTime ? new Date(trade.closeTime) : null;
        return closeTime && closeTime >= cutoffDate;
      });
    }

    // Sort by most recent first (descending order by close time)
    return filtered.sort((a, b) => {
      const timeA = a.closeTime ? new Date(a.closeTime).getTime() : 0;
      const timeB = b.closeTime ? new Date(b.closeTime).getTime() : 0;
      return timeB - timeA;
    });
  }, [trades, dateFilter]);

  // Calculate total PnL
  const totalPnL = useMemo(() => {
    return filteredTrades.reduce((sum, trade) => {
      return sum + (trade.pnl || 0);
    }, 0);
  }, [filteredTrades]);

  const getFilterLabel = (filter: DateFilter): string => {
    switch (filter) {
      case '24h': return 'Last 24 Hours';
      case '7d': return 'Last 7 Days';
      case '30d': return 'Last 30 Days';
      case 'all': return 'All Time';
    }
  };

  // Strategy summary computation
  const strategySummary = useMemo((): StrategySummaryRow[] => {
    // Build a map of all strategy IDs from the strategies prop
    const strategyMap = new Map<string, string>();
    if (strategies) {
      strategies.forEach(s => strategyMap.set(s.id, s.name));
    }

    // Collect all unique strategyIds from trades
    const tradeStrategyIds = new Set<string>();
    trades.forEach(t => {
      if (t.strategyId) tradeStrategyIds.add(t.strategyId);
    });

    // Merge: all strategies from prop + any from trades
    const allIds = new Set([...strategyMap.keys(), ...tradeStrategyIds]);
    if (allIds.size === 0) return [];

    const rows: StrategySummaryRow[] = [];

    for (const id of allIds) {
      const name = strategyMap.get(id) ||
        trades.find(t => t.strategyId === id)?.strategyName ||
        'Unknown';

      const stratTrades = trades.filter(t => t.strategyId === id);

      const pnls = stratTrades.map(t => t.pnl || 0);
      const pnlPercents = stratTrades.map(t => t.pnlPercent || 0);
      const wins = stratTrades.filter(t => (t.pnl || 0) > 0);
      const losses = stratTrades.filter(t => (t.pnl || 0) <= 0);

      const winPnls = wins.map(t => t.pnl || 0);
      const lossPnls = losses.map(t => t.pnl || 0);

      const opens = stratTrades.map(t => t.openTime).filter((t): t is string => !!t).sort();
      const closes = stratTrades.map(t => t.closeTime).filter((t): t is string => !!t).sort();

      rows.push({
        strategyId: id,
        strategyName: name,
        spotPnlSum: pnlPercents.reduce((a, b) => a + b, 0),
        spotPnlAvg: pnlPercents.length > 0 ? pnlPercents.reduce((a, b) => a + b, 0) / pnlPercents.length : 0,
        totalTrades: stratTrades.length,
        winRate: stratTrades.length > 0 ? (wins.length / stratTrades.length) * 100 : 0,
        wins: wins.length,
        losses: losses.length,
        bestTrade: pnls.length > 0 ? Math.max(...pnls) : null,
        worstTrade: pnls.length > 0 ? Math.min(...pnls) : null,
        avgTrade: pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0,
        avgWin: winPnls.length > 0 ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : null,
        avgLoss: lossPnls.length > 0 ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length : null,
        largestDD: lossPnls.length > 0 ? Math.min(...lossPnls) : null,
        earliestOpen: opens.length > 0 ? opens[0] : null,
        latestClose: closes.length > 0 ? closes[closes.length - 1] : null,
      });
    }

    return rows;
  }, [trades, strategies]);

  // Total row
  const totalRow = useMemo((): StrategySummaryRow | null => {
    if (trades.length === 0) return null;

    const pnls = trades.map(t => t.pnl || 0);
    const pnlPercents = trades.map(t => t.pnlPercent || 0);
    const wins = trades.filter(t => (t.pnl || 0) > 0);
    const losses = trades.filter(t => (t.pnl || 0) <= 0);
    const winPnls = wins.map(t => t.pnl || 0);
    const lossPnls = losses.map(t => t.pnl || 0);
    const opens = trades.map(t => t.openTime).filter((t): t is string => !!t).sort();
    const closes = trades.map(t => t.closeTime).filter((t): t is string => !!t).sort();

    return {
      strategyId: '__total__',
      strategyName: 'Total',
      spotPnlSum: pnlPercents.reduce((a, b) => a + b, 0),
      spotPnlAvg: pnlPercents.length > 0 ? pnlPercents.reduce((a, b) => a + b, 0) / pnlPercents.length : 0,
      totalTrades: trades.length,
      winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      wins: wins.length,
      losses: losses.length,
      bestTrade: pnls.length > 0 ? Math.max(...pnls) : null,
      worstTrade: pnls.length > 0 ? Math.min(...pnls) : null,
      avgTrade: pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0,
      avgWin: winPnls.length > 0 ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : null,
      avgLoss: lossPnls.length > 0 ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length : null,
      largestDD: lossPnls.length > 0 ? Math.min(...lossPnls) : null,
      earliestOpen: opens.length > 0 ? opens[0] : null,
      latestClose: closes.length > 0 ? closes[closes.length - 1] : null,
    };
  }, [trades]);

  return (
    <div className="bg-trade-dark rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-trade-green">Trade History</h3>
        
        <div className="flex items-center gap-3">
          {/* Date Filter */}
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="bg-trade-card border border-trade-gray rounded px-2 py-1 text-xs text-trade-gray"
          >
            <option value="24h">{getFilterLabel('24h')}</option>
            <option value="7d">{getFilterLabel('7d')}</option>
            <option value="30d">{getFilterLabel('30d')}</option>
            <option value="all">{getFilterLabel('all')}</option>
          </select>

          {/* Total PnL Summary */}
          {filteredTrades.length > 0 && (
            <div className="text-xs">
              <span className="text-trade-gray">Total PnL: </span>
              <span className={totalPnL >= 0 ? 'text-trade-green font-semibold' : 'text-trade-red font-semibold'}>
                ${totalPnL.toFixed(2)}
              </span>
              <span className="text-trade-gray ml-1">({filteredTrades.length} trades)</span>
            </div>
          )}
        </div>
      </div>

      {filteredTrades.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-trade-gray text-sm mb-2">
            {dateFilter === 'all' ? 'No trade history' : `No trades in ${getFilterLabel(dateFilter).toLowerCase()}`}
          </p>
          <p className="text-trade-gray text-xs">
            Closed trades will appear here
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-trade-gray border-b border-trade-card">
                <th className="text-left py-2 px-2">Symbol</th>
                <th className="text-left py-2 px-2">Strategy</th>
                <th className="text-left py-2 px-2">Type</th>
                <th className="text-right py-2 px-2">Entry</th>
                <th className="text-right py-2 px-2">Exit</th>
                <th className="text-right py-2 px-2">Spot P&L</th>
                <th className="text-right py-2 px-2">SL</th>
                <th className="text-right py-2 px-2">TP</th>
                <th className="text-right py-2 px-2">All Time High</th>
                <th className="text-right py-2 px-2">PnL $</th>
                <th className="text-right py-2 px-2">PnL %</th>
                <th className="text-left py-2 px-2">Messages</th>
                <th className="text-left py-2 px-2">Open</th>
                <th className="text-left py-2 px-2">Close</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((trade) => (
                <tr
                  key={trade.id}
                  className="border-b border-trade-card hover:bg-trade-card transition-colors relative"
                  onMouseEnter={() => setShowTooltip(trade.id)}
                  onMouseLeave={() => setShowTooltip(null)}
                >
                  <td className="py-2 px-2 font-medium">{trade.symbol}</td>
                  <td className="py-2 px-2">
                    <span className="text-white text-xs">{trade.strategyName || 'Unknown'}</span>
                    {trade.mode && (
                      <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        trade.mode === 'LIVE'
                          ? 'bg-trade-green/20 text-trade-green'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {trade.mode}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-trade-green">{trade.type}</td>
                  <td className="py-2 px-2 text-right">{formatPrice(trade.entryPrice)}</td>
                  <td className="py-2 px-2 text-right">{trade.closePrice ? formatPrice(trade.closePrice) : '-'}</td>
                  <td className="py-2 px-2 text-right">
                    {trade.closePrice && trade.entryPrice > 0 ? (
                      <span className={trade.closePrice >= trade.entryPrice ? 'text-trade-green font-semibold' : 'text-trade-red font-semibold'}>
                        {(((trade.closePrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2)}%
                      </span>
                    ) : '-'}
                  </td>
                  <td className="py-2 px-2 text-right text-trade-red">{trade.sl ? formatPrice(trade.sl) : '-'}</td>
                  <td className="py-2 px-2 text-right text-trade-green">{trade.tp ? formatPrice(trade.tp) : '-'}</td>
                  <td className="py-2 px-2 text-right text-trade-yellow font-mono">
                    {trade.peakPrice ? formatPrice(trade.peakPrice) : '-'}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {trade.pnl !== undefined ? (
                      <span className={trade.pnl >= 0 ? 'text-trade-green font-semibold' : 'text-trade-red font-semibold'}>
                        ${trade.pnl.toFixed(2)}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {trade.pnlPercent !== undefined ? (
                      <span className={trade.pnlPercent >= 0 ? 'text-trade-green font-semibold' : 'text-trade-red font-semibold'}>
                        {trade.pnlPercent.toFixed(2)}%
                      </span>
                    ) : '-'}
                  </td>
                  <td className="py-2 px-2">
                    <div className="relative group">
                      <span className="text-trade-gray cursor-help text-xs">View</span>
                      {showTooltip === trade.id && <TradeTooltip trade={trade} />}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-trade-gray text-xs">
                    {new Date(trade.openTime).toLocaleString()}
                  </td>
                  <td className="py-2 px-2 text-trade-gray text-xs">
                    {trade.closeTime ? new Date(trade.closeTime).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Strategy Summary Section */}
      <div className="mt-6">
        <h4 className="text-sm font-semibold text-trade-green mb-3">Strategy Summary</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-trade-gray border-b border-trade-card">
                <th className="text-left py-2 px-2">Strategy</th>
                <th className="text-right py-2 px-2">Spot P&L % (Sum)</th>
                <th className="text-right py-2 px-2">Spot P&L % (Avg)</th>
                <th className="text-right py-2 px-2">Total Trades</th>
                <th className="text-right py-2 px-2">Win Rate</th>
                <th className="text-right py-2 px-2">W / L</th>
                <th className="text-right py-2 px-2">Best Trade</th>
                <th className="text-right py-2 px-2">Worst Trade</th>
                <th className="text-right py-2 px-2">Avg Trade ($)</th>
                <th className="text-right py-2 px-2">Avg Win ($)</th>
                <th className="text-right py-2 px-2">Avg Loss ($)</th>
                <th className="text-right py-2 px-2">Largest DD</th>
              </tr>
            </thead>
            <tbody>
              {strategySummary.map((row) => (
                <tr key={row.strategyId} className="border-b border-trade-card hover:bg-trade-card/50 transition-colors">
                  <td className="py-2 px-2 font-medium text-white">{row.strategyName}</td>
                  <td className={`py-2 px-2 text-right font-semibold ${row.spotPnlSum >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
                    {row.spotPnlSum.toFixed(2)}%
                  </td>
                  <td className={`py-2 px-2 text-right font-semibold ${row.spotPnlAvg >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
                    {row.spotPnlAvg.toFixed(2)}%
                  </td>
                  <td className="py-2 px-2 text-right text-trade-gray">{row.totalTrades}</td>
                  <td className={`py-2 px-2 text-right font-semibold ${row.winRate >= 50 ? 'text-trade-green' : row.winRate > 0 ? 'text-trade-red' : 'text-trade-gray'}`}>
                    {row.totalTrades > 0 ? `${row.winRate.toFixed(1)}%` : '-'}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span className="text-trade-green">{row.wins}</span>
                    <span className="text-trade-gray"> / </span>
                    <span className="text-trade-red">{row.losses}</span>
                  </td>
                  <td className="py-2 px-2 text-right text-trade-green font-semibold">
                    {row.bestTrade !== null ? `$${row.bestTrade.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-2 text-right text-trade-red font-semibold">
                    {row.worstTrade !== null ? `$${row.worstTrade.toFixed(2)}` : '-'}
                  </td>
                  <td className={`py-2 px-2 text-right font-semibold ${row.avgTrade >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
                    ${row.avgTrade.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-trade-green">
                    {row.avgWin !== null ? `$${row.avgWin.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-2 text-right text-trade-red">
                    {row.avgLoss !== null ? `$${row.avgLoss.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-2 text-right text-trade-red font-semibold">
                    {row.largestDD !== null ? `$${row.largestDD.toFixed(2)}` : '-'}
                  </td>
                </tr>
              ))}
              {/* Total Row */}
              {totalRow && (
                <tr className="border-t-2 border-trade-green bg-trade-card/30 font-bold">
                  <td className="py-2 px-2 text-white">{totalRow.strategyName}</td>
                  <td className={`py-2 px-2 text-right ${totalRow.spotPnlSum >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
                    {totalRow.spotPnlSum.toFixed(2)}%
                  </td>
                  <td className={`py-2 px-2 text-right ${totalRow.spotPnlAvg >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
                    {totalRow.spotPnlAvg.toFixed(2)}%
                  </td>
                  <td className="py-2 px-2 text-right text-trade-gray">{totalRow.totalTrades}</td>
                  <td className={`py-2 px-2 text-right ${totalRow.winRate >= 50 ? 'text-trade-green' : totalRow.winRate > 0 ? 'text-trade-red' : 'text-trade-gray'}`}>
                    {totalRow.totalTrades > 0 ? `${totalRow.winRate.toFixed(1)}%` : '-'}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span className="text-trade-green">{totalRow.wins}</span>
                    <span className="text-trade-gray"> / </span>
                    <span className="text-trade-red">{totalRow.losses}</span>
                  </td>
                  <td className="py-2 px-2 text-right text-trade-green">
                    {totalRow.bestTrade !== null ? `$${totalRow.bestTrade.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-2 text-right text-trade-red">
                    {totalRow.worstTrade !== null ? `$${totalRow.worstTrade.toFixed(2)}` : '-'}
                  </td>
                  <td className={`py-2 px-2 text-right ${totalRow.avgTrade >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
                    ${totalRow.avgTrade.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-trade-green">
                    {totalRow.avgWin !== null ? `$${totalRow.avgWin.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-2 text-right text-trade-red">
                    {totalRow.avgLoss !== null ? `$${totalRow.avgLoss.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-2 text-right text-trade-red">
                    {totalRow.largestDD !== null ? `$${totalRow.largestDD.toFixed(2)}` : '-'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
