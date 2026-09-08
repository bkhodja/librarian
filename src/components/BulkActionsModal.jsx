import React, { useState } from 'react';
import ModalPortal from './ModalPortal';

function BulkActionsModal({ isOpen, onClose, selectedBooks, onBulkAction, allTags }) {
  const [selectedAction, setSelectedAction] = useState('');
  const [newTags, setNewTags] = useState('');
  const [selectedTagsToAdd, setSelectedTagsToAdd] = useState([]);

  if (!isOpen) return null;

  const handleActionSubmit = async () => {
    if (!selectedAction) return;

    switch (selectedAction) {
      case 'addTags':
        if (newTags || selectedTagsToAdd.length > 0) {
          const tagsToAdd = [...selectedTagsToAdd];
          if (newTags) {
            tagsToAdd.push(...newTags.split(',').map(t => t.trim()).filter(Boolean));
          }
          await onBulkAction('addTags', { tags: tagsToAdd });
        }
        break;
      case 'delete':
        if (window.confirm(`Are you sure you want to delete ${selectedBooks.length} book(s)?`)) {
          await onBulkAction('delete', {});
        }
        break;
      default:
        break;
    }

    // Reset and close
    setSelectedAction('');
    setNewTags('');
    setSelectedTagsToAdd([]);
    onClose();
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm">
        <div className="rounded-xl bg-surface ring-1 ring-hairline shadow-2xl p-5 max-w-md w-full">
          <h2 className="text-xl font-semibold mb-4">
            Bulk Actions for {selectedBooks.length} Book{selectedBooks.length !== 1 ? 's' : ''}
          </h2>
  
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-2">
                Select Action
              </label>
              <select
                className="w-full p-2 border border-hairline rounded-md"
                value={selectedAction}
                onChange={(e) => setSelectedAction(e.target.value)}
              >
                <option value="">Choose an action...</option>
                <option value="addTags">Add Tags</option>
                <option value="delete">Delete Books</option>
              </select>
            </div>
  
            {selectedAction === 'addTags' && (
              <div className="space-y-3">
                {allTags.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-ink-muted mb-2">
                      Select Existing Tags
                    </label>
                    <select
                      multiple
                      className="w-full p-2 border border-hairline rounded-md"
                      value={selectedTagsToAdd}
                      onChange={(e) => setSelectedTagsToAdd(Array.from(e.target.selectedOptions, option => option.value))}
                      style={{ minHeight: '100px' }}
                    >
                      {allTags.map(tag => (
                        <option key={tag} value={tag}>{tag}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-ink-muted mb-2">
                    Or Add New Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    className="w-full p-2 border border-hairline rounded-md"
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                    placeholder="tag1, tag2, tag3"
                  />
                </div>
              </div>
            )}
  
            {selectedAction === 'delete' && (
              <div className="bg-red-500/10 p-3 rounded-md">
                <p className="text-red-700 dark:text-red-300 text-sm">
                  ⚠️ This action cannot be undone. The selected books will be permanently removed from your library.
                </p>
              </div>
            )}
          </div>
  
          <div className="flex justify-end space-x-3 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-ink-muted border border-hairline rounded-md hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              onClick={handleActionSubmit}
              disabled={!selectedAction || (selectedAction === 'addTags' && !newTags && selectedTagsToAdd.length === 0)}
              className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply Action
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

export default BulkActionsModal;