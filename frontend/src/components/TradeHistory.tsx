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
}

interface TradeHistoryProps {
  trades: Trade[];
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

export const TradeHistory: React.FC<TradeHistoryProps> = ({ trades }) => {
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
                <th className="text-left py-2 px-2">Type</th>
                <th className="text-right py-2 px-2">Entry</th>
                <th className="text-right py-2 px-2">Exit</th>
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
                  <td className="py-2 px-2 text-trade-green">{trade.type}</td>
                  <td className="py-2 px-2 text-right">{formatPrice(trade.entryPrice)}</td>
                  <td className="py-2 px-2 text-right">{trade.closePrice ? formatPrice(trade.closePrice) : '-'}</td>
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
    </div>
  );
};
