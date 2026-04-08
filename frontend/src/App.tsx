import { useState, useEffect } from 'react';
import { StatusChips } from './components/StatusChips';
import { LiveLogs } from './components/LiveLogs';
import { OpenTrades } from './components/OpenTrades';
import { TradeHistory } from './components/TradeHistory';
import { ConfigPanel } from './components/ConfigPanel';
import { SetupGuide } from './components/SetupGuide';
import { AccountBalance } from './components/AccountBalance';
import { PnLChart } from './components/PnLChart';
import { PriceDisplay } from './components/PriceDisplay';
import { useSocket } from './hooks/useSocket';
import { fetchWithTimeout } from './utils/fetch';

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

interface TelegramStatus {
  isConnected: boolean;
  authState: 'disconnected' | 'code_sent' | 'authenticated';
  phoneNumber?: string;
}

function App() {
  const [initialLogs, setInitialLogs] = useState<any[]>([]);
  const { logs, socket } = useSocket(initialLogs);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>({ isConnected: false, authState: 'disconnected' });
  const [oandaConnected, setOandaConnected] = useState(false);
  const [listenerStatus, setListenerStatus] = useState(false);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'config' | 'guide'>('dashboard');
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
    fetchTrades();
    fetchLogs();

    // Poll for updates every 5 seconds
    const interval = setInterval(() => {
      fetchStatus();
      fetchTrades();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Wire up Socket.IO events for real-time trade updates
  useEffect(() => {
    if (!socket) return;

    const handleTradeOpened = (logEntry: any) => {
      console.log('[Socket.IO] Trade opened:', logEntry);
      fetchTrades(); // Refresh trades to get the new one
    };

    const handleTradeUpdated = (logEntry: any) => {
      console.log('[Socket.IO] Trade updated:', logEntry);
      fetchTrades(); // Refresh trades to get the updates
    };

    const handleTradeClosed = (logEntry: any) => {
      console.log('[Socket.IO] Trade closed:', logEntry);
      fetchTrades(); // Refresh trades to move closed trade to history
    };

    socket.on('log', (logEntry) => {
      if (logEntry.type === 'trade_opened') {
        handleTradeOpened(logEntry);
      } else if (logEntry.type === 'trade_updated') {
        handleTradeUpdated(logEntry);
      } else if (logEntry.type === 'trade_closed') {
        handleTradeClosed(logEntry);
      }
    });

    return () => {
      socket.off('log');
    };
  }, [socket]);

  const handleTradeClosed = async () => {
    // Callback when a trade is manually closed from OpenTrades
    await fetchTrades();
  };

  const fetchStatus = async () => {
    try {
      const res = await fetchWithTimeout('/api/health', {}, 8000);
      if (!res.ok) throw new Error('Health check failed');
      const data = await res.json();

      // Handle new telegram status structure
      if (data.telegram && typeof data.telegram === 'object') {
        setTelegramStatus(data.telegram);
      } else {
        // Backward compatibility with boolean
        setTelegramStatus({
          isConnected: !!data.telegram,
          authState: data.telegram ? 'authenticated' : 'disconnected'
        });
      }

      setOandaConnected(!!data.oanda);
      setListenerStatus(!!data.listener);
      
      // Fetch account info
      try {
        const accountRes = await fetchWithTimeout('/api/oanda/account', {}, 8000);
        if (accountRes.ok) {
          setAccountInfo(await accountRes.json());
        }
      } catch (err) {
        // Ignore account info fetch errors
      }
      
      setApiError(null);
    } catch (error) {
      console.error('Failed to fetch status:', error);
      setApiError('Backend not connected. Make sure the server is running on port 8020.');
    } finally {
      setLoading(false);
    }
  };

  const fetchTrades = async () => {
    try {
      const [openRes, closedRes] = await Promise.all([
        fetchWithTimeout('/api/trades/open', {}, 8000),
        fetchWithTimeout('/api/trades/closed', {}, 8000)
      ]);

      if (!openRes.ok || !closedRes.ok) {
        throw new Error('Failed to fetch trades');
      }

      const [openData, closedData] = await Promise.all([
        openRes.json(),
        closedRes.json()
      ]);
      setOpenTrades(openData);
      setClosedTrades(closedData);
    } catch (error) {
      console.error('Failed to fetch trades:', error);
      // Don't show error for trades, just keep empty state
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetchWithTimeout('/api/logs?limit=100', {}, 8000);
      if (res.ok) {
        const data = await res.json();
        setInitialLogs(data.logs);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      // Silently fail — socket will provide real-time logs
    }
  };

  const handleSaveConfig = async (config: any) => {
    try {
      const res = await fetchWithTimeout('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      }, 10000);
      if (!res.ok) throw new Error('Failed to save config');
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save config. Check backend connection.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-trade-black flex items-center justify-center">
        <div className="text-trade-green text-xl animate-pulse">Loading dashboard...</div>
      </div>
    );
  }

  // Generate status tooltip
  const getTelegramTooltip = () => {
    if (telegramStatus.authState === 'authenticated') {
      return `Authenticated${telegramStatus.phoneNumber ? ` as ${telegramStatus.phoneNumber}` : ''}`;
    }
    if (telegramStatus.authState === 'code_sent') {
      return 'Verification code sent. Check your Telegram app and enter the code in Config.';
    }
    return 'Not authenticated. Go to Config tab to authenticate.';
  };

  return (
    <div className="min-h-screen bg-trade-black">
      {/* Header */}
      <header className="bg-trade-dark border-b border-trade-card p-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-trade-green">
              <span className="text-white">XAU</span> Copy Trade
            </h1>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'dashboard'
                    ? 'bg-trade-green text-trade-black'
                    : 'bg-trade-card text-trade-gray hover:text-white'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setActiveTab('config')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'config'
                    ? 'bg-trade-green text-trade-black'
                    : 'bg-trade-card text-trade-gray hover:text-white'
                }`}
              >
                Config
              </button>
              <button
                onClick={() => setActiveTab('guide')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'guide'
                    ? 'bg-trade-green text-trade-black'
                    : 'bg-trade-card text-trade-gray hover:text-white'
                }`}
              >
                Setup Guide
              </button>
            </div>
          </div>

          {/* Status Chips */}
          <StatusChips
            telegramStatus={telegramStatus.authState}
            oandaStatus={oandaConnected ? 'connected' : 'disconnected'}
            listenerStatus={listenerStatus}
            telegramTooltip={getTelegramTooltip()}
          />

          {/* API Error Banner */}
          {apiError && (
            <div className="mt-3 bg-trade-red/10 border border-trade-red rounded-lg p-3 text-sm text-trade-red animate-fade-in">
              ⚠️ {apiError}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 space-y-4">
        {activeTab === 'dashboard' ? (
          <>
            {/* Price Display */}
            <PriceDisplay loading={loading} />

            {/* Account Balance */}
            <AccountBalance info={accountInfo} loading={loading} openTrades={openTrades} />

            {/* PnL Chart */}
            <PnLChart />

            {/* Open Trades */}
            <OpenTrades trades={openTrades} onTradeClosed={handleTradeClosed} />

            {/* Live Logs */}
            <LiveLogs logs={logs} />

            {/* Trade History */}
            <TradeHistory trades={closedTrades} />
          </>
        ) : activeTab === 'config' ? (
          <ConfigPanel onSave={handleSaveConfig} />
        ) : (
          <SetupGuide />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-trade-dark border-t border-trade-card p-4 mt-8">
        <div className="max-w-7xl mx-auto text-center text-trade-gray text-sm">
          XAU Copy Trade Dashboard &copy; 2026
        </div>
      </footer>
    </div>
  );
}

export default App;
