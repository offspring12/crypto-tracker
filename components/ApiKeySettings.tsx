import React, { useState, useEffect } from 'react';
import { X, Key, Check, AlertCircle } from 'lucide-react';

interface ApiKeySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ApiKeySettings: React.FC<ApiKeySettingsProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [tempKey, setTempKey] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('gemini_api_key');
    if (stored) {
      setApiKey(stored);
      setTempKey(stored);
    }
  }, [isOpen]);

  const handleSave = () => {
    if (tempKey.trim()) {
      localStorage.setItem('gemini_api_key', tempKey.trim());
      setApiKey(tempKey.trim());
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        onClose();
      }, 1500);
    }
  };

  const handleClear = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    setTempKey('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Key className="text-white" size={20} />
          </div>
          <h2 className="text-xl font-bold text-white">API Key Settings</h2>
        </div>

        <div className="space-y-4">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="text-blue-400 flex-shrink-0 mt-0.5" size={16} />
              <div className="text-sm text-blue-200">
                <p className="font-medium mb-1">Get your free API key:</p>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  aistudio.google.com/app/apikey
                </a>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Gemini API Key
            </label>
            <input
              type="password"
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              placeholder="Paste your API key here..."
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder-slate-500 font-mono text-sm"
            />
            <p className="text-xs text-slate-500 mt-2">
              Your API key is stored locally in your browser only. It never leaves your device.
            </p>
          </div>

          {showSuccess && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center gap-2">
              <Check className="text-emerald-400" size={16} />
              <span className="text-sm text-emerald-200">API key saved successfully!</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={!tempKey.trim()}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              Save Key
            </button>
            {apiKey && (
              <button
                onClick={handleClear}
                className="px-4 py-2.5 bg-slate-700 hover:bg-red-900/50 hover:text-red-400 text-slate-300 rounded-lg transition-colors font-medium"
              >
                Clear
              </button>
            )}
          </div>

          {apiKey && (
            <div className="text-center">
              <span className="text-xs text-emerald-400 flex items-center justify-center gap-1">
                <Check size={12} />
                API key is configured
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};