import React, { useState } from 'react';
import { Wallet, TrendingUp, TrendingDown, DollarSign, Activity, RefreshCw } from 'lucide-react';
import { fetchWithTimeout } from '../utils/fetch';

interface AccountInfo {
  connected: boolean;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  currency?: string;
  login?: string;
  server?: string;
  message?: string;
}

interface Trade {
  id: string;
  symbol: string;
  entryPrice: number;
  lotSize: number;
  sl?: number;
  tp?: number;
  currentPrice?: number;
}

interface AccountBalanceProps {
  info: AccountInfo | null;
  loading: boolean;
  openTrades?: Trade[];
}

export const AccountBalance: React.FC<AccountBalanceProps> = ({ info, loading, openTrades = [] }) => {
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectMessage, setReconnectMessage] = useState<{ success: boolean; text: string } | null>(null);
  const [reconnectProgress, setReconnectProgress] = useState(0);

  const handleReconnect = async () => {
    setReconnecting(true);
    setReconnectMessage(null);
    setReconnectProgress(0);

    // Simulate progress updates during reconnection
    const progressInterval = setInterval(() => {
      setReconnectProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 1500);

    try {
      const res = await fetchWithTimeout('/api/oanda/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, 20000);

      clearInterval(progressInterval);
      setReconnectProgress(100);

      const data = await res.json();

      if (res.ok && data.success) {
        setReconnectMessage({ success: true, text: data.message });
        // Trigger page reload to refresh account info
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setReconnectMessage({ success: false, text: data.message || 'Reconnection failed' });
      }
    } catch (error: any) {
      clearInterval(progressInterval);
      setReconnectProgress(0);

      const errorMessage = error.name === 'AbortError' 
        ? `Reconnection timed out. Please try again.`
        : `Network error: ${error.message}`;
      
      setReconnectMessage({ success: false, text: errorMessage });
    } finally {
      setReconnecting(false);
    }
  };
  if (loading) {
    return (
      <div className="bg-trade-card rounded-xl p-6 border border-trade-border animate-pulse">
        <div className="flex items-center justify-between mb-4">
          <div className="h-6 bg-trade-dark rounded w-32"></div>
          <div className="h-4 bg-trade-dark rounded w-20"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-16 bg-trade-dark rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!info || !info.connected) {
    return (
      <div className="bg-trade-card rounded-xl p-6 border border-trade-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Wallet size={20} className="text-trade-gray" />
            OANDA Account
          </h3>
          <span className="text-xs text-trade-gray bg-trade-dark px-2 py-1 rounded">
            Not Connected
          </span>
        </div>
        <div className="text-center py-6 space-y-4">
          <p className="text-sm text-trade-gray">
            {info?.message || 'Connect OANDA to view account balance'}
          </p>
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            className="bg-trade-green text-trade-black font-semibold px-6 py-2 rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {reconnecting ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Reconnecting...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Reconnect OANDA
              </>
            )}
          </button>

          {/* Progress Bar */}
          {reconnecting && reconnectProgress > 0 && (
            <div className="w-full max-w-xs mx-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-trade-gray">Connecting...</span>
                <span className="text-xs text-trade-green">{reconnectProgress}%</span>
              </div>
              <div className="w-full bg-trade-dark rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-trade-green transition-all duration-300 ease-out"
                  style={{ width: `${reconnectProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {reconnectMessage && (
            <div className={`text-sm p-3 rounded ${
              reconnectMessage.success
                ? 'bg-trade-green/10 text-trade-green'
                : 'bg-trade-red/10 text-trade-red'
            }`}>
              {reconnectMessage.text}
            </div>
          )}
        </div>
      </div>
    );
  }

  const balance = info.balance || 0;
  const equity = info.equity || 0;

  // Calculate total floating PnL from open trades
  const totalFloatingPnL = openTrades.reduce((total, trade) => {
    if (!trade.currentPrice) return total;
    const priceDiff = trade.currentPrice - trade.entryPrice;
    return total + (priceDiff * trade.lotSize * 100);
  }, 0);

  const isProfit = totalFloatingPnL >= 0;

  return (
    <div className="bg-trade-card rounded-xl p-6 border border-trade-border animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Wallet size={20} className="text-trade-green" />
          OANDA Account
        </h3>
        <div className="flex items-center gap-2">
          {info.login && (
            <span className="text-xs text-trade-gray bg-trade-dark px-2 py-1 rounded">
              {info.login}
            </span>
          )}
          <span className="text-xs text-trade-green bg-trade-green/10 px-2 py-1 rounded">
            Connected
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {/* Balance */}
        <div className="bg-trade-dark rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={16} className="text-trade-blue" />
            <span className="text-xs text-trade-gray">Balance</span>
          </div>
          <p className="text-xl font-bold text-white">
            {info.currency} {balance.toFixed(2)}
          </p>
        </div>

        {/* Equity */}
        <div className="bg-trade-dark rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={16} className="text-trade-yellow" />
            <span className="text-xs text-trade-gray">Equity</span>
          </div>
          <p className="text-xl font-bold text-white">
            {info.currency} {equity.toFixed(2)}
          </p>
        </div>

        {/* Floating PnL */}
        <div className={`bg-trade-dark rounded-lg p-4 ${isProfit ? 'border-l-2 border-trade-green' : 'border-l-2 border-trade-red'}`}>
          <div className="flex items-center gap-2 mb-2">
            {isProfit ? (
              <TrendingUp size={16} className="text-trade-green" />
            ) : (
              <TrendingDown size={16} className="text-trade-red" />
            )}
            <span className="text-xs text-trade-gray">Floating PnL</span>
          </div>
          <p className={`text-xl font-bold ${isProfit ? 'text-trade-green' : 'text-trade-red'}`}>
            {isProfit ? '+' : ''}{info.currency} {totalFloatingPnL.toFixed(2)}
          </p>
          <p className={`text-xs ${isProfit ? 'text-trade-green' : 'text-trade-red'}`}>
            {openTrades.length} open trade{openTrades.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Free Margin */}
        <div className="bg-trade-dark rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={16} className="text-trade-purple" />
            <span className="text-xs text-trade-gray">Free Margin</span>
          </div>
          <p className="text-xl font-bold text-white">
            {info.currency} {(info.freeMargin || 0).toFixed(2)}
          </p>
        </div>
      </div>

      {info.server && (
        <p className="text-xs text-trade-gray text-right">
          Server: {info.server}
        </p>
      )}
    </div>
  );
};
