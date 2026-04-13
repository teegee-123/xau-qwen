import { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

interface PriceData {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: string;
}

interface PriceServiceStatus {
  isStreaming: boolean;
  isRunning: boolean;
  reconnectAttempts: number;
  currentPrice: PriceData | null;
}

interface PriceDisplayProps {
  loading?: boolean;
}

export function PriceDisplay({ loading }: PriceDisplayProps) {
  const [price, setPrice] = useState<PriceData | null>(null);
  const [previousPrice, setPreviousPrice] = useState<PriceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<PriceServiceStatus | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Fetch initial price and status
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [priceRes, statusRes] = await Promise.all([
          fetch('/api/oanda/price'),
          fetch('/api/oanda/price/status')
        ]);

        if (priceRes.ok) {
          const data = await priceRes.json();
          if (data.success) {
            setPreviousPrice(price);
            setPrice(data);
            setError(null);
          } else {
            setError(data.message || 'No price data available');
          }
        }

        if (statusRes.ok) {
          setServiceStatus(await statusRes.json());
        }
      } catch (err: any) {
        console.error('Failed to fetch price:', err);
        setError('Unable to fetch price');
      }
    };

    fetchData();

    // Poll price every 5 seconds as fallback
    const priceInterval = setInterval(fetchData, 5000);

    // Poll status every 2 seconds
    const statusInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/oanda/price/status');
        if (res.ok) {
          setServiceStatus(await res.json());
        }
      } catch (err) {
        // silently fail
      }
    }, 2000);

    return () => {
      clearInterval(priceInterval);
      clearInterval(statusInterval);
    };
  }, []);

  // Setup Socket.IO connection for price updates
  useEffect(() => {
    const socket = io('/', {
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    const handlePriceUpdate = (newPrice: PriceData) => {
      setPreviousPrice(price);
      setPrice(newPrice);
      setError(null);
    };

    socket.on('price_update', handlePriceUpdate);

    return () => {
      socket.off('price_update', handlePriceUpdate);
      socket.disconnect();
    };
  }, [price]);

  if (loading) {
    return (
      <div className="bg-trade-dark border border-trade-card rounded-lg p-4">
        <div className="animate-pulse flex items-center justify-between">
          <div className="h-8 bg-trade-card rounded w-32"></div>
          <div className="h-8 bg-trade-card rounded w-24"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-trade-dark border border-trade-red/30 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-trade-red" />
            <div>
              <div className="text-trade-gray text-sm">Gold Price</div>
              <div className="text-trade-red text-xs">{error}</div>
            </div>
          </div>
          {/* Status badge for error state */}
          <StatusBadge status={serviceStatus} />
        </div>
      </div>
    );
  }

  if (!price) {
    return (
      <div className="bg-trade-dark border border-trade-card rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-trade-gray" />
            <div>
              <div className="text-trade-gray text-sm">Gold Price</div>
              <div className="text-trade-gray text-xs">Waiting for price data...</div>
            </div>
          </div>
          <StatusBadge status={serviceStatus} />
        </div>
      </div>
    );
  }

  // Determine price direction
  const priceDirection = previousPrice
    ? price.bid > previousPrice.bid
      ? 'up'
      : price.bid < previousPrice.bid
      ? 'down'
      : 'neutral'
    : 'neutral';

  const directionColor = priceDirection === 'up' ? 'text-trade-green' : priceDirection === 'down' ? 'text-trade-red' : 'text-trade-gray';
  const DirectionIcon = priceDirection === 'up' ? TrendingUp : priceDirection === 'down' ? TrendingDown : Activity;

  return (
    <div className="bg-trade-dark border border-trade-card rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${priceDirection === 'up' ? 'bg-trade-green/10' : priceDirection === 'down' ? 'bg-trade-red/10' : 'bg-trade-card'}`}>
            <DirectionIcon className={`w-6 h-6 ${directionColor}`} />
          </div>
          <div>
            <div className="text-trade-gray text-sm">{price.symbol}</div>
            <div className={`text-2xl font-bold ${directionColor}`}>
              {price.bid.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-trade-gray text-xs">Ask</div>
          <div className="text-white font-semibold">{price.ask.toFixed(2)}</div>
          <div className="text-trade-gray text-xs mt-1">
            Spread: {price.spread.toFixed(2)}
          </div>
          <div className="text-trade-gray text-xs mt-1">
            {new Date(price.timestamp).toLocaleTimeString()}
          </div>
          {/* Status badge */}
          <StatusBadge status={serviceStatus} />
        </div>
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  status: PriceServiceStatus | null;
}

function StatusBadge({ status }: StatusBadgeProps) {
  if (!status) {
    return (
      <div className="mt-2 text-[10px] text-trade-gray flex items-center gap-1">
        <div className="w-1.5 h-1.5 rounded-full bg-trade-gray" />
        Unknown
      </div>
    );
  }

  const { isStreaming, isRunning, reconnectAttempts, currentPrice } = status;

  let mode: 'streaming' | 'polling' | 'connecting' | 'disconnected';
  let color: string;
  let label: string;
  let tooltipLines: string[];

  if (!isRunning) {
    mode = 'disconnected';
    color = 'text-trade-red';
    label = 'Disconnected';
    tooltipLines = ['Price service not running'];
  } else if (reconnectAttempts > 0 && !isStreaming) {
    mode = 'connecting';
    color = 'text-yellow-400';
    label = 'Reconnecting...';
    tooltipLines = [
      'Attempting to restore streaming connection',
      `Reconnect attempts: ${reconnectAttempts}`
    ];
  } else if (isStreaming) {
    mode = 'streaming';
    color = 'text-trade-green';
    label = 'Streaming';
    tooltipLines = [
      'Real-time price updates via OANDA stream',
      currentPrice ? `Last update: ${new Date(currentPrice.timestamp).toLocaleTimeString()}` : 'Waiting for first price...'
    ];
  } else {
    mode = 'polling';
    color = 'text-yellow-400';
    label = 'Polling (1s)';
    tooltipLines = [
      'Price updates via 1-second polling',
      currentPrice ? `Last update: ${new Date(currentPrice.timestamp).toLocaleTimeString()}` : 'Waiting for first price...'
    ];
  }

  return (
    <div
      className={`mt-1 text-[10px] ${color} flex items-center gap-1 cursor-help`}
      title={tooltipLines.join('\n')}
    >
      <div className={`w-1.5 h-1.5 rounded-full ${color} ${mode === 'connecting' ? 'animate-pulse' : ''}`} />
      {label}
    </div>
  );
}
