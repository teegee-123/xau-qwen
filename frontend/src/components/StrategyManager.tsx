import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Zap, X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { fetchWithTimeout } from '../utils/fetch';
import { Strategy } from './ConfigPanel';

interface StrategyManagerProps {
  strategies: Strategy[];
  onStrategiesChange: () => void;
}

export const StrategyManager: React.FC<StrategyManagerProps> = ({ strategies, onStrategiesChange }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (data: {
    name: string;
    channels: string[];
    trading: Strategy['trading'];
  }) => {
    setLoading('create');
    setError(null);
    try {
      const res = await fetchWithTimeout('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }, 10000);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create strategy');
      }

      setShowForm(false);
      onStrategiesChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleUpdate = async (id: string, data: Partial<Strategy>) => {
    setLoading(`update-${id}`);
    setError(null);
    try {
      const res = await fetchWithTimeout(`/api/strategies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }, 10000);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update strategy');
      }

      setEditingStrategy(null);
      onStrategiesChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleActivate = async (id: string) => {
    if (!confirm('This will make the selected strategy LIVE and all others PAPER. Continue?')) return;

    setLoading(`activate-${id}`);
    setError(null);
    try {
      const res = await fetchWithTimeout(`/api/strategies/${id}/activate`, {
        method: 'POST'
      }, 10000);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to activate strategy');
      }

      onStrategiesChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this strategy? Its trades will remain in history.')) return;

    setLoading(`delete-${id}`);
    setError(null);
    try {
      const res = await fetchWithTimeout(`/api/strategies/${id}`, {
        method: 'DELETE'
      }, 10000);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete strategy');
      }

      onStrategiesChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-trade-green text-sm font-medium">Strategies</h4>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1 bg-trade-green/20 text-trade-green border border-trade-green/30 px-3 py-1 rounded-lg text-xs font-semibold hover:bg-trade-green/30 transition-colors"
        >
          <Plus size={14} />
          Add Strategy
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-trade-red/10 border border-trade-red rounded p-3 text-sm text-trade-red flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <StrategyForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
          loading={loading === 'create'}
        />
      )}

      {/* Edit Form */}
      {editingStrategy && (
        <StrategyForm
          strategy={editingStrategy}
          onSubmit={(data) => handleUpdate(editingStrategy.id, data)}
          onCancel={() => setEditingStrategy(null)}
          loading={loading === `update-${editingStrategy.id}`}
        />
      )}

      {/* Strategy List */}
      <div className="space-y-2">
        {strategies.map((strat) => (
          <div
            key={strat.id}
            className="bg-trade-card rounded-lg p-4 border border-trade-gray hover:border-trade-green/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-semibold text-sm">{strat.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                    strat.isActive
                      ? 'bg-trade-green/20 text-trade-green border border-trade-green/30'
                      : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                  }`}>
                    {strat.isActive ? 'LIVE' : 'PAPER'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-trade-gray">
                  <span>Lot: <span className="text-white">{strat.trading.lotSize}</span></span>
                  <span>Symbol: <span className="text-white">{strat.trading.symbol}</span></span>
                  <span>Timeout: <span className="text-white">{strat.trading.closeTimeoutMinutes}m</span></span>
                  <span>Channels: <span className="text-white">{strat.channels.length}</span></span>
                  {strat.trading.trailingStopDistance > 0 && (
                    <span>Trailing SL: <span className="text-white">{strat.trading.trailingStopDistance}</span></span>
                  )}
                  {strat.trading.listenToReplies && (
                    <span className="text-trade-green">Listen to Replies: On</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {!strat.isActive && (
                  <button
                    onClick={() => handleActivate(strat.id)}
                    disabled={loading?.startsWith('activate')}
                    className="p-1.5 text-trade-green hover:bg-trade-green/10 rounded transition-colors"
                    title="Make LIVE"
                  >
                    <Zap size={14} />
                  </button>
                )}
                <button
                  onClick={() => setEditingStrategy(strat)}
                  disabled={loading?.startsWith('update')}
                  className="p-1.5 text-yellow-400 hover:bg-yellow-500/10 rounded transition-colors"
                  title="Edit"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => handleDelete(strat.id)}
                  disabled={loading?.startsWith('delete')}
                  className="p-1.5 text-trade-red hover:bg-trade-red/10 rounded transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {strategies.length === 0 && (
          <div className="bg-trade-card rounded-lg p-6 border border-trade-gray text-center">
            <p className="text-trade-gray text-sm">No strategies configured yet.</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-2 text-trade-green text-sm font-semibold hover:underline"
            >
              Create your first strategy
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

interface StrategyFormData {
  name: string;
  channels: string[];
  trading: Strategy['trading'];
}

interface StrategyFormProps {
  strategy?: Strategy;
  onSubmit: (data: StrategyFormData) => void;
  onCancel: () => void;
  loading: boolean;
}

const StrategyForm: React.FC<StrategyFormProps> = ({ strategy, onSubmit, onCancel, loading }) => {
  const [name, setName] = useState(strategy?.name || '');
  const [channelsStr, setChannelsStr] = useState(strategy?.channels.join(', ') || '');
  const [lotSize, setLotSize] = useState(strategy?.trading.lotSize ?? 0.01);
  const [symbol, setSymbol] = useState(strategy?.trading.symbol ?? 'XAU_USD');
  const [closeTimeoutMinutes, setCloseTimeoutMinutes] = useState(strategy?.trading.closeTimeoutMinutes ?? 3);
  const [trailingStopDistance, setTrailingStopDistance] = useState(strategy?.trading.trailingStopDistance ?? 0);
  const [listenToReplies, setListenToReplies] = useState(strategy?.trading.listenToReplies ?? false);
  const [maxRetries, setMaxRetries] = useState(strategy?.trading.maxRetries ?? 3);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSubmit({
      name: name.trim(),
      channels: channelsStr.split(',').map(c => c.trim()).filter(c => c),
      trading: {
        lotSize,
        symbol,
        closeTimeoutMinutes,
        maxRetries,
        retryDelayMs: 2000,
        trailingStopDistance,
        listenToReplies
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-trade-dark rounded-lg p-4 border border-trade-green/30 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-semibold text-trade-green">
          {strategy ? 'Edit Strategy' : 'New Strategy'}
        </h5>
        <button type="button" onClick={onCancel} className="text-trade-gray hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-trade-gray mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
            placeholder="e.g. Scalper v2"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-trade-gray mb-1">Channels (comma separated)</label>
          <input
            type="text"
            value={channelsStr}
            onChange={(e) => setChannelsStr(e.target.value)}
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
            placeholder="-1001234567890, -1009876543210"
          />
        </div>
        <div>
          <label className="block text-xs text-trade-gray mb-1">Lot Size</label>
          <input
            type="number"
            step="0.01"
            value={lotSize}
            onChange={(e) => setLotSize(parseFloat(e.target.value) || 0.01)}
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-trade-gray mb-1">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-trade-gray mb-1">Close Timeout (min)</label>
          <input
            type="number"
            value={closeTimeoutMinutes}
            onChange={(e) => setCloseTimeoutMinutes(parseInt(e.target.value) || 3)}
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-trade-gray mb-1">Trailing SL Distance (points)</label>
          <input
            type="number"
            step="0.01"
            value={trailingStopDistance}
            onChange={(e) => setTrailingStopDistance(parseFloat(e.target.value) || 0)}
            placeholder="0 = disabled"
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-trade-gray mb-1">Max Retries</label>
          <input
            type="number"
            value={maxRetries}
            onChange={(e) => setMaxRetries(parseInt(e.target.value) || 3)}
            className="w-full bg-trade-card border border-trade-gray rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={listenToReplies}
                onChange={(e) => setListenToReplies(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-6 bg-trade-gray rounded-full peer-checked:bg-trade-green peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-trade-green transition-colors"></div>
              <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
            </div>
            <div>
              <span className="text-sm text-white font-medium">Listen to Replies</span>
            </div>
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="flex items-center gap-1 bg-trade-green text-trade-black font-semibold px-4 py-2 rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {strategy ? 'Save Changes' : 'Create Strategy'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 bg-trade-card text-trade-gray border border-trade-gray px-4 py-2 rounded-lg hover:bg-trade-gray/10 transition-colors text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
