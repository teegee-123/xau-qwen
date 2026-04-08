import React from 'react';

interface StatusChipProps {
  label: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'code_sent' | 'authenticated';
  tooltip?: string;
}

const StatusChip: React.FC<StatusChipProps> = ({ label, status, tooltip }) => {
  const statusConfig = {
    disconnected: {
      color: 'bg-trade-red',
      borderColor: 'border-trade-red',
      textColor: 'text-trade-red',
      text: 'Disconnected'
    },
    connecting: {
      color: 'bg-yellow-500 status-pulse',
      borderColor: 'border-yellow-500',
      textColor: 'text-yellow-400',
      text: 'Connecting...'
    },
    connected: {
      color: 'bg-trade-green status-online',
      borderColor: 'border-trade-green',
      textColor: 'text-trade-green',
      text: 'Connected'
    },
    code_sent: {
      color: 'bg-yellow-500 status-pulse',
      borderColor: 'border-yellow-500',
      textColor: 'text-yellow-400',
      text: 'Code Sent'
    },
    authenticated: {
      color: 'bg-trade-green status-online',
      borderColor: 'border-trade-green',
      textColor: 'text-trade-green',
      text: 'Authenticated'
    }
  };

  const config = statusConfig[status];

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-trade-card border ${config.borderColor} ${
        tooltip ? 'cursor-help' : ''
      }`}
      title={tooltip || undefined}
    >
      <div className={`w-3 h-3 rounded-full ${config.color}`} />
      <span className="text-sm font-medium">{label}</span>
      <span className={`text-xs ${config.textColor}`}>
        {config.text}
      </span>
    </div>
  );
};

interface StatusChipsProps {
  telegramStatus: 'disconnected' | 'connecting' | 'connected' | 'code_sent' | 'authenticated' | boolean;
  oandaStatus: 'disconnected' | 'connecting' | 'connected' | boolean;
  listenerStatus: boolean;
  telegramTooltip?: string;
  oandaTooltip?: string;
}

export const StatusChips: React.FC<StatusChipsProps> = ({
  telegramStatus,
  oandaStatus,
  listenerStatus,
  telegramTooltip,
  oandaTooltip
}) => {
  // Convert boolean to status string for backward compatibility
  const normalizeStatus = (status: 'disconnected' | 'connecting' | 'connected' | 'code_sent' | 'authenticated' | boolean): 'disconnected' | 'connecting' | 'connected' | 'code_sent' | 'authenticated' => {
    if (typeof status === 'boolean') {
      return status ? 'connected' : 'disconnected';
    }
    return status;
  };

  return (
    <div className="flex flex-wrap gap-3 animate-fade-in">
      <StatusChip
        label="Telegram"
        status={normalizeStatus(telegramStatus)}
        tooltip={telegramTooltip}
      />
      <StatusChip
        label="OANDA"
        status={normalizeStatus(oandaStatus)}
        tooltip={oandaTooltip}
      />
      <StatusChip
        label="Listener"
        status={listenerStatus ? 'connected' : 'disconnected'}
      />
    </div>
  );
};
