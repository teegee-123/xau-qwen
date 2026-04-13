import { telegramService } from '../backend/src/services/telegram.service';
import * as jsonStore from '../backend/src/storage/json-store';

// Mock GramJS/telegram package
jest.mock('telegram', () => ({
  TelegramClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    sendCode: jest.fn().mockResolvedValue({ phoneCodeHash: 'hash-123' }),
    signInUser: jest.fn().mockResolvedValue({}),
    start: jest.fn().mockResolvedValue(undefined)
  }))
}), { virtual: true });

jest.mock('telegram/sessions', () => ({
  StringSession: jest.fn().mockImplementation(() => ({}))
}), { virtual: true });

jest.mock('../backend/src/storage/json-store');
jest.mock('../backend/src/services/logger.service');

describe('Telegram Auth Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (jsonStore.getConfig as jest.Mock).mockResolvedValue({
      telegram: {
        phoneNumber: '+1234567890',
        apiId: '12345',
        apiHash: 'hash123',
        channels: [],
        isAuthenticated: false,
        authState: 'disconnected'
      },
      oanda: {
        accountId: '',
        token: '',
        environment: 'practice'
      },
      trading: {
        lotSize: 0.01,
        symbol: 'XAUUSD',
        closeTimeoutMinutes: 3,
        maxRetries: 3,
        retryDelayMs: 2000
      },
      messages: {
        initialPattern: '',
        editedPattern: ''
      },
      listener: {
        isActive: false
      }
    });
  });

  describe('initialize', () => {
    it('should initialize Telegram client with credentials', async () => {
      await telegramService.initialize();

      expect(jsonStore.getConfig).toHaveBeenCalled();
    });

    it('should warn if credentials not configured', async () => {
      (jsonStore.getConfig as jest.Mock).mockResolvedValue({
        telegram: {
          phoneNumber: '',
          apiId: '',
          apiHash: '',
          channels: [],
          isAuthenticated: false,
          authState: 'disconnected'
        }
      });

      const warnSpy = jest.spyOn(console, 'warn');
      await telegramService.initialize();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('API credentials not configured'));
    });
  });

  describe('requestCode', () => {
    it('should send code request and update config', async () => {
      await telegramService.initialize();
      const result = await telegramService.requestCode('+1234567890');

      expect(result.phoneCodeHash).toBe('hash-123');
      expect(jsonStore.updateConfig).toHaveBeenCalled();
    });

    it('should update authState to code_sent', async () => {
      await telegramService.initialize();
      await telegramService.requestCode('+1234567890');

      expect(jsonStore.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          telegram: expect.objectContaining({
            authState: 'code_sent',
            phoneNumber: '+1234567890'
          })
        })
      );
    });

    it('should auto-initialize if client not initialized', async () => {
      // Don't initialize - should auto-init
      await telegramService.requestCode('+1234567890');
      // Should not throw and should call sendCode
      expect(jsonStore.updateConfig).toHaveBeenCalled();
    });
  });

  describe('completeAuth', () => {
    it('should complete authentication with code', async () => {
      await telegramService.initialize();
      await telegramService.requestCode('+1234567890');
      await telegramService.completeAuth('12345');

      expect(jsonStore.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          telegram: expect.objectContaining({
            isAuthenticated: true,
            authState: 'authenticated'
          })
        })
      );
    });

    it('should update status to authenticated', async () => {
      await telegramService.initialize();
      await telegramService.requestCode('+1234567890');
      await telegramService.completeAuth('12345');

      const status = telegramService.getStatus();
      expect(status.authState).toBe('authenticated');
      expect(status.isConnected).toBe(true);
    });

    it('should resolve even if requestCode was not called first (mock client has no validation)', async () => {
      // Mock client doesn't validate phone number, so completeAuth resolves
      await expect(telegramService.completeAuth('12345')).resolves.toBeUndefined();
    });
  });

  describe('disconnect', () => {
    it('should disconnect and reset state', async () => {
      await telegramService.initialize();
      await telegramService.requestCode('+1234567890');
      await telegramService.completeAuth('12345');

      await telegramService.disconnect();

      expect(jsonStore.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          telegram: expect.objectContaining({
            isAuthenticated: false,
            authState: 'disconnected',
            phoneNumber: ''
          })
        })
      );

      const status = telegramService.getStatus();
      expect(status.authState).toBe('disconnected');
      expect(status.isConnected).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return disconnected state initially', () => {
      const status = telegramService.getStatus();
      expect(status.authState).toBe('disconnected');
      expect(status.isConnected).toBe(false);
    });

    it('should return code_sent state after requestCode', async () => {
      await telegramService.initialize();
      await telegramService.requestCode('+1234567890');

      const status = telegramService.getStatus();
      expect(status.authState).toBe('code_sent');
    });

    it('should return authenticated state after completeAuth', async () => {
      await telegramService.initialize();
      await telegramService.requestCode('+1234567890');
      await telegramService.completeAuth('12345');

      const status = telegramService.getStatus();
      expect(status.authState).toBe('authenticated');
      expect(status.isConnected).toBe(true);
    });
  });
});
