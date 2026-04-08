import { telegramService } from '../services/telegram.service';
import { messageParser } from '../services/message-parser';
import { tradeManager } from '../services/trade-manager';
import { logger } from '../services/logger.service';
import { getConfig } from '../storage/json-store';

// Track message edits - messageId -> initial signal
const messageMap = new Map<string, {
  initialSignal: any;
  timestamp: Date;
}>();

class TelegramListenerWorker {
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) {
      await logger.log('message_ignored', 'Listener already running');
      return;
    }

    try {
      const config = await getConfig();

      // Validate authentication
      if (!config.telegram.isAuthenticated || config.telegram.authState !== 'authenticated') {
        throw new Error('Telegram not authenticated. Please authenticate via the dashboard Config tab first.');
      }

      // Validate channels are configured
      if (!config.telegram.channels || config.telegram.channels.length === 0) {
        throw new Error('No Telegram channels configured. Add channel IDs in the dashboard Config tab.');
      }

      // Verify Telegram client is initialized
      const client = telegramService.getClient();
      if (!client) {
        throw new Error('Telegram client not initialized. Please re-authenticate in the dashboard.');
      }

      // Verify client is connected
      if (!client.connected) {
        await logger.log('message_received', 'Telegram client not connected, attempting to connect...');
        await client.connect();
      }

      // Register message handler
      console.log('[Listener] Registering onMessage callback with telegramService...');
      telegramService.onMessage(async (event: any) => {
        console.log('[Listener] onMessage callback TRIGGERED!');
        console.log('[Listener] Event keys:', Object.keys(event || {}));
        await this.handleMessage(event);
      });
      console.log('[Listener] onMessage callback registered successfully');

      // Start listening
      await telegramService.startListening(config.telegram.channels);

      this.isRunning = true;
      await logger.log('message_received', 'Telegram listener worker started successfully');
    } catch (error: any) {
      const errorMessage = `Failed to start listener: ${error.message}`;
      await logger.log('message_ignored', errorMessage);
      console.error(`[Telegram Listener] ${errorMessage}`);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await logger.log('message_received', 'Stopping Telegram listener...');
      
      await telegramService.stopListening();
      
      // Note: We don't disconnect the client here to preserve the session
      // User can manually disconnect via dashboard if needed
      
      this.isRunning = false;
      await logger.log('message_received', 'Telegram listener worker stopped');
    } catch (error: any) {
      const errorMessage = `Failed to stop listener: ${error.message}`;
      await logger.log('message_ignored', errorMessage);
      console.error(`[Telegram Listener] ${errorMessage}`);
      // Don't throw - we want to mark as stopped even if there's an error
    }
  }

  private async handleMessage(event: any): Promise<void> {
    try {
      console.log('[Listener] ====== handleMessage ENTRY ======');
      console.log('[Listener] Event object keys:', Object.keys(event || {}));
      console.log('[Listener] Event.message:', event?.message);
      console.log('[Listener] Event.chatId:', event?.chatId);
      console.log('[Listener] Event.isEdited:', event?.isEdited);
      
      const text = event.message?.text || '';
      const messageId = event.message?.id?.toString() || '';
      const channelId = event.chatId?.toString() || '';
      const isEdited = event.isEdited || false;

      console.log('[Listener] Parsed - Text length:', text.length, 'MessageId:', messageId, 'ChannelId:', channelId, 'IsEdited:', isEdited);

      if (!text) {
        console.log('[Listener] handleMessage - SKIP: No text');
        return;
      }

      if (isEdited) {
        console.log('[Listener] Routing to handleEditedMessage');
        await this.handleEditedMessage(messageId, text, channelId);
      } else {
        console.log('[Listener] Routing to handleNewMessage');
        await this.handleNewMessage(messageId, text, channelId);
      }
      
      console.log('[Listener] ====== handleMessage EXIT ======');
    } catch (error: any) {
      await logger.log('message_ignored', `Error handling message: ${error.message}`);
      console.error(`[Telegram Listener] Error handling message: ${error.message}`);
      console.error('[Telegram Listener] Error stack:', error.stack);
    }
  }

  private async handleNewMessage(messageId: string, text: string, channelId: string): Promise<void> {
    try {
      console.log('[Listener] handleNewMessage - ID:', messageId, 'Channel:', channelId, 'Text:', text.substring(0, 100));
      
      // Check if message should be ignored
      if (messageParser.shouldIgnore(text)) {
        console.log('[Listener] handleNewMessage - Message ignored by shouldIgnore');
        await logger.messageIgnored(text, channelId, 'Message did not match buy signal');
        return;
      }

      // Try to parse initial buy signal
      const initialSignal = await messageParser.parseInitialMessage(text);
      console.log('[Listener] handleNewMessage - Initial signal:', initialSignal ? 'FOUND' : 'NULL');

      if (initialSignal) {
        await logger.messageReceived(text, channelId);

        // Store message for potential edit
        messageMap.set(messageId, {
          initialSignal,
          timestamp: new Date()
        });

        // Place trade
        console.log('[Listener] handleNewMessage - Calling tradeManager.handleInitialSignal');
        await tradeManager.handleInitialSignal(messageId, text, initialSignal.price, channelId);
      } else {
        console.log('[Listener] handleNewMessage - No initial buy signal detected, ignoring');
        await logger.messageIgnored(text, channelId, 'No initial buy signal detected');
      }
    } catch (error: any) {
      await logger.log('message_ignored', `Error handling new message: ${error.message}`);
      console.error(`[Telegram Listener] Error in handleNewMessage: ${error.message}`);
    }
  }

  private async handleEditedMessage(messageId: string, text: string, channelId: string): Promise<void> {
    try {
      console.log('[Listener] handleEditedMessage - ID:', messageId, 'Channel:', channelId, 'Text:', text.substring(0, 100));
      
      const stored = messageMap.get(messageId);
      console.log('[Listener] handleEditedMessage - Stored message found:', stored ? 'YES' : 'NO');

      if (!stored) {
        console.log('[Listener] handleEditedMessage - No initial signal found, ignoring');
        await logger.messageIgnored(text, channelId, 'Edited message without initial signal');
        return;
      }

      // Try to parse edited message
      const editedSignal = await messageParser.parseEditedMessage(text);
      console.log('[Listener] handleEditedMessage - Edited signal:', editedSignal ? 'FOUND' : 'NULL');
      
      if (editedSignal) {
        console.log('[Listener] handleEditedMessage - SL:', editedSignal.sl, 'TP:', editedSignal.tp);
        await logger.messageReceived(text, channelId);

        // Update trade with SL/TP
        console.log('[Listener] handleEditedMessage - Calling tradeManager.handleEditedSignal');
        await tradeManager.handleEditedSignal(messageId, text, editedSignal.sl, editedSignal.tp);

        // Remove from map
        messageMap.delete(messageId);
        console.log('[Listener] handleEditedMessage - Removed from messageMap');
      } else {
        console.log('[Listener] handleEditedMessage - Edited message did not match expected format');
        await logger.messageIgnored(text, channelId, 'Edited message did not match expected format');
      }
    } catch (error: any) {
      await logger.log('message_ignored', `Error handling edited message: ${error.message}`);
      console.error(`[Telegram Listener] Error in handleEditedMessage: ${error.message}`);
    }
  }

  getStatus(): boolean {
    return this.isRunning;
  }
}

export const telegramListenerWorker = new TelegramListenerWorker();
