import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Inline status, in place of window.alert.
 *
 * A native alert blocks the whole page until it is dismissed — it froze the
 * app mid-session — and it drags the user's attention to a modal for
 * information that belongs next to the control that produced it.
 */

const TONES = {
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  error: 'bg-red-500/10 text-red-700 dark:text-red-300',
  info: 'bg-accent-soft text-accent-ink',
  working: 'bg-surface-sunken text-ink-muted'
};

/**
 * Status state with the dismissal rules the app wants: a success message says
 * its piece and goes away, while a failure stays until it is acknowledged or
 * the next attempt replaces it.
 */
export function useStatus(clearAfterMs = 6000) {
  const [status, setStatus] = useState(null);
  const timer = useRef(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setStatus(null);
  }, []);

  const show = useCallback((tone, message) => {
    if (timer.current) clearTimeout(timer.current);
    setStatus({ tone, message });

    if (tone === 'success' || tone === 'info') {
      timer.current = setTimeout(() => setStatus(null), clearAfterMs);
    }
  }, [clearAfterMs]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return {
    status,
    clear,
    success: useCallback((m) => show('success', m), [show]),
    error: useCallback((m) => show('error', m), [show]),
    info: useCallback((m) => show('info', m), [show]),
    working: useCallback((m) => show('working', m), [show])
  };
}

function StatusNote({ status, onDismiss, className = '' }) {
  if (!status) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xs ${TONES[status.tone] || TONES.info} ${className}`}
    >
      {status.tone === 'working' && (
        <span className="mt-0.5 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      <span className="flex-1 whitespace-pre-line leading-snug">{status.message}</span>
      {onDismiss && status.tone === 'error' && (
        <button
          onClick={onDismiss}
          className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default StatusNote;
