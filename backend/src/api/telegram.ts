import { Router } from 'express';
import { telegramService } from '../services/telegram.service';
import { telegramListenerWorker } from '../workers/telegram-listener';
import { logger } from '../services/logger.service';
import { getConfig, updateConfig } from '../storage/json-store';
import { getSession, hasValidSession } from '../storage/session-store';

const router = Router();

// Request authentication code
router.post('/request', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    // Validate phone number format
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phoneNumber)) {
      res.status(400).json({ error: 'Phone number must be in international format (e.g., +1234567890)' });
      return;
    }

    const result = await telegramService.requestCode(phoneNumber);
    res.json({ 
      success: true, 
      phoneCodeHash: result.phoneCodeHash,
      message: 'Verification code sent to your Telegram app'
    });
  } catch (error: any) {
    await logger.log('message_ignored', `Telegram request failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Complete authentication with code
router.post('/auth', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Verification code is required' });
      return;
    }

    // Validate code is numeric
    if (!/^\d+$/.test(code)) {
      res.status(400).json({ error: 'Verification code must be numeric' });
      return;
    }

    await telegramService.completeAuth(code);
    
    const status = telegramService.getStatus();
    res.json({ 
      success: true,
      message: 'Telegram authentication successful',
      status
    });
  } catch (error: any) {
    await logger.log('message_ignored', `Telegram auth failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Reset authentication (disconnect and clear state)
router.post('/reset', async (req, res) => {
  try {
    await telegramService.disconnect();
    
    const status = telegramService.getStatus();
    res.json({ 
      success: true,
      message: 'Telegram disconnected',
      status
    });
  } catch (error: any) {
    await logger.log('message_ignored', `Telegram reset failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get Telegram status
router.get('/status', async (req, res) => {
  const status = telegramService.getStatus();
  const sessionStatus = await telegramService.getSessionStatus();

  // If service shows disconnected but config has authenticated state,
  // check if session is expired and clear it
  if (status.authState === 'disconnected') {
    try {
      const hasSession = await hasValidSession();
      if (!hasSession) {
        // Session is expired - clear auth state from config
        console.warn('[Status] Session file missing/invalid, clearing auth state');
        const config = await getConfig();
        config.telegram.authState = 'disconnected';
        config.telegram.isAuthenticated = false;
        await require('../storage/json-store').updateConfig({ telegram: config.telegram });

        res.json({
          ...status,
          session: sessionStatus,
          message: 'No valid session found. Please authenticate.'
        });
        return;
      }
    } catch (error: any) {
      console.warn('Failed to check config for Telegram status:', error.message);
    }
  }

  res.json({
    ...status,
    session: sessionStatus
  });
});

// Start listener
router.post('/listener/start', async (req, res) => {
  try {
    await telegramListenerWorker.start();
    res.json({
      success: true,
      message: 'Telegram listener started successfully',
      listenerStatus: telegramListenerWorker.getStatus()
    });
  } catch (error: any) {
    await logger.log('message_ignored', `Failed to start listener: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      hint: 'Make sure you are authenticated and channels are configured'
    });
  }
});

// Stop listener
router.post('/listener/stop', async (req, res) => {
  try {
    await telegramListenerWorker.stop();
    res.json({
      success: true,
      message: 'Telegram listener stopped',
      listenerStatus: telegramListenerWorker.getStatus()
    });
  } catch (error: any) {
    await logger.log('message_ignored', `Failed to stop listener: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get listener status
router.get('/listener/status', (req, res) => {
  res.json({
    isRunning: telegramListenerWorker.getStatus()
  });
});

// Get session status
router.get('/session', async (req, res) => {
  try {
    const sessionStatus = await telegramService.getSessionStatus();
    res.json(sessionStatus);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch recent messages from a channel (for debugging)
router.post('/fetch-messages', async (req, res) => {
  try {
    const { channelId, count = 20 } = req.body;

    if (!channelId) {
      res.status(400).json({ error: 'Channel ID is required' });
      return;
    }

    const msgCount = Math.min(Math.max(parseInt(count, 10) || 20, 1), 100);

    const messages = await telegramService.fetchChannelMessages(channelId, msgCount);

    await logger.log('message_received', `Fetched ${messages.length} messages from channel ${channelId}`);

    res.json({
      success: true,
      channelId,
      count: messages.length,
      messages
    });
  } catch (error: any) {
    await logger.log('message_ignored', `Failed to fetch messages: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
