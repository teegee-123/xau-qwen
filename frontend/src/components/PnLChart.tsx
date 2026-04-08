import React, { useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer
} from 'recharts';
import { TrendingUp, TrendingDown, BarChart3, RefreshCw } from 'lucide-react';
import { fetchWithTimeout } from '../utils/fetch';

interface PnLDataPoint {
  date: string;
  pnl: number;
  cumulative: number;
  symbol?: string;
  type?: string;
}

export const PnLChart: React.FC = () => {
  const [data, setData] = useState<PnLDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPnLHistory();
  }, []);

  const fetchPnLHistory = async () => {
    try {
      const res = await fetchWithTimeout('/api/trades/pnl-history', {}, 10000);
      if (!res.ok) throw new Error('Failed to fetch PnL history');
      const pnlData = await res.json();
      setData(pnlData);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatXAxis = (tickItem: string) => {
    const date = new Date(tickItem);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTooltipDate = (value: string) => {
    const date = new Date(value);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-trade-dark border border-trade-border rounded-lg p-3 shadow-lg">
          <p className="text-xs text-trade-gray mb-2">{formatTooltipDate(data.date)}</p>
          <p className="text-sm font-semibold text-white mb-1">
            Trade P&L: <span className={data.pnl >= 0 ? 'text-trade-green' : 'text-trade-red'}>
              ${data.pnl.toFixed(2)}
            </span>
          </p>
          <p className="text-sm font-semibold text-white">
            Cumulative: <span className={data.cumulative >= 0 ? 'text-trade-green' : 'text-trade-red'}>
              ${data.cumulative.toFixed(2)}
            </span>
          </p>
          {data.symbol && (
            <p className="text-xs text-trade-gray mt-1">
              {data.type} {data.symbol}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="bg-trade-card rounded-xl p-6 border border-trade-border">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={20} className="text-trade-blue" />
          <h3 className="text-lg font-semibold text-white">Profit & Loss History</h3>
        </div>
        <div className="h-64 bg-trade-dark rounded animate-pulse"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-trade-card rounded-xl p-6 border border-trade-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={20} className="text-trade-blue" />
            <h3 className="text-lg font-semibold text-white">Profit & Loss History</h3>
          </div>
          <button
            onClick={fetchPnLHistory}
            className="text-trade-blue hover:text-white transition-colors flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
        <div className="text-center py-8">
          <p className="text-sm text-trade-red mb-3">Error: {error}</p>
          <button
            onClick={fetchPnLHistory}
            className="bg-trade-blue/20 text-trade-blue border border-trade-blue px-4 py-2 rounded-lg hover:bg-trade-blue/30 transition-colors inline-flex items-center gap-2"
          >
            <RefreshCw size={14} />
            Retry Loading PnL History
          </button>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-trade-card rounded-xl p-6 border border-trade-border">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={20} className="text-trade-blue" />
          <h3 className="text-lg font-semibold text-white">Profit & Loss History</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-trade-gray">
          <BarChart3 size={48} className="mb-4 opacity-50" />
          <p className="text-sm">No closed trades yet</p>
          <p className="text-xs mt-1">P&L chart will appear after trades are closed</p>
        </div>
      </div>
    );
  }

  const totalPnL = data.length > 0 ? data[data.length - 1].cumulative : 0;
  const isProfit = totalPnL >= 0;

  return (
    <div className="bg-trade-card rounded-xl p-6 border border-trade-border animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={20} className="text-trade-blue" />
          <h3 className="text-lg font-semibold text-white">Profit & Loss History</h3>
        </div>
        <div className="flex items-center gap-2">
          {isProfit ? (
            <TrendingUp size={16} className="text-trade-green" />
          ) : (
            <TrendingDown size={16} className="text-trade-red" />
          )}
          <span className={`text-sm font-bold ${isProfit ? 'text-trade-green' : 'text-trade-red'}`}>
            {isProfit ? '+' : ''}${totalPnL.toFixed(2)}
          </span>
          <span className="text-xs text-trade-gray">({data.length} trades)</span>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorPnL" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxis}
              stroke="#718096"
              fontSize={12}
            />
            <YAxis
              stroke="#718096"
              fontSize={12}
              tickFormatter={(value) => `$${value}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#718096" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="cumulative"
              stroke="#10B981"
              strokeWidth={2}
              fill="url(#colorPnL)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
