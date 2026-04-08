import { addLog, LogEntry } from '../storage/json-store';

type LogType = LogEntry['type'];

interface LogQueueItem {
  type: LogType;
  message: string;
  details?: any;
}

class LoggerService {
  private queue: LogQueueItem[] = [];
  private isProcessing = false;
  private io: any; // Socket.io server instance

  constructor() {
    // Process queue every 100ms
    setInterval(() => this.processQueue(), 100);
  }

  setSocketIO(io: any) {
    this.io = io;
  }

  async log(type: LogType, message: string, details?: any) {
    this.queue.push({ type, message, details });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;

      try {
        // Write to JSON file
        const logEntry = await addLog({
          type: item.type,
          message: item.message,
          details: item.details
        });

        // Broadcast via WebSocket if available
        if (this.io) {
          this.io.emit('log', logEntry);
        }
      } catch (error) {
        console.error('Failed to process log:', error);
        // Put it back in queue to retry
        this.queue.unshift(item);
        break;
      }
    }

    this.isProcessing = false;
  }

  // Convenience methods
  async messageReceived(message: string, channelId?: string) {
    await this.log('message_received', `Message received from ${channelId || 'unknown'}`, { 
      text: message, 
      channelId,
      matched: true 
    });
  }

  async messageIgnored(message: string, channelId?: string, reason?: string) {
    await this.log('message_ignored', `Message ignored from ${channelId || 'unknown'}`, { 
      text: message, 
      channelId,
      reason: reason || 'No match' 
    });
  }

  async tradeOpened(trade: any) {
    await this.log('trade_opened', `Trade opened: ${trade.symbol} ${trade.type} @ ${trade.entryPrice}`, { 
      trade 
    });
  }

  async tradeUpdated(trade: any) {
    await this.log('trade_updated', `Trade updated: SL=${trade.sl}, TP=${trade.tp}`, { 
      trade 
    });
  }

  async tradeClosed(trade: any) {
    const exitPrice = trade.closePrice !== undefined && trade.closePrice !== null 
      ? parseFloat(trade.closePrice).toFixed(2) 
      : 'N/A';
    const entryPrice = trade.entryPrice !== undefined && trade.entryPrice !== null 
      ? parseFloat(trade.entryPrice).toFixed(2) 
      : 'N/A';
    const sl = trade.sl !== undefined && trade.sl !== null ? trade.sl : 'N/A';
    const tp = trade.tp !== undefined && trade.tp !== null ? trade.tp : 'N/A';
    const lot = trade.lotSize !== undefined && trade.lotSize !== null ? trade.lotSize : 'N/A';
    const pnl = trade.pnl !== undefined && trade.pnl !== null ? parseFloat(trade.pnl).toFixed(2) : '0.00';
    const pnlPercent = trade.pnlPercent !== undefined && trade.pnlPercent !== null ? parseFloat(trade.pnlPercent).toFixed(2) : '0.00';

    const message = `Trade closed: Entry: ${entryPrice}, Exit: ${exitPrice}, SL: ${sl}, TP: ${tp}, PnL: $${pnl} (${pnlPercent}%), Lot: ${lot}`;

    await this.log('trade_closed', message, { trade });
  }

  async retryAttempt(operation: string, attempt: number, maxRetries: number, error?: string) {
    await this.log('retry_attempt', `Retry ${attempt}/${maxRetries} for ${operation}`, { 
      operation, 
      attempt, 
      maxRetries,
      error 
    });
  }
}

export const logger = new LoggerService();
