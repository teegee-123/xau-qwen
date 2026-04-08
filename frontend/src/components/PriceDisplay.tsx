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

interface PriceDisplayProps {
  loading?: boolean;
}

export function PriceDisplay({ loading }: PriceDisplayProps) {
  const [price, setPrice] = useState<PriceData | null>(null);
  const [previousPrice, setPreviousPrice] = useState<PriceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Fetch initial price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch('/api/oanda/price');
        if (!res.ok) {
          throw new Error('Failed to fetch price');
        }
        const data = await res.json();
        
        if (data.success) {
          setPreviousPrice(price);
          setPrice(data);
          setError(null);
        } else {
          setError(data.message || 'No price data available');
        }
      } catch (err: any) {
        console.error('Failed to fetch price:', err);
        setError('Unable to fetch price');
      }
    };

    fetchPrice();
    
    // Poll every 5 seconds as fallback
    const interval = setInterval(fetchPrice, 5000);
    return () => clearInterval(interval);
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
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-trade-red" />
          <div>
            <div className="text-trade-gray text-sm">Gold Price</div>
            <div className="text-trade-red text-xs">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!price) {
    return (
      <div className="bg-trade-dark border border-trade-card rounded-lg p-4">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-trade-gray" />
          <div>
            <div className="text-trade-gray text-sm">Gold Price</div>
            <div className="text-trade-gray text-xs">Waiting for price data...</div>
          </div>
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
        </div>
      </div>
    </div>
  );
}
