import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';

interface SetupGuideProps {
  section?: 'telegram' | 'oanda' | 'trading' | 'all';
}

export const SetupGuide: React.FC<SetupGuideProps> = ({ section = 'all' }) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    telegram: section === 'telegram' || section === 'all',
    oanda: section === 'oanda' || section === 'all',
    trading: section === 'trading' || section === 'all'
  });

  const toggleSection = (sectionName: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionName]: !prev[sectionName]
    }));
  };

  return (
    <div className="bg-trade-dark rounded-lg p-4 space-y-4">
      <h3 className="text-lg font-semibold text-trade-green">Setup Guide</h3>
      <p className="text-sm text-trade-gray">
        Follow these steps to configure your trading system. Click each section to expand.
      </p>

      {/* Telegram Setup */}
      {(section === 'telegram' || section === 'all') && (
        <div className="border border-trade-gray rounded-lg">
          <button
            onClick={() => toggleSection('telegram')}
            className="w-full flex items-center justify-between p-3 hover:bg-trade-card transition-colors"
          >
            <div className="flex items-center gap-2">
              {expandedSections.telegram ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <h4 className="font-semibold text-trade-green">1. Telegram Authentication</h4>
            </div>
          </button>
          
          {expandedSections.telegram && (
            <div className="p-4 border-t border-trade-gray space-y-3 text-sm">
              <div className="space-y-2">
                <p className="text-trade-gray">Get API credentials from Telegram:</p>
                <ol className="list-decimal list-inside space-y-2 text-trade-gray">
                  <li>
                    Go to{' '}
                    <a
                      href="https://my.telegram.org"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-trade-green hover:underline inline-flex items-center gap-1"
                    >
                      my.telegram.org <ExternalLink size={12} />
                    </a>
                  </li>
                  <li>Login with your phone number (must include country code, e.g., +1234567890)</li>
                  <li>Click on <strong className="text-white">"API development tools"</strong></li>
                  <li>Fill in the form to create a new application:
                    <ul className="list-disc list-inside ml-4 mt-1 text-xs text-trade-gray">
                      <li><strong>App title:</strong> Any name (e.g., "XAU Copy Trade")</li>
                      <li><strong>Short name:</strong> Short identifier</li>
                      <li><strong>Platform:</strong> Select "Other"</li>
                      <li><strong>Description:</strong> Optional</li>
                    </ul>
                  </li>
                  <li>After submission, you'll receive your <strong className="text-white">API ID</strong> and <strong className="text-white">API Hash</strong></li>
                  <li>Enter these in the Config panel above, along with your phone number</li>
                  <li>Click <strong className="text-trade-green">"Request Code"</strong> - a verification code will be sent to your Telegram app</li>
                  <li>Enter the code from Telegram and click <strong className="text-trade-green">"Verify Code"</strong></li>
                </ol>
              </div>
              
              <div className="bg-trade-card rounded p-3 border border-trade-gray">
                <p className="text-xs text-trade-gray mb-1"><strong className="text-white">Phone Format:</strong></p>
                <p className="text-xs text-trade-gray">Use international format: <code className="bg-trade-dark px-1 rounded">+1234567890</code></p>
                <p className="text-xs text-trade-gray mt-1">Must include the + prefix and country code</p>
              </div>

              <div className="bg-yellow-900/20 border border-yellow-700 rounded p-3">
                <p className="text-xs text-yellow-200">
                  <strong>⚠️ Important:</strong> You must complete authentication each time the server restarts. 
                  Sessions are not persisted in the current version.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* OANDA Setup */}
      {(section === 'oanda' || section === 'all') && (
        <div className="border border-trade-gray rounded-lg">
          <button
            onClick={() => toggleSection('oanda')}
            className="w-full flex items-center justify-between p-3 hover:bg-trade-card transition-colors"
          >
            <div className="flex items-center gap-2">
              {expandedSections.oanda ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <h4 className="font-semibold text-trade-green">2. OANDA Connection</h4>
            </div>
          </button>
          
          {expandedSections.oanda && (
            <div className="p-4 border-t border-trade-gray space-y-3 text-sm">
              <div className="space-y-2">
                <p className="text-trade-gray">Set up OANDA cloud connection:</p>
                <ol className="list-decimal list-inside space-y-2 text-trade-gray">
                  <li>
                    Create an account at{' '}
                    <a
                      href="https://www.oanda.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-trade-green hover:underline inline-flex items-center gap-1"
                    >
                      oanda.com <ExternalLink size={12} />
                    </a>
                  </li>
                  <li>Generate API token from account settings</li>
                  <li>Enter your OANDA credentials:
                    <ul className="list-disc list-inside ml-4 mt-1 text-xs text-trade-gray">
                      <li><strong>Account ID:</strong> Your OANDA account number</li>
                      <li><strong>Token:</strong> Your API access token</li>
                      <li><strong>Environment:</strong> Practice (demo) or Live (real money)</li>
                    </ul>
                  </li>
                  <li>Click <strong className="text-trade-green">"Test Connection"</strong> to verify credentials</li>
                </ol>
              </div>

              <div className="bg-trade-card rounded p-3 border border-trade-gray">
                <p className="text-xs text-trade-gray mb-1"><strong className="text-white">Where to find credentials:</strong></p>
                <p className="text-xs text-trade-gray"><strong>Account ID:</strong> OANDA dashboard → Account settings</p>
                <p className="text-xs text-trade-gray mt-1"><strong>Token:</strong> OANDA dashboard → API Access → Generate Token</p>
              </div>

              <div className="bg-green-900/20 border border-green-700 rounded p-3">
                <p className="text-xs text-green-200">
                  <strong>✅ Note:</strong> OANDA offers free demo accounts with unlimited virtual funds for testing.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trading Setup */}
      {(section === 'trading' || section === 'all') && (
        <div className="border border-trade-gray rounded-lg">
          <button
            onClick={() => toggleSection('trading')}
            className="w-full flex items-center justify-between p-3 hover:bg-trade-card transition-colors"
          >
            <div className="flex items-center gap-2">
              {expandedSections.trading ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <h4 className="font-semibold text-trade-green">3. Trading Configuration</h4>
            </div>
          </button>
          
          {expandedSections.trading && (
            <div className="p-4 border-t border-trade-gray space-y-3 text-sm">
              <div className="space-y-2">
                <p className="text-trade-gray">Configure your trading parameters:</p>
                
                <div className="space-y-3">
                  <div className="bg-trade-card rounded p-3 border border-trade-gray">
                    <p className="text-xs text-white mb-1"><strong>Lot Size</strong></p>
                    <p className="text-xs text-trade-gray">The trade volume. Default: 0.01 (minimum for most brokers)</p>
                    <p className="text-xs text-trade-gray mt-1">Increase carefully based on your risk tolerance</p>
                  </div>

                  <div className="bg-trade-card rounded p-3 border border-trade-gray">
                    <p className="text-xs text-white mb-1"><strong>Symbol</strong></p>
                    <p className="text-xs text-trade-gray">Trading symbol. Default: XAUUSD (Gold/US Dollar)</p>
                    <p className="text-xs text-trade-gray mt-1">Check your broker's symbol format (may vary, e.g., GOLD, XAUUSDc)</p>
                  </div>

                  <div className="bg-trade-card rounded p-3 border border-trade-gray">
                    <p className="text-xs text-white mb-1"><strong>Close Timeout</strong></p>
                    <p className="text-xs text-trade-gray">Minutes before auto-close if no SL/TP edit received</p>
                    <p className="text-xs text-trade-gray mt-1">Default: 3 minutes. Increase if signals take longer to update</p>
                  </div>

                  <div className="bg-trade-card rounded p-3 border border-trade-gray">
                    <p className="text-xs text-white mb-1"><strong>Telegram Channels</strong></p>
                    <p className="text-xs text-trade-gray">Channel IDs to monitor for signals (comma-separated)</p>
                    <p className="text-xs text-trade-gray mt-1">Format: <code className="bg-trade-dark px-1 rounded">-1001234567890, -1009876543210</code></p>
                    <p className="text-xs text-trade-gray mt-1">To get channel ID: Forward a message from the channel to @username_to_id_bot</p>
                  </div>
                </div>
              </div>

              <div className="bg-green-900/20 border border-green-700 rounded p-3">
                <p className="text-xs text-green-200">
                  <strong>💡 Tip:</strong> Start with small lot sizes and test with a demo account before using real money!
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
