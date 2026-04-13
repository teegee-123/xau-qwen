import React, { useState, useEffect } from 'react';
import { ExternalLink, AlertCircle, CheckCircle, Loader2, Info, AlertTriangle } from 'lucide-react';
import { fetchWithTimeout } from '../utils/fetch';
import { NukeModal } from './NukeModal';
import { StrategyManager } from './StrategyManager';

interface FetchedMessage {
  id: number;
  text: string;
  date: string;
  isEdited: boolean;
}

export interface Strategy {
  id: string;
  name: string;
  isActive: boolean;
  channels: string[];
  trading: {
    lotSize: number;
    symbol: string;
    closeTimeoutMinutes: number;
    maxRetries: number;
    retryDelayMs: number;
    trailingStopDistance: number;
    listenToReplies: boolean;
  };
}

interface Config {
  telegram: {
    phoneNumber: string;
    apiId: string;
    apiHash: string;
    channels: string[];
    isAuthenticated: boolean;
    authState: 'disconnected' | 'code_sent' | 'authenticated';
  };
  oanda: {
    accountId: string;
    token: string;
    environment: 'practice' | 'live';
    lastTestedAt?: string;
    lastTestResult?: { success: boolean; message: string };
  };
  trading: {
    lotSize: number;
    symbol: string;
    closeTimeoutMinutes: number;
    maxRetries: number;
    retryDelayMs: number;
    trailingStopDistance?: number;
    listenToReplies?: boolean;
  };
  messages: {
    initialPattern: string;
    editedPattern: string;
  };
  listener: {
    isActive: boolean;
  };
}

interface TelegramStatus {
  isConnected: boolean;
  authState: 'disconnected' | 'code_sent' | 'authenticated';
  phoneNumber?: string;
}

interface FetchMessagesProps {
  config: any;
}

