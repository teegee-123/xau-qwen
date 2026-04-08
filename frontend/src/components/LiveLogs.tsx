import React, { useRef } from 'react';

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'message_received' | 'message_ignored' | 'trade_opened' | 'trade_updated' | 'trade_closed' | 'retry_attempt';
  message: string;
  details?: any;
}

interface LiveLogsProps {
  logs: LogEntry[];
}

const logTypeColors: Record<string, string> = {
  message_received: 'text-trade-green',
  message_ignored: 'text-trade-gray',
  trade_opened: 'text-trade-green',
  trade_updated: 'text-trade-yellow',
  trade_closed: 'text-trade-red',
  retry_attempt: 'text-trade-yellow'
};

/**
 * Extract display text from log details
 */
function getDetailText(details?: any): string {
  if (!details) return '';

  // Original Telegram message text
  if (details.text && typeof details.text === 'string') {
    return details.text.trim();
  }

  // Trade details formatting
  if (details.trade) {
    const trade = details.trade;
    const parts: string[] = [];
    if (trade.entryPrice) parts.push(`Entry: ${trade.entryPrice}`);
    if (trade.sl) parts.push(`SL: ${trade.sl}`);
    if (trade.tp) parts.push(`TP: ${trade.tp}`);
    if (trade.pnl !== undefined) parts.push(`PnL: $${trade.pnl}`);
    if (trade.pnlPercent !== undefined) parts.push(`(${trade.pnlPercent}%)`);
    if (trade.lotSize) parts.push(`Lot: ${trade.lotSize}`);
    return parts.join(', ');
  }

  // Retry attempt details
  if (details.operation) {
    return `${details.operation} (${details.attempt}/${details.maxRetries})${details.error ? ': ' + details.error : ''}`;
  }

  // Reason for ignored message
  if (details.reason) {
    return details.reason;
  }

  return '';
}

export const LiveLogs: React.FC<LiveLogsProps> = ({ logs }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Sort logs newest-first by timestamp
  const sortedLogs = [...logs].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="bg-trade-dark rounded-lg p-4 h-64 overflow-y-auto">
      <h3 className="text-sm font-semibold mb-3 text-trade-green">
        Live Logs
        {sortedLogs.length > 0 && (
          <span className="ml-2 text-trade-gray font-normal text-xs">({sortedLogs.length} entries)</span>
        )}
      </h3>
      <div className="space-y-1">
        {sortedLogs.slice(0, 50).map((log) => {
          const detailText = getDetailText(log.details);
          return (
            <div key={log.id} className="text-xs animate-slide-up">
              <span className="text-trade-gray mr-2">{formatTime(log.timestamp)}</span>
              <span className={`${logTypeColors[log.type] || 'text-white'} font-mono`}>
                [{log.type.toUpperCase()}]
              </span>
              <span className="text-white ml-2">{log.message}</span>
              {detailText && (
                <span className="text-trade-yellow ml-2">| {detailText}</span>
              )}
            </div>
          );
        })}
      </div>
      <div ref={logsEndRef} />
    </div>
  );
};
