import React, { useState, useEffect } from 'react';

const PreferencesModal = ({ isOpen, onClose }) => {
  const [preferences, setPreferences] = useState({
    hide_adult_content: false,
    default_view_mode: 'grid',
    default_sort_by: 'date_added',
    default_sort_order: 'desc',
    books_per_page: 50
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchPreferences();
    }
  }, [isOpen]);

  const fetchPreferences = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/preferences');
      const data = await response.json();
      setPreferences(data);
    } catch (error) {
      console.error('Failed to fetch preferences:', error);
      setMessage({ type: 'error', text: 'Failed to load preferences' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('http://localhost:3001/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences)
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'Preferences saved successfully!' });
        setTimeout(() => {
          onClose();
          // Reload the page to apply new preferences
          window.location.reload();
        }, 1000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save preferences' });
      }
    } catch (error) {
      console.error('Failed to save preferences:', error);
      setMessage({ type: 'error', text: 'Failed to save preferences' });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field, value) => {
    setPreferences(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm">
      <div className="rounded-xl bg-surface ring-1 ring-hairline shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-hairline px-6 py-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-ink">
            ⚙️ Preferences
          </h2>
          <button
            onClick={onClose}
            className="text-ink-faint transition-colors hover:text-ink text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6">
          {loading ? (
            <div className="text-center py-8">
              <div className="text-ink-faint">Loading preferences...</div>
            </div>
          ) : (
            <>
              {/* Adult Content Filter */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-ink">
                  Content Filtering
                </h3>
                <div className="flex items-center justify-between p-4 bg-surface-sunken rounded-lg">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-ink-muted">
                      Hide Adult Content
                    </label>
                    <p className="text-xs text-ink-faint mt-1">
                      Books marked as adult content will be hidden from the library
                    </p>
                  </div>
                  <button
                    onClick={() => handleChange('hide_adult_content', !preferences.hide_adult_content)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      preferences.hide_adult_content ? 'bg-accent' : 'bg-surface-sunken ring-1 ring-hairline'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                        preferences.hide_adult_content ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* View Mode */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-ink">
                  Display Settings
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-surface-sunken rounded-lg">
                    <label className="text-sm font-medium text-ink-muted">
                      Default View Mode
                    </label>
                    <select
                      value={preferences.default_view_mode}
                      onChange={(e) => handleChange('default_view_mode', e.target.value)}
                      className="px-3 py-2 border border-hairline rounded-md bg-surface text-ink"
                    >
                      <option value="grid">Grid</option>
                      <option value="list">List</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-surface-sunken rounded-lg">
                    <label className="text-sm font-medium text-ink-muted">
                      Books Per Page
                    </label>
                    <select
                      value={preferences.books_per_page}
                      onChange={(e) => handleChange('books_per_page', Number(e.target.value))}
                      className="px-3 py-2 border border-hairline rounded-md bg-surface text-ink"
                    >
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="200">200</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Default Sorting */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-ink">
                  Default Sorting
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-surface-sunken rounded-lg">
                    <label className="text-sm font-medium text-ink-muted">
                      Sort By
                    </label>
                    <select
                      value={preferences.default_sort_by}
                      onChange={(e) => handleChange('default_sort_by', e.target.value)}
                      className="px-3 py-2 border border-hairline rounded-md bg-surface text-ink"
                    >
                      <option value="title">Title</option>
                      <option value="author">Author</option>
                      <option value="date_added">Date Added</option>
                      <option value="file_size">File Size</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-surface-sunken rounded-lg">
                    <label className="text-sm font-medium text-ink-muted">
                      Sort Order
                    </label>
                    <select
                      value={preferences.default_sort_order}
                      onChange={(e) => handleChange('default_sort_order', e.target.value)}
                      className="px-3 py-2 border border-hairline rounded-md bg-surface text-ink"
                    >
                      <option value="asc">Ascending (A-Z)</option>
                      <option value="desc">Descending (Z-A)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Message */}
              {message && (
                <div className={`p-4 rounded-lg ${
                  message.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-500/100/10 text-red-700 dark:text-red-300'
                }`}>
                  {message.text}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-canvas border-t border-hairline px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-ink-muted hover:bg-surface-hover rounded-md"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50"
            disabled={saving || loading}
          >
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreferencesModal;
