import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { memo, useEffect, useRef } from 'react';
import { collabCaret } from './collabCaret';
import { loroSyncAdvanced, updateLoroDocGivenTransaction } from './loroSync';
import { loroDocToPMDoc, pmSchema } from './loroToPm';
import { redo, undo, undoRedo } from './undoRedo';
import { useCollaborativeDoc } from './useCollaborativeDoc';

export interface User {
  name: string;
  color: string;
}

interface EditorProps {
  docId: string;
  user: User;
  editable?: boolean;
}

/**
 * Collaborative ProseMirror editor synchronized via Loro CRDT.
 *
 * Handles:
 * - Local edits → Loro → WebSocket → peers
 * - Remote changes → Loro → ProseMirror
 * - Presence/cursor awareness
 */
export const Editor = ({ docId, user, editable = true }: EditorProps) => {
  const { loroDoc, presenceStore, sendUpdate } = useCollaborativeDoc({ docId });
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Ref for user to avoid editor recreation if user prop changes.
  // Note: collabCaret captures this at plugin creation time.
  const userRef = useRef(user);
  userRef.current = user;

  // Update editable dynamically without recreating the editor
  useEffect(() => {
    viewRef.current?.setProps({ editable: () => editable });
  }, [editable]);

  // Create ProseMirror editor once loroDoc is ready
  useEffect(() => {
    if (!loroDoc || !presenceStore) return;

    const container = containerRef.current;
    if (!container) return;

    const state = EditorState.create({
      doc: loroDocToPMDoc(loroDoc),
      plugins: [
        keymap(baseKeymap),
        keymap({
          'Mod-b': toggleMark(pmSchema.marks.bold),
          'Mod-i': toggleMark(pmSchema.marks.italic),
          'Mod-u': toggleMark(pmSchema.marks.underline),
          'Mod-z': undo,
          'Mod-Shift-z': redo,
        }),
        collabCaret(loroDoc, presenceStore, userRef.current),
        undoRedo(loroDoc),
        loroSyncAdvanced(loroDoc, pmSchema),
      ],
    });

    const view = new EditorView(container, {
      state,
      editable: () => editable,
      dispatchTransaction(tr) {
        const updatedTr = updateLoroDocGivenTransaction(tr, loroDoc, view.state);
        view.updateState(view.state.apply(updatedTr));
      },
    });
    viewRef.current = view;

    const unsubscribe = loroDoc.subscribeLocalUpdates(sendUpdate);

    return () => {
      unsubscribe();
      view.destroy();
      viewRef.current = null;
    };
  }, [loroDoc, presenceStore, sendUpdate, editable]);

  if (!loroDoc) {
    return <div className="h-full flex items-center justify-center text-slate-400">Loading...</div>;
  }

  return <div ref={containerRef} className="h-full overflow-y-scroll" />;
};

export default memo(Editor);
