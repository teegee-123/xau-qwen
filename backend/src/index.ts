import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { logger } from './services/logger.service';
import telegramRoutes from './api/telegram';
import tradesRoutes from './api/trades';
import configRoutes from './api/config';
import logsRoutes from './api/logs';
import oandaRoutes from './api/oanda';
import dataRoutes from './api/data';
import { telegramListenerWorker } from './workers/telegram-listener';
import { oandaService } from './services/oanda.service';
import { telegramService } from './services/telegram.service';
import { tradeManager } from './services/trade-manager';
import { priceService } from './services/price.service';
import { getConfig } from './storage/json-store';
import { hasValidSession } from './storage/session-store';

// Suppress known GramJS entity resolution errors (harmless but noisy)
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && reason.message?.includes('Cannot find any entity corresponding to')) {
    // This is a known GramJS issue with event filters - safe to ignore
    return;
  }
  // Log other unhandled rejections
  console.error('Unhandled Rejection:', reason);
});

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8020;

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Set logger socket instance
logger.setSocketIO(io);

// Set price service socket instance
priceService.setSocketIO(io);

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/telegram', telegramRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/config', configRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/oanda', oandaRoutes);
app.use('/api/data', dataRoutes);

// Express error-handling middleware (catches all API route errors)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Express error:', err);
  
  // Log the error
  logger.log('message_ignored', `Server error: ${err.message}`).catch(() => {});
  
  // Return JSON error response (never crash)
  res.status(500).json({
    error: err.message || 'Internal server error',
    status: 500
  });
});

// Health endpoint for cron keep-alive
app.get('/api/health', async (req, res) => {
  const telegramStatus = telegramService.getStatus();
  const oandaStatus = oandaService.getStatus();

  // Check for valid session file
  const hasSession = await hasValidSession();

  // Effective status: session file takes precedence over service status
  let effectiveTelegramStatus = telegramStatus;
  if (!hasSession && telegramStatus.authState === 'authenticated') {
    // Service thinks it's authenticated but session file is empty/missing
    console.warn('[Health] Session file missing but service shows authenticated - marking as disconnected');
    effectiveTelegramStatus = {
      isConnected: false,
      authState: 'disconnected',
      phoneNumber: undefined
    };
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    telegram: effectiveTelegramStatus,
    oanda: oandaStatus,
    listener: telegramListenerWorker.getStatus(),
    session: hasSession
  });
});

// Serve frontend static files
// Resolve public directory: works in both dev (src/) and production (dist/)
// In both cases, ../public from __dirname resolves to backend/public/
const PUBLIC_DIR = path.resolve(__dirname, '../public');
console.log(`[Static Files] Serving from: ${PUBLIC_DIR}`);

if (require('fs').existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  console.log('[Static Files] Public directory found, static middleware enabled');
} else {
  console.warn('[Static Files] Public directory not found, skipping static file serving');
}

// Catch-all for frontend routing
app.get('*', (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({
      error: 'Frontend not built',
      message: 'Run "cd frontend && npm run build" to build the frontend',
      expectedPath: indexPath
    });
  }
});

// WebSocket connection
io.on('connection', (socket) => {
  // Client connected silently

  socket.on('disconnect', () => {
    // Client disconnected silently
  });
});

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  const msg = String(reason);
  // Suppress expected network noise from Telegram MTProto connections
  if (msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED') || msg.includes('ERR_SOCKET_CONNECTION_TIMEOUT')) {
    // These are normal for Telegram's long-lived connections — reconnection is handled internally
    return;
  }
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - log and continue
});

process.on('uncaughtException', (error) => {
  const msg = String(error.message || error);
  // Suppress expected network noise from Telegram MTProto connections
  if (msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED') || msg.includes('ERR_SOCKET_CONNECTION_TIMEOUT')) {
    // These are normal for Telegram's long-lived connections — reconnection is handled internally
    return;
  }
  console.error('Uncaught Exception:', error);
  // Don't exit - log and continue
});

// Initialize services on startup
async function bootstrap() {
  let telegramOk = false;
  let oandaOk = false;
  let listenerOk = false;

  // Initialize Telegram service (graceful)
  try {
    await telegramService.initialize();
    telegramOk = true;
    console.log('[Bootstrap] Telegram service initialized');
  } catch (error: any) {
    console.warn('[Bootstrap] Telegram service init failed:', error.message);
  }

  // Initialize OANDA service (graceful)
  try {
    console.log('[Bootstrap] Initializing OANDA service...');
    await oandaService.initialize();
    oandaOk = true;
    console.log('[Bootstrap] OANDA service initialized successfully');
  } catch (error: any) {
    console.warn('[Bootstrap] OANDA service init failed:', error.message);
    await logger.log('message_ignored', `OANDA service initialization failed: ${error.message}`);
  }

  // Restore trade state from storage (after OANDA is initialized)
  try {
    await tradeManager.restoreState();
    console.log('[Bootstrap] Trade state restored');
  } catch (error: any) {
    console.warn('[Bootstrap] Trade state restore failed:', error.message);
  }

  // Auto-start listener if configured
  try {
    const config = await getConfig();
    const hasSession = await hasValidSession();
    const channelsConfigured = config.telegram.channels && config.telegram.channels.length > 0;

    console.log(`[Bootstrap] Checking auto-start conditions:`);
    console.log(`  - Valid session: ${hasSession}`);
    console.log(`  - Channels configured: ${channelsConfigured} (${config.telegram.channels?.length || 0})`);
    console.log(`  - Telegram service OK: ${telegramOk}`);
    console.log(`  - Auth state: ${config.telegram.authState}`);

    // Check for session validity and channels, Telegram service should be initialized
    if (hasSession && channelsConfigured) {
      console.log('[Bootstrap] Attempting to auto-start Telegram listener...');
      await telegramListenerWorker.start();
      listenerOk = true;
      console.log('[Bootstrap] Telegram listener auto-started successfully');
    } else {
      console.log('[Bootstrap] Listener not auto-starting - conditions not met');
      if (!hasSession) {
        console.log('[Bootstrap]   Reason: No valid session found. Please authenticate via dashboard.');
      }
      if (!channelsConfigured) {
        console.log('[Bootstrap]   Reason: No channels configured. Add channel IDs in dashboard Config tab.');
      }
    }
  } catch (error: any) {
    console.error('[Bootstrap] Telegram listener auto-start failed:', error.message);
    console.error('[Bootstrap] Error details:', error.stack);
  }

  // Start price service (if OANDA is connected)
  try {
    if (oandaOk) {
      console.log('[Bootstrap] Starting price service...');
      await priceService.start();
      console.log('[Bootstrap] Price service started');
    } else {
      console.log('[Bootstrap] Price service not started - OANDA not connected');
    }
  } catch (error: any) {
    console.error('[Bootstrap] Price service start failed:', error.message);
  }

  // Start server regardless of service failures
  server.listen(PORT, () => {
    console.log(`[Bootstrap] Server running on port ${PORT}`);
    console.log(`[Bootstrap] Services: Telegram=${telegramOk}, OANDA=${oandaOk}, Listener=${listenerOk}`);
  });
}

bootstrap();

export { app, server, io };
