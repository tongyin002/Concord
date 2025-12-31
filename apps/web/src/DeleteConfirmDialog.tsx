import { useCallback, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';

interface DeleteConfirmDialogProps {
  doc: { id: string; title: string };
  onConfirm: () => void;
}

export const DeleteConfirmDialog = ({ doc, onConfirm }: DeleteConfirmDialogProps) => {
  const [open, setOpen] = useState(false);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);
  const handleConfirm = useCallback(() => {
    onConfirm();
    setOpen(false);
  }, [onConfirm, setOpen]);
  const stopPropagation = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity duration-200 data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Popup className="w-full max-w-md bg-white rounded-2xl p-6 shadow-xl shadow-slate-200/50 border border-slate-200 transition-all duration-200 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0">
            <Dialog.Title className="text-lg font-semibold text-slate-900 mb-2">
              Delete "{doc.title || 'Untitled'}"?
            </Dialog.Title>
            <Dialog.Description className="text-sm text-slate-500 mb-6">
              This action cannot be undone. The document and all its content will be permanently
              deleted.
            </Dialog.Description>
            <div className="flex justify-end gap-3">
              <Dialog.Close
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </Dialog.Close>
              <Dialog.Close
                onClick={handleConfirm}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 transition-colors shadow-sm"
              >
                Delete
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>

      <div>
        <Dialog.Trigger
          onClick={stopPropagation}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded transition-all"
        >
          <svg
            className="w-4 h-4 text-red-400 hover:text-red-600 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </Dialog.Trigger>
      </div>
    </Dialog.Root>
  );
};