const FetchMessages: React.FC<FetchMessagesProps> = ({ config }) => {
  const [selectedChannel, setSelectedChannel] = useState('');
  const [messageCount, setMessageCount] = useState(20);
  const [fetching, setFetching] = useState(false);
  const [messages, setMessages] = useState<FetchedMessage[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const handleFetch = async () => {
    if (!selectedChannel) return;
    setFetching(true);
    setFetchError(null);
    setMessages([]);

    try {
      const res = await fetchWithTimeout('/api/telegram/fetch-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: selectedChannel, count: messageCount })
      }, 30000);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch messages');
      }

      const data = await res.json();
      setMessages(data.messages || []);
    } catch (error: any) {
      setFetchError(error.message);
    } finally {
      setFetching(false);
    }
  };

  const stripIcons = (text: string) => {
    if (!text || typeof text !== 'string') return '';
    return text
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
  };

  const channels = config?.telegram?.channels || [];

  if (channels.length === 0) {
    return (
      <div className="bg-trade-dark rounded-lg p-4 border border-trade-card">
        <p className="text-sm text-trade-gray">No channels configured. Add channel IDs in the Telegram Channels section above.</p>
      </div>
    );
  }

  return (
    <div className="bg-trade-dark rounded-lg p-4 border border-trade-card space-y-4">
      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1">
          <label className="block text-xs text-trade-gray mb-1">Channel</label>
          <select
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
          >
            <option value="">Select channel...</option>
            {channels.map((ch: string) => (
              <option key={ch} value={ch}>{ch}</option>
            ))}
          </select>
        </div>
        <div className="w-full md:w-32">
          <label className="block text-xs text-trade-gray mb-1">Count</label>
          <input
            type="number"
            min="1"
            max="100"
            value={messageCount}
            onChange={(e) => setMessageCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={handleFetch}
            disabled={fetching || !selectedChannel}
            className="bg-yellow-500/20 text-yellow-300 border border-yellow-500 font-semibold px-6 py-2 rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {fetching ? 'Fetching...' : 'Fetch Messages'}
          </button>
        </div>
      </div>

      {/* Error */}
      {fetchError && (
        <div className="bg-trade-red/10 border border-trade-red rounded p-3 text-sm text-trade-red">
          ✗ {fetchError}
        </div>
      )}

      {/* Results */}
      {messages.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          <p className="text-xs text-trade-gray">Fetched {messages.length} messages</p>
          {messages.map((msg) => (
            <div key={msg.id} className="bg-trade-card rounded p-3 border border-trade-gray text-xs space-y-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-trade-green font-mono">#{msg.id}</span>
                {msg.isEdited && (
                  <span className="text-trade-yellow bg-trade-yellow/10 px-1.5 py-0.5 rounded">Edited</span>
                )}
                <span className="text-trade-gray ml-auto">{new Date(msg.date).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-trade-gray">Raw: </span>
                <span className="text-white font-mono">{(msg.text || '').substring(0, 150)}</span>
                {(msg.text || '').length > 150 && <span className="text-trade-gray">...</span>}
              </div>
              <div>
                <span className="text-trade-gray">Cleaned: </span>
                <span className="text-trade-blue font-mono">{stripIcons(msg.text || '').substring(0, 150)}</span>
                {stripIcons(msg.text || '').length > 150 && <span className="text-trade-gray">...</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface ConfigPanelProps {
  onSave: (config: Partial<Config>) => void;
  strategies: Strategy[];
  onStrategiesChange: () => void;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ onSave, strategies, onStrategiesChange }) => {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Nuke modal state
  const [showNukeModal, setShowNukeModal] = useState(false);
  const [nukeSuccess, setNukeSuccess] = useState<string | null>(null);
  const [nukeError, setNukeError] = useState<string | null>(null);
  
  // Telegram auth state
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [requestCodeLoading, setRequestCodeLoading] = useState(false);
  const [verifyCodeLoading, setVerifyCodeLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [operationTimeout, setOperationTimeout] = useState(false);
  const [requestCodeAbort, setRequestCodeAbort] = useState<AbortController | null>(null);
  const [verifyCodeAbort, setVerifyCodeAbort] = useState<AbortController | null>(null);

  // MT5 test connection state
  const [testingOanda, setTestingOanda] = useState(false);
  const [oandaTestResult, setOandaTestResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // Listener state
  const [listenerRunning, setListenerRunning] = useState(false);
  const [listenerLoading, setListenerLoading] = useState(false);
  const [listenerRestarting, setListenerRestarting] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchTelegramStatus();
    fetchListenerStatus();
  }, []);

  const fetchListenerStatus = async () => {
    try {
      const res = await fetchWithTimeout('/api/telegram/listener/status', {}, 5000);
      if (res.ok) {
        const data = await res.json();
        setListenerRunning(data.isRunning);
      }
    } catch (error) {
      console.error('Failed to fetch listener status:', error);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetchWithTimeout('/api/config', {}, 8000);
      const data = await res.json();
      setConfig(data);
    } catch (error) {
      console.error('Failed to fetch config:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTelegramStatus = async () => {
    try {
      const res = await fetchWithTimeout('/api/telegram/status', {}, 8000);
      if (res.ok) {
        const data = await res.json();
        setTelegramStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch telegram status:', error);
    }
  };

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    try {
      await onSave(config);
      await fetchConfig();
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleNuke = async () => {
    try {
      const res = await fetch('/api/data/reset', { method: 'DELETE' });
      const data = await res.json();
      
      if (res.ok && data.success) {
        setNukeSuccess('All trades and logs cleared successfully');
        setNukeError(null);
        // Clear any displayed success/error after 3 seconds
        setTimeout(() => {
          setNukeSuccess(null);
          setNukeError(null);
        }, 3000);
      } else {
        setNukeError(data.error || 'Failed to clear data');
        setNukeSuccess(null);
      }
    } catch (error: any) {
      setNukeError(error.message || 'Failed to clear data');
      setNukeSuccess(null);
    }
  };

  const updateTelegram = (key: string, value: any) => {
    if (!config) return;
    setConfig({
      ...config,
      telegram: { ...config.telegram, [key]: value }
    });
  };

  const updateOanda = (key: string, value: any) => {
    if (!config) return;
    setConfig({
      ...config,
      oanda: { ...config.oanda, [key]: value }
    });
  };

  const handleRequestCode = async () => {
    if (!config?.telegram.phoneNumber) {
      setAuthError('Phone number is required');
      return;
    }

    setRequestCodeLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    setOperationTimeout(false);

    // Create abort controller for cancel
    const abortController = new AbortController();
    setRequestCodeAbort(abortController);

    // Set timeout warning after 12 seconds
    const timeoutWarning = setTimeout(() => {
      setOperationTimeout(true);
    }, 12000);

    try {
      const res = await fetchWithTimeout('/api/telegram/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: config.telegram.phoneNumber })
      }, 20000);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to request code');
      }

      clearTimeout(timeoutWarning);
      setAuthSuccess(data.message || 'Verification code sent! Check your Telegram app.');
      setOperationTimeout(false);
      await fetchTelegramStatus();
    } catch (error: any) {
      clearTimeout(timeoutWarning);
      
      if (error.name === 'AbortError') {
        setAuthError('Request cancelled.');
      } else {
        setAuthError(error.message);
      }
    } finally {
      setRequestCodeLoading(false);
      setRequestCodeAbort(null);
    }
  };

  const handleCancelRequest = () => {
    if (requestCodeAbort) {
      requestCodeAbort.abort();
      setAuthError('Request cancelled by user.');
      setRequestCodeLoading(false);
      setOperationTimeout(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!verificationCode) {
      setAuthError('Verification code is required');
      return;
    }

    setVerifyCodeLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    setOperationTimeout(false);

    // Create abort controller for cancel
    const abortController = new AbortController();
    setVerifyCodeAbort(abortController);

    // Set timeout warning after 12 seconds
    const timeoutWarning = setTimeout(() => {
      setOperationTimeout(true);
    }, 12000);

    try {
      const res = await fetchWithTimeout('/api/telegram/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCode })
      }, 20000);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify code');
      }

      clearTimeout(timeoutWarning);
      setAuthSuccess(data.message || 'Telegram authentication successful!');
      setOperationTimeout(false);
      setVerificationCode('');
      await fetchTelegramStatus();
    } catch (error: any) {
      clearTimeout(timeoutWarning);
      
      if (error.name === 'AbortError') {
        setAuthError('Verification cancelled.');
      } else {
        setAuthError(error.message);
      }
    } finally {
      setVerifyCodeLoading(false);
      setVerifyCodeAbort(null);
    }
  };

  const handleCancelVerify = () => {
    if (verifyCodeAbort) {
      verifyCodeAbort.abort();
      setAuthError('Verification cancelled by user.');
      setVerifyCodeLoading(false);
      setOperationTimeout(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnectLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    try {
      const res = await fetchWithTimeout('/api/telegram/reset', {
        method: 'POST'
      }, 10000);

      if (!res.ok) {
        throw new Error('Failed to disconnect');
      }

      setAuthSuccess('Telegram disconnected');
      await fetchTelegramStatus();
    } catch (error: any) {
      setAuthError(error.message);
    } finally {
      setDisconnectLoading(false);
    }
  };

  const handleStartListener = async () => {
    setListenerLoading(true);
    setAuthError(null);
    try {
      const res = await fetchWithTimeout('/api/telegram/listener/start', {
        method: 'POST'
      }, 10000);
      const data = await res.json();
      if (res.ok) {
        setListenerRunning(true);
        setAuthSuccess('Listener started successfully!');
      } else {
        setAuthError(data.error || 'Failed to start listener');
      }
    } catch (error: any) {
      setAuthError(`Failed to start listener: ${error.message}`);
    } finally {
      setListenerLoading(false);
    }
  };

  const handleStopListener = async () => {
    setListenerLoading(true);
    try {
      const res = await fetchWithTimeout('/api/telegram/listener/stop', {
        method: 'POST'
      }, 10000);
      if (res.ok) {
        setListenerRunning(false);
        setAuthSuccess('Listener stopped');
      }
    } catch (error: any) {
      setAuthError(`Failed to stop listener: ${error.message}`);
    } finally {
      setListenerLoading(false);
    }
  };

  const handleRestartListener = async () => {
    setListenerRestarting(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      // Stop first
      await fetchWithTimeout('/api/telegram/listener/stop', {
        method: 'POST'
      }, 10000);
      
      // Small delay to ensure clean stop
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Start again
      const res = await fetchWithTimeout('/api/telegram/listener/start', {
        method: 'POST'
      }, 10000);
      
      const data = await res.json();
      if (res.ok) {
        setListenerRunning(true);
        setAuthSuccess('Listener restarted successfully!');
      } else {
        setAuthError(data.error || 'Failed to restart listener');
      }
    } catch (error: any) {
      setAuthError(`Failed to restart listener: ${error.message}`);
    } finally {
      setListenerRestarting(false);
    }
  };

  const handleTestOanda = async () => {
    setTestingOanda(true);
    setOandaTestResult(null);

    try {
      const res = await fetchWithTimeout('/api/oanda/test', {
        method: 'POST'
      }, 20000);

      const data = await res.json();
      setOandaTestResult(data);
    } catch (error: any) {
      setOandaTestResult({
        success: false,
        message: `Network error: ${error.message}`
      });
    } finally {
      setTestingOanda(false);
    }
  };

  if (loading) {
    return <div className="text-trade-gray">Loading config...</div>;
  }

  if (!config) {
    return <div className="text-trade-red">Failed to load config</div>;
  }

  const canRequestCode = config.telegram.apiId && config.telegram.apiHash && config.telegram.phoneNumber;
  const canVerifyCode = telegramStatus?.authState === 'code_sent';
  const isAuthenticated = telegramStatus?.authState === 'authenticated';
  const canTestOanda = config.oanda.accountId && config.oanda.token;

  return (
    <div className="bg-trade-dark rounded-lg p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-trade-green">Configuration</h3>
        <a
          href="/README.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-trade-green hover:underline inline-flex items-center gap-1"
        >
          <Info size={12} />
          Setup Guide
        </a>
      </div>

      {/* Auth Messages */}
      {authError && (
        <div className="bg-trade-red/10 border border-trade-red rounded-lg p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-trade-red mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-trade-red mb-1">Error</p>
              <pre className="text-xs text-trade-red whitespace-pre-wrap font-sans">{authError}</pre>
            </div>
          </div>
          {operationTimeout && (
            <div className="bg-yellow-900/20 border border-yellow-700 rounded p-2 ml-6">
              <p className="text-xs text-yellow-200">
                ⏱️ This is taking longer than expected. You can cancel and try again.
              </p>
            </div>
          )}
        </div>
      )}
      {authSuccess && (
        <div className="bg-trade-green/10 border border-trade-green rounded-lg p-3 flex items-start gap-2">
          <CheckCircle size={16} className="text-trade-green mt-0.5 flex-shrink-0" />
          <p className="text-sm text-trade-green">{authSuccess}</p>
        </div>
      )}

      {/* Telegram Config */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-trade-green text-sm font-medium">Telegram</h4>
          {telegramStatus && (
            <span className={`text-xs px-2 py-1 rounded ${
              telegramStatus.authState === 'authenticated' 
                ? 'bg-trade-green/20 text-trade-green' 
                : telegramStatus.authState === 'code_sent'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-trade-red/20 text-trade-red'
            }`}>
              {telegramStatus.authState === 'authenticated' 
                ? '✓ Authenticated' 
                : telegramStatus.authState === 'code_sent'
                ? '⏳ Code Sent'
                : '✗ Disconnected'}
            </span>
          )}
        </div>

        {/* Help Text */}
        <div className="bg-trade-card rounded p-3 border border-trade-gray">
          <p className="text-xs text-trade-gray mb-2">
            <strong className="text-white">How to authenticate:</strong>
          </p>
          <ol className="text-xs text-trade-gray space-y-1 list-decimal list-inside">
            <li>Get API credentials from <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer" className="text-trade-green hover:underline">my.telegram.org <ExternalLink size={10} className="inline" /></a></li>
            <li>Enter your phone number, API ID, and API Hash below</li>
            <li>Click "Request Code" - a verification code will be sent to Telegram</li>
            <li>Enter the code from Telegram and click "Verify Code"</li>
          </ol>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-trade-gray mb-1">Phone Number <span className="text-trade-red">*</span></label>
            <input
              type="text"
              value={config.telegram.phoneNumber}
              onChange={(e) => updateTelegram('phoneNumber', e.target.value)}
              className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
              placeholder="+1234567890"
              disabled={isAuthenticated}
            />
          </div>
          <div>
            <label className="block text-xs text-trade-gray mb-1">API ID <span className="text-trade-red">*</span></label>
            <input
              type="text"
              value={config.telegram.apiId}
              onChange={(e) => updateTelegram('apiId', e.target.value)}
              className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
              placeholder="12345678"
              disabled={isAuthenticated}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-trade-gray mb-1">API Hash <span className="text-trade-red">*</span></label>
            <input
              type="password"
              value={config.telegram.apiHash}
              onChange={(e) => updateTelegram('apiHash', e.target.value)}
              className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
              placeholder="abc123def456..."
              disabled={isAuthenticated}
            />
          </div>
        </div>

        {/* Auth Buttons */}
        {!isAuthenticated ? (
          <div className="space-y-3">
            <button
              onClick={handleRequestCode}
              disabled={!canRequestCode || requestCodeLoading}
              className="w-full bg-trade-green text-trade-black font-semibold px-4 py-2 rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {requestCodeLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Connecting to Telegram...
                </>
              ) : (
                'Request Code'
              )}
            </button>

            {requestCodeLoading && operationTimeout && (
              <button
                onClick={handleCancelRequest}
                className="w-full bg-yellow-500/20 text-yellow-300 border border-yellow-500 font-semibold px-4 py-2 rounded-lg hover:bg-yellow-500/30 transition-colors flex items-center justify-center gap-2"
              >
                Cancel Request
              </button>
            )}

            {canVerifyCode && (
              <div className="space-y-2">
                <div className="bg-yellow-500/10 border border-yellow-500 rounded p-2">
                  <p className="text-xs text-yellow-200">
                    ✓ Code sent! Check your Telegram app for a verification code.
                  </p>
                </div>
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
                  placeholder="Enter 5-digit code from Telegram"
                />
                <button
                  onClick={handleVerifyCode}
                  disabled={!verificationCode || verifyCodeLoading}
                  className="w-full bg-trade-green text-trade-black font-semibold px-4 py-2 rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {verifyCodeLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Verifying Code...
                    </>
                  ) : (
                    'Verify Code'
                  )}
                </button>

                {verifyCodeLoading && operationTimeout && (
                  <button
                    onClick={handleCancelVerify}
                    className="w-full bg-yellow-500/20 text-yellow-300 border border-yellow-500 font-semibold px-4 py-2 rounded-lg hover:bg-yellow-500/30 transition-colors flex items-center justify-center gap-2"
                  >
                    Cancel Verification
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={handleDisconnect}
            disabled={disconnectLoading}
            className="w-full bg-trade-red/20 text-trade-red border border-trade-red font-semibold px-4 py-2 rounded-lg hover:bg-trade-red/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {disconnectLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Disconnecting...
              </>
            ) : (
              'Disconnect'
            )}
          </button>
        )}

        {/* Channels */}
        <div className="mt-3">
          <label className="block text-xs text-trade-gray mb-1">Channels (comma separated)</label>
          <input
            type="text"
            value={config.telegram.channels.join(', ')}
            onChange={(e) => updateTelegram('channels', e.target.value.split(',').map((c: string) => c.trim()))}
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
            placeholder="-1001234567890, -1009876543210"
          />
          <p className="text-xs text-trade-gray mt-1">
            Tip: Forward a message from the channel to @username_to_id_bot to get the channel ID
          </p>
        </div>
      </div>

      {/* Telegram Listener Controls */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-trade-green text-sm font-medium">Telegram Listener</h4>
          <span className={`text-xs px-2 py-1 rounded ${
            listenerRunning
              ? 'bg-trade-green/20 text-trade-green'
              : 'bg-trade-red/20 text-trade-red'
          }`}>
            {listenerRunning ? '✓ Running' : '✗ Stopped'}
          </span>
        </div>

        <div className="bg-trade-card rounded p-3 border border-trade-gray">
          <p className="text-xs text-trade-gray mb-2">
            <strong className="text-white">Listener Status:</strong>
          </p>
          <p className="text-xs text-trade-gray">
            The listener monitors your Telegram channels for trading signals and automatically executes trades.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleStartListener}
            disabled={listenerRunning || listenerLoading}
            className="flex-1 bg-trade-green text-trade-black font-semibold px-4 py-2 rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {listenerLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Starting...
              </>
            ) : (
              'Start Listener'
            )}
          </button>
          <button
            onClick={handleRestartListener}
            disabled={!isAuthenticated || listenerRestarting}
            className="flex-1 bg-yellow-500/20 text-yellow-300 border border-yellow-500 font-semibold px-4 py-2 rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {listenerRestarting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Restarting...
              </>
            ) : (
              'Restart Listener'
            )}
          </button>
          <button
            onClick={handleStopListener}
            disabled={!listenerRunning || listenerLoading}
            className="flex-1 bg-trade-red/20 text-trade-red border border-trade-red font-semibold px-4 py-2 rounded-lg hover:bg-trade-red/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {listenerLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Stopping...
              </>
            ) : (
              'Stop Listener'
            )}
          </button>
        </div>
      </div>

      {/* Debug: Fetch Channel Messages */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-trade-yellow text-sm font-medium">Debug: Fetch Channel Messages</h4>
        </div>
        <FetchMessages config={config} />
      </div>

      {/* OANDA Config */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-trade-green text-sm font-medium">OANDA Connection</h4>
          {config.oanda.lastTestResult && (
            <span className={`text-xs px-2 py-1 rounded ${
              config.oanda.lastTestResult.success
                ? 'bg-trade-green/20 text-trade-green'
                : 'bg-trade-red/20 text-trade-red'
            }`}>
              {config.oanda.lastTestResult.success ? '✓ Tested' : '✗ Failed'}
            </span>
          )}
        </div>

        <div className="space-y-3">
          {/* Help Text */}
          <div className="bg-trade-card rounded p-3 border border-trade-gray">
            <p className="text-xs text-trade-gray mb-2">
              <strong className="text-white">How to setup OANDA:</strong>
            </p>
            <ol className="text-xs text-trade-gray space-y-1 list-decimal list-inside">
              <li>Create account at <a href="https://www.oanda.com" target="_blank" rel="noopener noreferrer" className="text-trade-green hover:underline">oanda.com <ExternalLink size={10} className="inline" /></a></li>
              <li>Generate API token from account settings</li>
              <li>Enter Account ID and Token below</li>
              <li>Click "Test Connection" to verify credentials</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-trade-gray mb-1">Account ID <span className="text-trade-red">*</span></label>
              <input
                type="text"
                value={config.oanda.accountId}
                onChange={(e) => updateOanda('accountId', e.target.value)}
                className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
                placeholder="5794568"
              />
            </div>
            <div>
              <label className="block text-xs text-trade-gray mb-1">API Token <span className="text-trade-red">*</span></label>
              <input
                type="password"
                value={config.oanda.token}
                onChange={(e) => updateOanda('token', e.target.value)}
                className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
                placeholder="your-api-token"
              />
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-xs text-trade-gray mb-1">Environment</label>
            <select
              value={config.oanda.environment}
              onChange={(e) => updateOanda('environment', e.target.value)}
              className="bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
            >
              <option value="practice">Practice (Demo)</option>
              <option value="live">Live (Real Money)</option>
            </select>
          </div>

          {/* Test Connection Button */}
          <button
            onClick={handleTestOanda}
            disabled={!canTestOanda || testingOanda}
            className="w-full bg-trade-green text-trade-black font-semibold px-4 py-2 rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {testingOanda ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Testing Connection...
              </>
            ) : (
              'Test Connection'
            )}
          </button>

          {/* Test Result */}
          {oandaTestResult && (
            <div className={`rounded-lg p-3 border ${
              oandaTestResult.success
                ? 'bg-trade-green/10 border-trade-green'
                : 'bg-trade-red/10 border-trade-red'
            }`}>
              <p className={`text-sm ${
                oandaTestResult.success ? 'text-trade-green' : 'text-trade-red'
              }`}>
                {oandaTestResult.success ? '✓' : '✗'} {oandaTestResult.message}
              </p>
              {config.oanda.lastTestedAt && (
                <p className="text-xs text-trade-gray mt-1">
                  Last tested: {new Date(config.oanda.lastTestedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Strategies */}
      <StrategyManager
        strategies={strategies}
        onStrategiesChange={onStrategiesChange}
      />

      {/* Danger Zone */}
      <div className="border-2 border-trade-red/50 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-5 h-5 text-trade-red" />
          <h4 className="text-trade-red font-bold">Danger Zone</h4>
        </div>
        <p className="text-trade-gray text-sm mb-3">
          Permanently delete all trading history and logs. This action cannot be undone.
        </p>
        
        {/* Success/Error Messages */}
        {nukeSuccess && (
          <div className="mb-3 p-3 bg-trade-green/10 border border-trade-green/30 rounded-lg text-trade-green text-sm">
            ✓ {nukeSuccess}
          </div>
        )}
        {nukeError && (
          <div className="mb-3 p-3 bg-trade-red/10 border border-trade-red/30 rounded-lg text-trade-red text-sm">
            ✗ {nukeError}
          </div>
        )}
        
        <button
          onClick={() => setShowNukeModal(true)}
          className="bg-trade-red text-white font-semibold px-6 py-2 rounded-lg hover:bg-trade-red/80 transition-colors"
        >
          Clear All Data
        </button>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-trade-green text-trade-black font-semibold px-6 py-2 rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Config'}
      </button>
      
      {/* Nuke Modal */}
      <NukeModal
        isOpen={showNukeModal}
        onClose={() => setShowNukeModal(false)}
        onConfirm={handleNuke}
      />
    </div>
  );
};
