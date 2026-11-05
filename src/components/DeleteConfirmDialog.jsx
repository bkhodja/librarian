import { useEffect } from 'react';
import ModalPortal from './ModalPortal';

const SHOWN = 5;

/** "book", "magazine issue" or "item", by what is being deleted. */
export function describeItems(items) {
  const kinds = new Set(items.map((item) => item.kind || 'book'));
  const noun = kinds.size > 1 ? 'item' : kinds.has('magazine') ? 'magazine issue' : 'book';
  return items.length === 1 ? `this ${noun}` : `${items.length} ${noun}s`;
}

/**
 * Asks before deleting one or more books or magazine issues, and shows which.
 * A bare "Delete 12 books?" gives no chance to notice that the wrong ones are
 * selected, so the first few are listed by title and cover.
 */
function DeleteConfirmDialog({ items, busy = false, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onCancel]);

  const what = describeItems(items);
  const rest = items.length - SHOWN;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-title"
          className="w-full max-w-md rounded-xl bg-surface p-5 shadow-2xl ring-1 ring-hairline"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="delete-title" className="text-base font-semibold text-ink">
            Delete {what}?
          </h2>

          <ul className="mt-3 space-y-1.5">
            {items.slice(0, SHOWN).map((item) => (
              <li key={item.id} className="flex items-center gap-2.5">
                {item.thumbnail_path ? (
                  <img
                    src={`http://localhost:3001${item.thumbnail_path}`}
                    alt=""
                    className="h-9 w-7 shrink-0 rounded-sm object-cover ring-1 ring-hairline"
                  />
                ) : (
                  <div className="h-9 w-7 shrink-0 rounded-sm bg-surface-sunken ring-1 ring-hairline" />
                )}
                <span className="line-clamp-2 text-sm text-ink">{item.title || 'Untitled'}</span>
              </li>
            ))}
          </ul>
          {rest > 0 && (
            <p className="mt-1.5 text-xs text-ink-faint">and {rest} more</p>
          )}

          <p className="mt-4 text-sm text-ink-muted">
            The {items.length === 1 ? 'file is' : 'files are'} moved to the Trash, so you can
            still restore {items.length === 1 ? 'it' : 'them'} from there. Tags, notes, reading
            progress and collection places are removed from the library.
          </p>

          <div className="mt-5 flex justify-end gap-2">
            {/* Cancel has the focus: Enter on an unread dialog keeps the files. */}
            <button
              autoFocus
              onClick={onCancel}
              disabled={busy}
              className="rounded-md px-4 py-2 text-sm text-ink ring-1 ring-hairline transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              {busy ? 'Deleting…' : `Delete ${items.length === 1 ? '' : items.length}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

export default DeleteConfirmDialog;
