import React, { useState } from 'react';

/**
 * A book in the library grid.
 *
 * The cover carries the identity, so the card around it is kept to a hairline
 * and the metadata below is limited to what distinguishes one book from
 * another. Status is shown only when it says something: a "searchable" badge
 * that appears on 343 of 345 books, or a progress bar reading 0% on every
 * unread book, is noise repeated hundreds of times down the page.
 */
const BookCard = ({
  book,
  isSelected,
  onSelect,
  onDoubleClick,
  onClick,
  onRemoveFromCollection,
  selectedCollection
}) => {
  const [imageError, setImageError] = useState(false);

  const progress = book.readingProgress;
  const percentage = Math.round(progress?.percentage || 0);
  const hasStarted = percentage > 0;

  const needsAttention = !book.language || book.language === 'Not scanned';
  const isScanned = book.pdf_type === 'scanned';

  const showCover = book.thumbnail_url && !imageError;

  return (
    <article
      className={`
        group relative flex flex-col cursor-pointer
        rounded-card bg-surface
        ring-1 transition-all duration-200 ease-out
        hover:-translate-y-0.5 hover:shadow-card-hover
        ${isSelected
          ? 'ring-2 ring-accent shadow-card-hover'
          : 'ring-hairline shadow-card hover:ring-hairline'}
      `}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {/* Cover */}
      <div className="relative aspect-[3/4] overflow-hidden rounded-t-card bg-surface-sunken">
        {showCover ? (
          <img
            src={book.thumbnail_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            onError={() => setImageError(true)}
            loading="lazy"
          />
        ) : (
          /* No cover: set the title as the jacket rather than showing an icon. */
          <div className="flex h-full w-full flex-col justify-between p-4 bg-gradient-to-br from-surface-sunken to-surface-hover">
            <span className="text-2xs font-medium uppercase tracking-wider text-ink-faint">
              {book.file_path?.split('.').pop()?.toUpperCase() || 'Book'}
            </span>
            <p className="line-clamp-4 text-sm font-semibold leading-snug text-ink-muted">
              {book.title || 'Untitled'}
            </p>
          </div>
        )}

        {/* Reading progress rides the bottom edge of the cover, and only once
            there is something to report. */}
        {hasStarted && (
          <div
            className="absolute inset-x-0 bottom-0 h-1 bg-black/25"
            title={`${percentage}% read`}
          >
            <div className="h-full bg-accent" style={{ width: `${percentage}%` }} />
          </div>
        )}

        {/* Flags for the two states worth interrupting for. Everything else
            lives in the detail modal. */}
        {(needsAttention || isScanned) && (
          <div className="absolute left-2 top-2 flex gap-1">
            {needsAttention && (
              <span
                className="rounded bg-amber-500/95 px-1.5 py-0.5 text-2xs font-semibold text-white shadow-sm"
                title="Not yet processed"
              >
                Unscanned
              </span>
            )}
            {isScanned && (
              <span
                className="rounded bg-black/70 px-1.5 py-0.5 text-2xs font-semibold text-white shadow-sm"
                title="Scanned images — text is not searchable"
              >
                Scan
              </span>
            )}
          </div>
        )}

        {/* Hover affordance */}
        <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-black/10 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="text-2xs font-medium text-white/90">Double-click to open</span>
        </div>

        {/* Selection */}
        {onSelect && (
          <div
            className={`absolute right-2 top-2 transition-opacity ${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onSelect(book.id, e.target.checked);
              }}
              className="h-4 w-4 cursor-pointer rounded border-white/70 bg-white/90 text-accent shadow-sm focus:ring-accent"
              aria-label={`Select ${book.title || 'book'}`}
            />
          </div>
        )}

        {/* Remove from collection */}
        {selectedCollection && onRemoveFromCollection && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm('Remove this book from the collection?')) {
                onRemoveFromCollection(book.id);
              }
            }}
            className="absolute bottom-2 right-2 rounded-full bg-black/60 p-1.5 text-white opacity-0 shadow-sm transition hover:bg-red-600 group-hover:opacity-100"
            title="Remove from collection"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Details. Fixed height so rows line up regardless of how much each
          book knows about itself. */}
      <div className="flex min-h-[4.75rem] flex-col justify-between gap-1 px-3 py-2.5">
        <h3
          className="line-clamp-2 text-[0.8125rem] font-semibold leading-snug text-ink"
          title={book.title}
        >
          {book.title || 'Untitled'}
        </h3>

        <div className="flex items-baseline justify-between gap-2">
          <p
            className={`line-clamp-1 text-xs ${book.author ? 'text-ink-muted' : 'text-ink-faint italic'}`}
            title={book.author || undefined}
          >
            {book.author || 'No author'}
          </p>
          {book.publication_year && (
            <span className="shrink-0 text-2xs tabular-nums text-ink-faint">
              {book.publication_year}
            </span>
          )}
        </div>
      </div>
    </article>
  );
};

export default BookCard;
