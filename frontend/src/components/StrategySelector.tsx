import React, { useEffect } from 'react';
import { Strategy } from './ConfigPanel';

const STORAGE_KEY = 'xau-selected-strategy';

interface StrategySelectorProps {
  strategies: Strategy[];
  selectedId: string;
  onChange: (id: string) => void;
}

export const StrategySelector: React.FC<StrategySelectorProps> = ({ strategies, selectedId, onChange }) => {
  // Initialize from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      // Check if stored value is still valid
      const isValid = stored === 'all' || strategies.some(s => s.id === stored);
      if (isValid && stored !== selectedId) {
        onChange(stored);
      }
    } else {
      // Default to active strategy
      const active = strategies.find(s => s.isActive);
      if (active && active.id !== selectedId) {
        onChange(active.id);
      }
    }
  }, [strategies, selectedId, onChange]);

  const handleChange = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    onChange(id);
  };

  return (
    <div className="flex items-center gap-2 mb-3">
      <label className="text-xs text-trade-gray font-medium">Strategy:</label>
      <select
        value={selectedId}
        onChange={(e) => handleChange(e.target.value)}
        className="bg-trade-card border border-trade-gray rounded px-3 py-1.5 text-sm text-white focus:border-trade-green focus:outline-none"
      >
        <option value="all">All Strategies</option>
        {strategies.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} {s.isActive ? '(LIVE)' : '(PAPER)'}
          </option>
        ))}
      </select>
    </div>
  );
};
