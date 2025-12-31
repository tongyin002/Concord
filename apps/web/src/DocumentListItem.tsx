import { useCallback } from 'react';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

interface DocumentListItemProps {
  doc: { id: string; title: string };
  isSelected: boolean;
  onSelect: (docId: string) => void;
  onDelete: (docId: string) => void;
}

export const DocumentListItem = ({
  doc,
  isSelected,
  onSelect,
  onDelete,
}: DocumentListItemProps) => {
  const handleSelect = useCallback(() => {
    onSelect(doc.id);
  }, [onSelect, doc.id]);
  const handleDelete = useCallback(() => {
    onDelete(doc.id);
  }, [onDelete, doc.id]);
  return (
    <div
      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all duration-150 group ${
        isSelected ? 'bg-teal-50' : 'hover:bg-slate-50'
      }`}
    >
      <button
        onClick={handleSelect}
        className={`flex-1 flex items-center gap-3 text-left transition-all duration-150 ${
          isSelected ? 'text-teal-700' : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <svg
          className={`w-4 h-4 shrink-0 ${
            isSelected ? 'text-teal-500' : 'text-slate-400 group-hover:text-slate-500'
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <span className="text-sm font-medium truncate">{doc.title || 'Untitled'}</span>
      </button>
      <DeleteConfirmDialog doc={doc} onConfirm={handleDelete} />
    </div>
  );
};
