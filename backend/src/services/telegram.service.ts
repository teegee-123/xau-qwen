import { getConfig, updateConfig } from '../storage/json-store';
import { getSession, saveSession, clearSession, hasValidSession, migrateSessionFromConfig } from '../storage/session-store';
import { logger } from './logger.service';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { EditedMessage } from 'telegram/events/EditedMessage';

interface TelegramStatus {
  isConnected: boolean;
  authState: 'disconnected' | 'code_sent' | 'authenticated';
  phoneNumber?: string;
}

class TelegramService {
  private client: TelegramClient | null = null;
  private sessionInstance: StringSession | null = null;
  private messageHandlers: Array<(event: any) => void> = [];
  private authState: 'disconnected' | 'code_sent' | 'authenticated' = 'disconnected';
  private phoneNumber: string | null = null;
  private codeHash: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private channelEntities: Map<string, any> = new Map();
  private pollingChannels: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private isRunning = false;

  // Store bound handlers to ensure proper removal (fixes duplicate message handling)
  private boundNewMessageHandler: any = null;
  private boundEditedMessageHandler: any = null;

  /**
   * Wraps an operation with timeout to prevent hanging
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number = 15000, operationName: string = 'Operation'): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs / 1000} seconds. Check your internet connection and try again.`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeout]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Maps Telegram API errors to user-friendly messages
   */
  private mapTelegramError(error: any): string {
    const errorMessage = error.message || '';
    const errorStack = error.stack || '';

    // Connection state errors
    if (errorMessage.includes('Cannot send requests while disconnected') || 
        errorMessage.includes('Cannot send requests while not connected')) {
      return 'Telegram client is not connected. This can happen when:\n' +
        '• The connection was not established during initialization\n' +
        '• The connection was lost due to network issues\n' +
        '• API credentials are invalid\n\n' +
        'Please try again. The system will attempt to reconnect automatically.';
    }

    // Network-level errors
    if (errorMessage.includes('ECONNRESET') || errorMessage.includes('ECONNREFUSED')) {
      return 'Connection refused by Telegram servers. This can happen when:\n' +
        '• API credentials are invalid or revoked\n' +
        '• Telegram is temporarily blocking your IP\n' +
        '• Server maintenance is in progress\n\n' +
        'Check @telegramstatus on Twitter and try again in a few minutes.';
    }

    if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
      return 'Connection timed out. This usually means:\n' +
        '• Your internet connection is slow or unstable\n' +
        '• A firewall is blocking the connection\n' +
        '• Telegram servers are unreachable\n\n' +
        'Check your internet connection and try again.';
    }

    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('NETWORK')) {
      return 'Network error. Please check your internet connection and try again.';
    }

    // Telegram API errors
    if (errorMessage.includes('PHONE_NUMBER_INVALID')) {
      return 'Invalid phone number format. Use international format: +[country code][number]\n' +
        'Example: +1234567890 (include the + sign and country code)';
    }

    if (errorMessage.includes('API_ID_INVALID')) {
      return 'Invalid API ID. Get correct credentials from:\n' +
        '1. Go to https://my.telegram.org\n' +
        '2. Login with your phone\n' +
        '3. Go to "API development tools"\n' +
        '4. Copy the "App api_id" (numeric value)';
    }

    if (errorMessage.includes('API_HASH_INVALID')) {
      return 'Invalid API Hash. Get correct credentials from:\n' +
        '1. Go to https://my.telegram.org\n' +
        '2. Login with your phone\n' +
        '3. Go to "API development tools"\n' +
        '4. Copy the "App api_hash" (long string)';
    }

    if (errorMessage.includes('PHONE_CODE_INVALID')) {
      return 'Invalid verification code. Please check the code from your Telegram app and try again.\n' +
        '• Codes are usually 5 digits\n' +
        '• Codes expire after a few minutes\n' +
        '• Request a new code if this one expired';
    }

    if (errorMessage.includes('FLOOD_WAIT')) {
      const waitMatch = errorMessage.match(/(\d+)/);
      const waitSeconds = waitMatch ? waitMatch[1] : 'a few';
      return `Too many requests. Telegram requires you to wait ${waitSeconds} seconds before trying again.\n\n` +
        'This is a rate limit to prevent spam. Please wait and try again.';
    }

    if (errorMessage.includes('SESSION_PASSWORD_NEEDED')) {
      return 'Two-factor authentication (2FA) is enabled on your Telegram account.\n' +
        'This feature is not yet supported by the copy trade system. Please disable 2FA temporarily or contact support.';
    }

    if (errorMessage.includes('AUTH_KEY_UNREGISTERED')) {
      return 'Telegram session expired. Please re-authenticate.\n\n' +
        'Your saved session is no longer valid. Go to Config tab and complete authentication again:\n' +
        '1. Enter your phone number and API credentials\n' +
        '2. Click "Request Code"\n' +
        '3. Enter the verification code from Telegram';
    }

    // Generic connection errors
    if (errorMessage.includes('Not connected') || errorMessage.includes('connection closed')) {
      return 'Connection to Telegram servers was closed. This can happen when:\n' +
        '• The connection was interrupted\n' +
        '• Telegram servers rejected the connection\n' +
        '• Network instability\n\n' +
        'Please try again. If the problem persists, check your API credentials.';
    }

    // Default error message
    return `Telegram error: ${errorMessage}\n\n` +
      'If this error persists, please:\n' +
      '1. Verify your API credentials at my.telegram.org\n' +
      '2. Check your internet connection\n' +
      '3. Try again in a few minutes';
  }

  async initialize() {
    const config = await getConfig();

    // Check environment variables first (for Render deployment), fall back to config
    const apiId = process.env.TELEGRAM_API_ID || config.telegram.apiId;
    const apiHash = process.env.TELEGRAM_API_HASH || config.telegram.apiHash;

    if (!apiId || !apiHash) {
      console.warn('[Telegram] API credentials not configured (check env vars or config.json)');
      return;
    }

    // Use env var phone number if available, otherwise from config
    const configPhone = process.env.TELEGRAM_PHONE || config.telegram.phoneNumber || '';

    console.log(`[Telegram] Loading credentials from ${process.env.TELEGRAM_API_ID ? 'environment variables' : 'config file'}`);

    const apiIdNum = parseInt(apiId, 10);
    const apiHashStr = apiHash;

    // Migrate session from config to session file if needed
    if (config.telegram.sessionString && config.telegram.sessionString.length > 0) {
      console.log('[Telegram] Migrating session from config to session file...');
      try {
        await migrateSessionFromConfig(config.telegram.sessionString, config.telegram.phoneNumber);

        // Clear session string from config after migration
        config.telegram.sessionString = '';
        await updateConfig({ telegram: config.telegram });
      } catch (error: any) {
        console.error('[Telegram] Failed to migrate session:', error.message);
      }
    }

    // Load session from dedicated session file
    let savedSession = '';
    const session = await getSession();
    if (session && session.sessionString) {
      savedSession = session.sessionString;
      this.phoneNumber = session.phoneNumber;
      console.log(`[Telegram] Loaded session for ${session.phoneNumber}`);
    } else {
      console.log('[Telegram] No saved session found');
    }

    const stringSession = new StringSession(savedSession);
    this.sessionInstance = stringSession; // Store reference to save later

    console.log('[Telegram] Initializing client' + (savedSession ? ' with saved session' : '') + '...');

    this.client = new TelegramClient(stringSession, apiIdNum, apiHashStr, {
      connectionRetries: 10,
      autoReconnect: true,
      timeout: 20000, // 20 second timeout for individual requests
      baseLogger: undefined, // Disable verbose GramJS logging
      useWSS: true // Use WebSocket (more reliable through firewalls)
    });

    console.log('[Telegram] Client configured successfully, connecting...');

    try {
      await this.withTimeout(
        this.client.connect(),
        30000, // 30 seconds for initial connection
        'Connection to Telegram'
      );
      console.log('[Telegram] Connected successfully');

      // Update auth state if session loaded
      if (savedSession) {
        this.authState = 'authenticated';
      }
    } catch (error: any) {
      console.error('[Telegram] Connection failed:', error.message);

      // Detect expired session and clear it
      if (error.message && error.message.includes('AUTH_KEY_UNREGISTERED')) {
        console.warn('[Telegram] Session expired, clearing from session file');
        await clearSession();

        // Also update config auth state
        const updatedConfig = await getConfig();
        updatedConfig.telegram.isAuthenticated = false;
        updatedConfig.telegram.authState = 'disconnected';
        await updateConfig({ telegram: updatedConfig.telegram });

        this.authState = 'disconnected';
        throw new Error('Telegram session expired. Please re-authenticate.');
      }

      const userMessage = this.mapTelegramError(error);
      throw new Error(userMessage);
    }
  }

  async requestCode(phoneNumber: string): Promise<{ phoneCodeHash: string }> {
    try {
      console.log('[Telegram] Starting code request for:', phoneNumber);

      if (!this.client) {
        console.log('[Telegram] Client not initialized, initializing...');
        await this.initialize();
      }

      if (!this.client) {
        throw new Error('Telegram client not initialized. Check API credentials.');
      }

      // Ensure client is connected (reconnect if needed)
      if (!this.client.connected) {
        console.log('[Telegram] Client disconnected, reconnecting...');
        await this.initialize();
      }

      console.log('[Telegram] Sending verification code request...');

      // Use env vars for sendCode, fall back to config
      const config = await getConfig();
      const apiId = parseInt(process.env.TELEGRAM_API_ID || config.telegram.apiId, 10);
      const apiHash = process.env.TELEGRAM_API_HASH || config.telegram.apiHash;

      // sendCode() requires connected client
      const result = await this.withTimeout(
        this.client.sendCode(
          { apiId, apiHash },
          phoneNumber
        ),
        15000,
        'Code request'
      );

      console.log('[Telegram] Code sent successfully, phoneCodeHash:', result.phoneCodeHash);

      this.phoneNumber = phoneNumber;
      this.codeHash = result.phoneCodeHash;

      // Update config with auth state
      const updatedConfig = await getConfig();
      updatedConfig.telegram.phoneNumber = phoneNumber;
      updatedConfig.telegram.authState = 'code_sent';
      updatedConfig.telegram.phoneCodeHash = result.phoneCodeHash;
      await updateConfig({ telegram: updatedConfig.telegram });

      this.authState = 'code_sent';

      await logger.log('message_received', `Telegram code sent to ${phoneNumber}`);

      return { phoneCodeHash: result.phoneCodeHash };
    } catch (error: any) {
      console.error('[Telegram] Code request failed:', error.message);
      
      const userMessage = this.mapTelegramError(error);
      
      await logger.log('message_ignored', `Failed to send Telegram code: ${error.message}`);

      // Reset state on error
      this.authState = 'disconnected';
      this.phoneNumber = null;
      this.codeHash = null;

      throw new Error(userMessage);
    }
  }

  async completeAuth(code: string): Promise<void> {
    try {
      console.log('[Telegram] Completing authentication with code:', code);

      if (!this.client || !this.phoneNumber) {
        throw new Error('Telegram client not initialized. Request code first.');
      }

      console.log('[Telegram] Signing in with verification code...');

      // Use env vars for signInUser, fall back to config
      const config = await getConfig();
      const apiId = parseInt(process.env.TELEGRAM_API_ID || config.telegram.apiId, 10);
      const apiHash = process.env.TELEGRAM_API_HASH || config.telegram.apiHash;

      // Sign in with the code using GramJS signInUser method
      const signInResult = await this.withTimeout(
        this.client.signInUser(
          { apiId, apiHash },
          {
            phoneNumber: this.phoneNumber,
            phoneCode: async () => code,
            onError: () => {}
          }
        ),
        15000,
        'Authentication'
      );

      if (!signInResult) {
        throw new Error('Failed to sign in. Invalid code or phone number.');
      }

      console.log('[Telegram] Authentication successful');

      // Validate the session by fetching account info before saving
      // This is optional - don't fail auth if validation fails (mock clients may not support it)
      try {
        if (this.client.getMe) {
          const me = await this.withTimeout(
            this.client.getMe(),
            10000,
            'Session validation'
          );

          if (me) {
            console.log('[Telegram] Session validated for user:', (me as any).username || (me as any).firstName);
          }
        } else {
          console.log('[Telegram] Skipping session validation (getMe not available)');
        }
      } catch (validationError: any) {
        console.warn('[Telegram] Session validation failed (continuing anyway):', validationError.message);
        // Don't fail authentication if validation fails - just log warning
      }

      // Save the session string to persist authentication
      if (this.sessionInstance && typeof this.sessionInstance.save === 'function') {
        try {
          const sessionString = this.sessionInstance.save();

          // Save to dedicated session file
          await saveSession({
            sessionString,
            phoneNumber: this.phoneNumber
          });
        } catch (saveError: any) {
          console.error('[Telegram] Failed to save session file:', saveError.message);
          // Continue anyway - we still need to update config.json
        }
      } else {
        console.warn('[Telegram] Session instance not available or save method missing - auth will work but session won\'t persist');
      }

      // ALWAYS update config auth state so the UI and listener can see the change
      try {
        const updatedConfig = await getConfig();
        updatedConfig.telegram.isAuthenticated = true;
        updatedConfig.telegram.authState = 'authenticated';
        updatedConfig.telegram.phoneNumber = this.phoneNumber || '';
        updatedConfig.telegram.sessionString = ''; // Clear from config, use session file
        await updateConfig({ telegram: updatedConfig.telegram });
        console.log('[Telegram] Config updated: isAuthenticated=true, authState=authenticated');
      } catch (configError: any) {
        console.error('[Telegram] Failed to update config auth state:', configError.message);
      }

      this.authState = 'authenticated';

      await logger.log('message_received', 'Telegram authentication successful');
    } catch (error: any) {
      console.error('[Telegram] Authentication failed:', error.message);

      const userMessage = this.mapTelegramError(error);

      await logger.log('message_ignored', `Telegram auth failed: ${error.message}`);

      // Reset state on error - don't save broken session
      this.authState = 'disconnected';
      this.phoneNumber = null;
      this.codeHash = null;

      // Clear any invalid session string from config and session file
      try {
        const config = await getConfig();
        config.telegram.isAuthenticated = false;
        config.telegram.authState = 'disconnected';
        config.telegram.sessionString = '';
        await updateConfig({ telegram: config.telegram });
        
        // Also clear session file
        await clearSession();
      } catch (configError) {
        console.error('[Telegram] Failed to clear config after auth error:', configError);
      }

      throw new Error(userMessage);
    }
  }

  async disconnect(): Promise<void> {
    try {
      console.log('[Telegram] Disconnecting...');

      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }

      // Clear session file
      await clearSession();

      const config = await getConfig();
      config.telegram.isAuthenticated = false;
      config.telegram.authState = 'disconnected';
      config.telegram.phoneNumber = '';
      config.telegram.phoneCodeHash = undefined;
      config.telegram.sessionString = '';
      await updateConfig({ telegram: config.telegram });

      this.authState = 'disconnected';
      this.phoneNumber = null;
      this.codeHash = null;

      console.log('[Telegram] Disconnected successfully');
      await logger.log('message_received', 'Telegram client disconnected');
    } catch (error: any) {
      console.error('[Telegram] Error disconnecting:', error.message);

      // Force reset state even if disconnect fails
      this.authState = 'disconnected';
      this.phoneNumber = null;
      this.codeHash = null;

      throw new Error(`Failed to disconnect: ${error.message}`);
    }
  }

  /**
   * Resolve all channel IDs to GramJS InputChannel objects
   * InputChannel is the lightweight format required by event filters
   */
  private async resolveChannelEntities(channels: string[]): Promise<void> {
    this.channelEntities.clear();

    try {
      console.log(`[Telegram] Fetching all chats to populate entity cache...`);

      // Use GetChats to get all channels and chats
      // Note: We need to fetch dialogs first to get the channel list
      const dialogs = await this.client!.getDialogs({});
      console.log(`[Telegram] Retrieved ${dialogs.length} dialogs`);

      // Build a map of channel IDs to their entities from dialogs
      const channelMap = new Map<string, any>();

      for (const dialog of dialogs) {
        const entity = dialog.entity;
        if (entity instanceof Api.Channel) {
          // Channel IDs in Telegram are negative, with -100 prefix for channels/supergroups
          const channelIdStr = `-100${entity.id.toString()}`;
          channelMap.set(channelIdStr, entity);
          channelMap.set(entity.id.toString(), entity);
          console.log(`[Telegram] Found channel: ${channelIdStr} - ${entity.title || 'Untitled'}`);
        }
      }

      // Now resolve each configured channel
      let resolvedCount = 0;
      for (const channelId of channels) {
        try {
          console.log(`[Telegram] Resolving channel entity: ${channelId}`);

          // Check if we found it in the GetAllChats result
          let entity = channelMap.get(channelId);

          if (!entity) {
            console.log(`[Telegram] Channel ${channelId} not in dialogs, trying getInputEntity...`);
            // Fallback: try getInputEntity directly (might work if already cached)
            entity = await this.client!.getInputEntity(channelId);
          }

          if (entity) {
            // Convert to InputPeer format (what GramJS event filters actually expect)
            let inputPeer;
            
            if (entity instanceof Api.Channel) {
              // Full Channel entity - convert to InputPeerChannel
              if (entity.accessHash === undefined) {
                throw new Error(`Channel ${channelId} has no accessHash. Trying getInputEntity...`);
              }
              inputPeer = new Api.InputPeerChannel({
                channelId: entity.id,
                accessHash: entity.accessHash
              });
              console.log(`[Telegram] ✅ Created InputPeerChannel from Api.Channel: ${channelId} - ${entity.title || 'Untitled'}`);
            } else if (entity instanceof Api.InputPeerChannel || entity instanceof Api.InputPeerUser || entity instanceof Api.InputPeerChat) {
              // Already an InputPeer
              inputPeer = entity;
              console.log(`[Telegram] ✅ Using existing InputPeer: ${channelId}`);
            } else {
              // Try to get InputPeer from the client
              const inputEntity = await this.client!.getInputEntity(channelId);
              if (inputEntity instanceof Api.InputPeerChannel || inputEntity instanceof Api.InputPeerUser || inputEntity instanceof Api.InputPeerChat) {
                inputPeer = inputEntity;
                console.log(`[Telegram] ✅ Created InputPeer via getInputEntity: ${channelId}`);
              } else {
                throw new Error(`Entity is not InputPeer format`);
              }
            }

            this.channelEntities.set(channelId, inputPeer);
            resolvedCount++;
          } else {
            throw new Error(`Channel ${channelId} not found in accessible channels`);
          }
        } catch (error: any) {
          console.error(`[Telegram] ❌ Failed to resolve channel ${channelId}:`, error.message);
          await logger.log('message_ignored', `Failed to resolve channel ${channelId}: ${error.message}`);
          // Don't throw - continue with other channels
        }
      }

      console.log(`[Telegram] Channel resolution complete: ${resolvedCount}/${channels.length} channels resolved`);
      
      if (resolvedCount === 0) {
        throw new Error('No channel entities could be resolved. Check channel IDs and bot access.');
      }
    } catch (error: any) {
      console.error(`[Telegram] Error resolving channel entities:`, error.message);
      await logger.log('message_ignored', `Failed to resolve channel entities: ${error.message}`);
      throw error;
    }
  }

  onMessage(handler: (event: any) => void): void {
    console.log('[Telegram] onMessage called - adding handler. Total handlers before:', this.messageHandlers.length);
    
    // Check if this exact handler is already registered (prevent duplicates)
    const isDuplicate = this.messageHandlers.some(h => h === handler);
    if (isDuplicate) {
      console.log('[Telegram] Handler already registered, skipping duplicate');
      return;
    }
    
    this.messageHandlers.push(handler);
    console.log('[Telegram] onMessage complete. Total handlers after:', this.messageHandlers.length);
  }

  async startListening(channels: string[]): Promise<void> {
    if (this.isRunning) {
      console.log('[Telegram] Listener already running');
      return;
    }

    try {
      console.log('[Telegram] Starting event-driven message listener for channels:', channels);

      if (!this.client) {
        throw new Error('Telegram client not initialized');
      }

      if (!this.client.connected) {
        console.log('[Telegram] Client not connected, initializing...');
        await this.initialize();
      }

      // Store channels
      this.pollingChannels = channels;

      // Register NewMessage event handler
      console.log('[Telegram] Registering NewMessage event handler...');
      console.log('[Telegram] Channels to listen to:', channels);

      // Store bound handler in property to ensure we can remove it later
      this.boundNewMessageHandler = this.handleNewMessageEvent.bind(this);

      // Pass channel IDs as strings - GramJS _intoIdSet handles these natively
      this.client.addEventHandler(
        this.boundNewMessageHandler, // Use stored property
        new NewMessage({
          chats: channels, // Pass string channel IDs: ["-1001222394814", "-1003731832656"]
          incoming: true
        })
      );
      console.log('[Telegram] NewMessage event handler registered with', channels.length, 'channel strings');
      await logger.log('message_received', 'NewMessage event handler registered');

      // Register EditedMessage event handler
      console.log('[Telegram] Registering EditedMessage event handler...');
      this.boundEditedMessageHandler = this.handleEditedMessageEvent.bind(this); // Store bound handler
      this.client.addEventHandler(
        this.boundEditedMessageHandler, // Use stored property
        new EditedMessage({
          chats: channels, // Pass string channel IDs
        })
      );
      console.log('[Telegram] EditedMessage event handler registered successfully');
      await logger.log('message_received', 'EditedMessage event handler registered');

      // Update config
      const config = await getConfig();
      config.listener.isActive = true;
      await updateConfig({ listener: config.listener });

      // Start keep-alive ping to maintain MTProto connection
      this.startKeepAlive();

      this.isRunning = true;
      await logger.log('message_received', `Telegram listener started with event handlers for channels: ${channels.join(', ')}`);
      console.log('[Telegram] Event-driven message listener started successfully');
    } catch (error: any) {
      console.error('[Telegram] Failed to start listener:', error.message);
      await logger.log('message_ignored', `Failed to start listener: ${error.message}`);
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[Telegram] Stopping event-driven listener...');

      // Stop keep-alive ping
      this.stopKeepAlive();

      // Remove event handlers using the SAME references used in addEventHandler
      if (this.client) {
        if (this.boundNewMessageHandler) {
            this.client.removeEventHandler(this.boundNewMessageHandler, new NewMessage({}));
        }
        if (this.boundEditedMessageHandler) {
            this.client.removeEventHandler(this.boundEditedMessageHandler, new EditedMessage({}));
        }
        console.log('[Telegram] Event handlers removed');
      }

      // Clear message handlers to prevent stacking on restart
      console.log(`[Telegram] Clearing ${this.messageHandlers.length} message handlers`);
      this.messageHandlers = [];

      this.pollingChannels = [];
      this.channelEntities.clear();

      const config = await getConfig();
      config.listener.isActive = false;
      await updateConfig({ listener: config.listener });

      this.isRunning = false;
      await logger.log('message_received', 'Telegram listener stopped');
      console.log('[Telegram] Event-driven listener stopped successfully');
    } catch (error: any) {
      console.error('[Telegram] Error stopping listener:', error.message);
      await logger.log('message_ignored', `Error stopping listener: ${error.message}`);
      // Force stop state even if error occurs
      this.isRunning = false;
    }
  }

  /**
   * Convert GramJS chatId (which can be BigInt) to string for channel matching
   */
  private convertChatId(chatId: any): string {
    // Handle BigInt Integer objects from GramJS: Integer { value: -1003731832656n }
    if (typeof chatId === 'object' && chatId !== null) {
      if (chatId.value !== undefined) {
        // It's a BigInt wrapper object
        return chatId.value.toString();
      }
      // Try toString if it has the value
      return chatId.toString();
    }
    // Already a string or number
    return String(chatId);
  }

  /**
   * Handler for NewMessage events from GramJS
   */
  private async handleNewMessageEvent(event: any): Promise<void> {
    try {
      console.log('[Telegram] ====== handleNewMessageEvent TRIGGERED ======');
      console.log('[Telegram] Event object keys:', Object.keys(event || {}));
      console.log('[Telegram] Event.message:', event?.message);
      console.log('[Telegram] Event.message.id:', event?.message?.id);
      console.log('[Telegram] Event.message.text:', event?.message?.text?.substring(0, 100));
      console.log('[Telegram] Event.chatId:', event?.chatId);
      console.log('[Telegram] Event.message.editDate:', event?.message?.editDate);
      console.log('[Telegram] Registered messageHandlers count:', this.messageHandlers.length);

      // Convert chatId to string (handle BigInt objects from GramJS)
      const rawChatId = event.chatId;
      const rawChatIdType = typeof rawChatId;
      const rawChatIdIsObject = rawChatId && typeof rawChatId === 'object';
      const channelId = this.convertChatId(rawChatId);

      console.log('[Telegram] ChatId conversion:', {
        raw: rawChatId?.toString(),
        rawType: rawChatIdType,
        isObject: rawChatIdIsObject,
        hasValueProperty: rawChatIdIsObject && rawChatId.value !== undefined,
        converted: channelId
      });

      const messageId = event.message?.id?.toString() || '';
      const text = event.message?.text || '';

      console.log(`[Telegram] NewMessage event - Channel: ${channelId}, ID: ${messageId}, Text: ${text.substring(0, 50)}`);

      // Verify channel is in our configured list
      const config = await getConfig();
      const configuredChannels = config.telegram.channels || [];
      const isConfiguredChannel = configuredChannels.includes(channelId);
      console.log('[Telegram] Channel verification:', {
        channelId,
        configuredChannels,
        isConfigured: isConfiguredChannel
      });

      if (!isConfiguredChannel) {
        console.log('[Telegram] WARNING: Message from unconfigured channel, ignoring');
        return;
      }

      // Check if message was already edited (editDate present)
      const isEdited = event.message?.editDate ? true : false;
      console.log('[Telegram] Is edited:', isEdited);

      // Build event object matching what listener expects
      const messageEvent = {
        message: event.message,
        chatId: channelId,
        isEdited: isEdited
      };

      console.log('[Telegram] Invoking', this.messageHandlers.length, 'registered handlers');

      // Invoke all registered handlers
      for (let i = 0; i < this.messageHandlers.length; i++) {
        const handler = this.messageHandlers[i];
        try {
          console.log(`[Telegram] Invoking handler ${i + 1}/${this.messageHandlers.length}`);
          await handler(messageEvent);
          console.log(`[Telegram] Handler ${i + 1} completed successfully`);
        } catch (handlerError: any) {
          console.error(`[Telegram] Error in message handler ${i + 1}:`, handlerError.message);
          console.error('[Telegram] Handler error stack:', handlerError.stack);
        }
      }
      
      console.log('[Telegram] ====== handleNewMessageEvent COMPLETE ======');
    } catch (error: any) {
      console.error('[Telegram] Error in handleNewMessageEvent:', error.message);
      console.error('[Telegram] Error stack:', error.stack);
    }
  }

  /**
   * Handler for EditedMessage events from GramJS
   */
  private async handleEditedMessageEvent(event: any): Promise<void> {
    try {
      console.log('[Telegram] ====== handleEditedMessageEvent TRIGGERED ======');
      console.log('[Telegram] Event object keys:', Object.keys(event || {}));
      console.log('[Telegram] Event.message.id:', event?.message?.id);
      console.log('[Telegram] Event.message.text:', event?.message?.text?.substring(0, 100));
      console.log('[Telegram] Event.chatId:', event?.chatId);
      console.log('[Telegram] Registered messageHandlers count:', this.messageHandlers.length);

      // Convert chatId to string (handle BigInt objects from GramJS)
      const rawChatId = event.chatId;
      const rawChatIdType = typeof rawChatId;
      const rawChatIdIsObject = rawChatId && typeof rawChatId === 'object';
      const channelId = this.convertChatId(rawChatId);

      console.log('[Telegram] ChatId conversion:', {
        raw: rawChatId?.toString(),
        rawType: rawChatIdType,
        isObject: rawChatIdIsObject,
        hasValueProperty: rawChatIdIsObject && rawChatId.value !== undefined,
        converted: channelId
      });

      const messageId = event.message?.id?.toString() || '';
      const text = event.message?.text || '';

      console.log(`[Telegram] EditedMessage event - Channel: ${channelId}, ID: ${messageId}, Text: ${text.substring(0, 50)}`);

      // Verify channel is in our configured list
      const config = await getConfig();
      const configuredChannels = config.telegram.channels || [];
      const isConfiguredChannel = configuredChannels.includes(channelId);
      console.log('[Telegram] Channel verification:', {
        channelId,
        configuredChannels,
        isConfigured: isConfiguredChannel
      });

      if (!isConfiguredChannel) {
        console.log('[Telegram] WARNING: Edited message from unconfigured channel, ignoring');
        return;
      }

      // Build event object matching what listener expects
      const messageEvent = {
        message: event.message,
        chatId: channelId,
        isEdited: true
      };

      console.log('[Telegram] Invoking', this.messageHandlers.length, 'registered handlers');

      // Invoke all registered handlers
      for (let i = 0; i < this.messageHandlers.length; i++) {
        const handler = this.messageHandlers[i];
        try {
          console.log(`[Telegram] Invoking edit handler ${i + 1}/${this.messageHandlers.length}`);
          await handler(messageEvent);
          console.log(`[Telegram] Edit handler ${i + 1} completed successfully`);
        } catch (handlerError: any) {
          console.error(`[Telegram] Error in edit handler ${i + 1}:`, handlerError.message);
          console.error('[Telegram] Edit handler error stack:', handlerError.stack);
        }
      }
      
      console.log('[Telegram] ====== handleEditedMessageEvent COMPLETE ======');
    } catch (error: any) {
      console.error('[Telegram] Error in handleEditedMessageEvent:', error.message);
      console.error('[Telegram] Error stack:', error.stack);
    }
  }

  /**
   * Start keep-alive ping to maintain MTProto connection
   */
  private startKeepAlive(): void {
    console.log('[Telegram] Keep-alive ping started (30s interval)');
    
    this.keepAliveInterval = setInterval(async () => {
      try {
        if (this.client && this.client.connected) {
          // Simple ping to keep connection alive
          await this.client.getEntity('me');
        }
      } catch (error: any) {
        console.log('[Telegram] Keep-alive ping failed:', error.message);
        // Don't log every failure - connection will be restored automatically
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop keep-alive ping
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.log('[Telegram] Keep-alive ping stopped');
    }
  }

  getStatus(): TelegramStatus {
    return {
      isConnected: this.authState === 'authenticated',
      authState: this.authState,
      phoneNumber: this.phoneNumber || undefined
    };
  }

  async getSessionStatus(): Promise<{
    hasSession: boolean;
    phoneNumber?: string;
    createdAt?: string;
    lastValidated?: string;
  }> {
    const session = await getSession();
    if (!session) {
      return { hasSession: false };
    }
    
    return {
      hasSession: true,
      phoneNumber: session.phoneNumber,
      createdAt: session.createdAt,
      lastValidated: session.lastValidated
    };
  }

  getClient(): TelegramClient | null {
    return this.client;
  }

  /**
   * Fetch recent messages from a channel for debugging
   */
  async fetchChannelMessages(channelId: string, count: number): Promise<Array<{
    id: number;
    text: string;
    date: string;
    isEdited: boolean;
  }>> {
    if (!this.client || !this.client.connected) {
      throw new Error('Telegram client not connected');
    }

    try {
      console.log(`[Telegram] Fetching ${count} messages from channel ${channelId}...`);

      // Resolve channel entity
      const entity = await this.client.getInputEntity(channelId);

      // Fetch messages
      const messages = await this.client.getMessages(entity, { limit: count });

      console.log(`[Telegram] Fetched ${messages.length} messages from ${channelId}`);

      const results = messages.map(msg => {
        const text = msg.message || '';
        const isEdited = !!msg.editDate;

        // Log raw and cleaned text for debugging
        console.log(`[Telegram] Message ${msg.id} (edited: ${isEdited}):`);
        console.log(`[Telegram]   Raw: ${JSON.stringify(text.substring(0, 150))}`);

        // Strip icons for debugging (replace with spaces to preserve word boundaries)
        const cleaned = text
          .replace(/<[^>]+>/g, ' ')
          .replace(/[\u{1F600}-\u{1F64F}]/gu, ' ')
          .replace(/[\u{1F300}-\u{1F5FF}]/gu, ' ')
          .replace(/[\u{1F680}-\u{1F6FF}]/gu, ' ')
          .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ' ')
          .replace(/[\u{1F900}-\u{1F9FF}]/gu, ' ')
          .replace(/[\u{2600}-\u{26FF}]/gu, ' ')
          .replace(/[\u{2700}-\u{27BF}]/gu, ' ')
          .replace(/[\u{FE00}-\u{FE0F}]/gu, ' ')
          .replace(/[\u{200D}]/gu, ' ')
          .replace(/[\u{1FA70}-\u{1FAFF}]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        console.log(`[Telegram]   Cleaned: ${cleaned.substring(0, 150)}`);

        return {
          id: msg.id,
          text,
          date: msg.date ? new Date(msg.date * 1000).toISOString() : '',
          isEdited
        };
      });

      return results;
    } catch (error: any) {
      console.error(`[Telegram] Failed to fetch messages:`, error.message);
      throw error;
    }
  }
}

export const telegramService = new TelegramService();
