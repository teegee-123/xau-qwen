import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface NukeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function NukeModal({ isOpen, onClose, onConfirm }: NukeModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const isConfirmed = confirmText.trim() === 'NUKE';

  const handleConfirm = async () => {
    if (!isConfirmed) return;
    
    setIsProcessing(true);
    try {
      await onConfirm();
      setConfirmText('');
      onClose();
    } catch (error) {
      console.error('Failed to clear data:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setConfirmText('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-trade-dark border-2 border-trade-red rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-trade-red" />
            <h2 className="text-xl font-bold text-trade-red">Danger Zone</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-trade-gray hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Warning Message */}
        <div className="mb-6 p-4 bg-trade-red/10 border border-trade-red/30 rounded-lg">
          <p className="text-trade-red font-semibold mb-2">⚠️ This action is PERMANENT and CANNOT be undone!</p>
          <p className="text-trade-gray text-sm">
            This will delete ALL trading history and logs. Your configuration and Telegram session will be preserved.
          </p>
        </div>

        {/* Confirmation Input */}
        <div className="mb-6">
          <label className="block text-trade-gray text-sm mb-2">
            Type <span className="text-trade-red font-bold">NUKE</span> to confirm:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type NUKE here..."
            className="w-full px-4 py-2 bg-trade-black border border-trade-card rounded-lg text-white placeholder-trade-gray focus:outline-none focus:border-trade-red transition-colors"
            autoFocus
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2 bg-trade-card text-trade-gray rounded-lg hover:bg-trade-gray/20 transition-colors font-medium"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isConfirmed || isProcessing}
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-all ${
              isConfirmed && !isProcessing
                ? 'bg-trade-red text-white hover:bg-trade-red/80'
                : 'bg-trade-gray/30 text-trade-gray cursor-not-allowed'
            }`}
          >
            {isProcessing ? 'Clearing...' : 'Clear All Data'}
          </button>
        </div>
      </div>
    </div>
  );
}
