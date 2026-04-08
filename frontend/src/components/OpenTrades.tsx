import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { fetchWithTimeout } from '../utils/fetch';
import { io, Socket } from 'socket.io-client';

interface Trade {
  id: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  entryPrice: number;
  sl?: number;
  tp?: number;
  lotSize: number;
  openTime: string;
  status: 'OPEN' | 'CLOSED';
  pnl?: number;
  pnlPercent?: number;
  oandaTradeId?: string;
  channelId?: string;
  telegramMessageId?: string;
}

interface PriceUpdate {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: string;
}

interface OpenTradesProps {
  trades: Trade[];
  onTradeClosed?: () => void;
}

export const OpenTrades: React.FC<OpenTradesProps> = ({ trades, onTradeClosed }) => {
  const [closingTrade, setClosingTrade] = useState<string | null>(null);
  const [confirmCloseTrade, setConfirmCloseTrade] = useState<string | null>(null);
  const [prices, setPrices] = useState<Map<string, PriceUpdate>>(new Map());
  const [priceDirections, setPriceDirections] = useState<Map<string, 'up' | 'down'>>(new Map());
  const [socket, setSocket] = useState<Socket | null>(null);

  // Connect to Socket.IO for real-time price updates
  useEffect(() => {
    const socketInstance = io('/', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 5000,
    });

    socketInstance.on('price_update', (priceData: PriceUpdate) => {
      setPrices(prev => {
        const prevPrice = prev.get(priceData.symbol);
        const newPrices = new Map(prev);
        newPrices.set(priceData.symbol, priceData);

        // Track price direction
        if (prevPrice) {
          setPriceDirections(prevDirs => {
            const newDirs = new Map(prevDirs);
            newDirs.set(priceData.symbol, priceData.bid >= prevPrice.bid ? 'up' : 'down');
            return newDirs;
          });
        }

        return newPrices;
      });
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  // Fallback: Fetch prices via polling if Socket.IO not connected
  useEffect(() => {
    const fetchPrices = async () => {
      if (socket?.connected) return; // Skip if Socket.IO is connected

      for (const trade of trades) {
        if (!prices.has(trade.symbol)) {
          try {
            const res = await fetchWithTimeout(`/api/oanda/price/${trade.symbol}`, {}, 5000);
            if (res.ok) {
              const data = await res.json();
              setPrices(prev => {
                const newPrices = new Map(prev);
                newPrices.set(trade.symbol, {
                  symbol: trade.symbol,
                  bid: parseFloat(data.bid),
                  ask: parseFloat(data.ask),
                  spread: parseFloat(data.ask) - parseFloat(data.bid),
                  timestamp: new Date().toISOString()
                });
                return newPrices;
              });
            }
          } catch (error) {
            console.error(`Failed to fetch price for ${trade.symbol}:`, error);
          }
        }
      }
    };

    if (trades.length > 0 && !socket?.connected) {
      fetchPrices();
      const interval = setInterval(fetchPrices, 10000);
      return () => clearInterval(interval);
    }
  }, [trades, socket, prices]);

  const formatPrice = (price: number) => price.toFixed(2);

  const formatPnL = (value: number) => {
    const color = value >= 0 ? 'text-trade-green' : 'text-trade-red';
    return <span className={color}>${value.toFixed(2)}</span>;
  };

  const calculateRealTimePnL = (trade: Trade): number | null => {
    const priceUpdate = prices.get(trade.symbol);
    if (!priceUpdate) return null;

    // For BUY orders: PnL = (currentBid - entryPrice) * lotSize * pipValue
    // XAU pip value: 1 pip = $0.01, standard lot = 100 oz
    const priceDiff = priceUpdate.bid - trade.entryPrice;
    const pnl = priceDiff * trade.lotSize * 100; // Simplified: 1 lot = 100 units

    return pnl;
  };

  const handleCloseClick = (tradeId: string) => {
    setConfirmCloseTrade(tradeId);
  };

  const handleConfirmClose = async () => {
    if (!confirmCloseTrade) return;

    setClosingTrade(confirmCloseTrade);
    try {
      const res = await fetchWithTimeout(`/api/trades/${confirmCloseTrade}/close`, {
        method: 'POST'
      }, 15000);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to close trade');
      }

      // Notify parent component
      if (onTradeClosed) {
        onTradeClosed();
      }
    } catch (error: any) {
      console.error('Failed to close trade:', error);
      alert(`Failed to close trade: ${error.message}`);
    } finally {
      setClosingTrade(null);
      setConfirmCloseTrade(null);
    }
  };

  const handleCancelClose = () => {
    setConfirmCloseTrade(null);
  };

  return (
    <div className="bg-trade-dark rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-3 text-trade-green">Open Trades</h3>
      {trades.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-trade-gray text-sm mb-2">No open trades</p>
          <p className="text-trade-gray text-xs">
            Start the Telegram listener to begin receiving trading signals
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
                <th className="text-right py-2 px-2">SL</th>
                <th className="text-right py-2 px-2">TP</th>
                <th className="text-right py-2 px-2">Lots</th>
                <th className="text-right py-2 px-2">Current</th>
                <th className="text-right py-2 px-2">PnL $</th>
                <th className="text-right py-2 px-2">PnL %</th>
                <th className="text-left py-2 px-2">OANDA ID</th>
                <th className="text-left py-2 px-2">Open Time</th>
                <th className="text-center py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const realtimePnL = calculateRealTimePnL(trade);
                const currentPrice = prices.get(trade.symbol);
                const isClosing = closingTrade === trade.id;

                return (
                  <tr key={trade.id} className="border-b border-trade-card hover:bg-trade-card transition-colors relative">
                    <td className="py-2 px-2 font-medium">{trade.symbol}</td>
                    <td className="py-2 px-2 text-trade-green">{trade.type}</td>
                    <td className="py-2 px-2 text-right">{formatPrice(trade.entryPrice)}</td>
                    <td className="py-2 px-2 text-right text-trade-red">{trade.sl ? formatPrice(trade.sl) : '-'}</td>
                    <td className="py-2 px-2 text-right text-trade-green">{trade.tp ? formatPrice(trade.tp) : '-'}</td>
                    <td className="py-2 px-2 text-right">{trade.lotSize}</td>
                    <td className="py-2 px-2 text-right">
                      {currentPrice ? (
                        <span className="flex items-center justify-end gap-1">
                          {priceDirections.get(trade.symbol) === 'up' ? (
                            <ArrowUp size={12} className="text-trade-green" />
                          ) : priceDirections.get(trade.symbol) === 'down' ? (
                            <ArrowDown size={12} className="text-trade-red" />
                          ) : null}
                          <span className={
                            priceDirections.get(trade.symbol) === 'up' ? 'text-trade-green' :
                            priceDirections.get(trade.symbol) === 'down' ? 'text-trade-red' :
                            'text-trade-gray'
                          }>
                            {formatPrice(currentPrice.bid)}
                          </span>
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {realtimePnL !== null ? formatPnL(realtimePnL) : (trade.pnl !== undefined ? formatPnL(trade.pnl) : '-')}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {trade.pnlPercent !== undefined ? (
                        <span className={trade.pnlPercent >= 0 ? 'text-trade-green' : 'text-trade-red'}>
                          {trade.pnlPercent.toFixed(2)}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-2 px-2 text-trade-gray text-xs font-mono">
                      {trade.oandaTradeId ? trade.oandaTradeId.substring(0, 12) + '...' : '-'}
                    </td>
                    <td className="py-2 px-2 text-trade-gray text-xs">
                      {new Date(trade.openTime).toLocaleString()}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={() => handleCloseClick(trade.id)}
                        disabled={isClosing}
                        className="bg-trade-red/20 text-trade-red border border-trade-red text-xs px-3 py-1 rounded hover:bg-trade-red/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isClosing ? 'Closing...' : 'Close'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmCloseTrade && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-trade-dark border border-trade-red rounded-lg p-6 max-w-md mx-4">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle size={24} className="text-trade-red mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-lg font-semibold text-white mb-2">Confirm Close Trade</h4>
                <p className="text-sm text-trade-gray">
                  Are you sure you want to close this trade? This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleConfirmClose}
                disabled={closingTrade !== null}
                className="flex-1 bg-trade-red text-white font-semibold px-4 py-2 rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {closingTrade ? (
                  <>
                    <CheckCircle size={16} className="animate-spin" />
                    Closing Trade...
                  </>
                ) : (
                  'Yes, Close Trade'
                )}
              </button>
              <button
                onClick={handleCancelClose}
                disabled={closingTrade !== null}
                className="flex-1 bg-trade-card text-trade-gray border border-trade-gray font-semibold px-4 py-2 rounded-lg hover:bg-trade-gray/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
