import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { LoroDoc } from 'loro-crdt';
import { loroDocToPMDoc, pmSchema } from './loroToPm';
import { loroSyncAdvanced, updateLoroDocGivenTransaction } from './loroSync';
import { collabCaret } from './collabCaret';
import { PresenceStore } from './presenceStore';
import { redo, undo, undoRedo } from './undoRedo';
import { useQuery, useZero } from 'lib/zero-client';
import { mutators } from '../../../packages/lib/src/mutators';
import { queries } from '../../../packages/lib/src/queries';

const Editor = ({
  loroDoc,
  onUpdate,
  store,
  user,
}: {
  loroDoc: LoroDoc;
  onUpdate: (update: Uint8Array) => void;
  store: PresenceStore;
  user: {
    name: string;
    color: string;
  };
}) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorContainerRef.current) return;

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
        collabCaret(loroDoc, store, user),
        undoRedo(loroDoc),
      ],
    });

    const editorView = new EditorView(editorContainerRef.current, {
      state,
      dispatchTransaction(tr) {
        const updatedTr = updateLoroDocGivenTransaction(tr, loroDoc, editorView.state);
        const newState = editorView.state.apply(updatedTr);
        editorView.updateState(newState);
      },
      plugins: [loroSyncAdvanced(loroDoc, pmSchema)],
    });
    editorRef.current = editorView;

    const unsubscribe = loroDoc.subscribeLocalUpdates(onUpdate);

    return () => {
      unsubscribe();
      editorRef.current?.destroy();
    };
  }, [loroDoc]);

  return <div ref={editorContainerRef} className="h-full overflow-y-scroll" />;
};

/** Decode a base64 string to Uint8Array */
const decodeBase64 = (base64: string): Uint8Array => {
  const byteString = atob(base64);
  const uint8Array = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  return uint8Array;
};

const encodeBase64 = (uint8Array: Uint8Array): string => {
  const byteString = String.fromCharCode(...uint8Array);
  return btoa(byteString);
};

export const EditorContainer = ({
  doc: { id, content },
  user,
}: {
  doc: {
    id: string;
    content: string;
  };
  user: { name: string; color: string };
}) => {
  const zero = useZero();
  const [operations] = useQuery(queries.docOperation.forDoc({ docId: id }));

  const importContent = useCallback((contentString: string, loroDoc: LoroDoc) => {
    loroDoc.import(decodeBase64(contentString));
  }, []);

  const [loroDoc] = useState<LoroDoc>(() => {
    const loroDoc = new LoroDoc();
    loroDoc.configTextStyle({
      bold: { expand: 'none' },
      italic: { expand: 'none' },
      underline: { expand: 'none' },
    });
    loroDoc.setRecordTimestamp(true);
    importContent(content, loroDoc);

    // Import initial operations and track their IDs
    // These are imported before the subscription exists, so we track them
    // to avoid re-importing when the useEffect runs
    if (operations.length > 0) {
      loroDoc.importBatch(operations.map((op) => decodeBase64(op.operation)));
    }

    return loroDoc;
  });

  // Import operations from the server
  useEffect(() => {
    if (operations.length === 0) return;
    loroDoc.importBatch(operations.map((op) => decodeBase64(op.operation)));
  }, [operations, loroDoc]);

  const ephemeralStore = useRef<PresenceStore>(new PresenceStore(loroDoc.peerIdStr));
  useEffect(() => {
    const unsubscribe = ephemeralStore.current.subscribeLocalUpdates((update) => {
      //loroDocFromContent.import(update);
    });

    return () => {
      unsubscribe();
      ephemeralStore.current?.destroy();
    };
  }, []);

  const onLocalUpdate = useCallback(
    (update: Uint8Array) => {
      // send over the network
      zero.mutate(
        mutators.docOperation.create({
          id: crypto.randomUUID(),
          docId: id,
          operation: encodeBase64(update),
        })
      );
    },
    [zero]
  );

  return (
    <Editor loroDoc={loroDoc} onUpdate={onLocalUpdate} store={ephemeralStore.current} user={user} />
  );
};

export default Editor;
