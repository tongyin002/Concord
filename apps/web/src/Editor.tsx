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
import { useQuery } from 'lib/zero-client';
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
  }, [loroDoc, onUpdate, user, store]);

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
  doc,
  user,
}: {
  doc: {
    id: string;
    content: string;
  };
  user: { name: string; color: string };
}) => {
  const [operations] = useQuery(queries.docOperation.forDoc({ docId: doc.id }));

  const genLoroDoc = useCallback(() => {
    const loroDoc = new LoroDoc();
    loroDoc.configTextStyle({
      bold: { expand: 'none' },
      italic: { expand: 'none' },
      underline: { expand: 'none' },
    });
    loroDoc.setRecordTimestamp(true);
    loroDoc.import(decodeBase64(doc.content));

    // Import initial operations and track their IDs
    // These are imported before the subscription exists, so we track them
    // to avoid re-importing when the useEffect runs
    if (operations.length > 0) {
      loroDoc.importBatch(operations.map((op) => decodeBase64(op.operation)));
    }

    return loroDoc;
    // oxlint-disable-next-line exhaustive-deps
  }, [doc.content]);

  const [loroDoc, setLoroDoc] = useState<LoroDoc>(genLoroDoc);
  useEffect(() => {
    setLoroDoc(genLoroDoc);
  }, [genLoroDoc]);

  const websocketRef = useRef<WebSocket>(new WebSocket(`http://localhost:8787/ws?docId=${doc.id}`));
  useEffect(() => {
    const websocket = new WebSocket(`http://localhost:8787/ws?docId=${doc.id}`);
    websocketRef.current = websocket;

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'update') {
        loroDoc.import(decodeBase64(data.data));
      } else if (data.type === 'awareness') {
        presenceStore.current?.apply(decodeBase64(data.data));
      }
    };

    return () => websocket.close();
  }, [doc.id, loroDoc]);

  const presenceStore = useRef<PresenceStore>(new PresenceStore(loroDoc.peerIdStr));
  useEffect(() => {
    const presence = presenceStore.current;
    const unsubscribe = presence.subscribeLocalUpdates((update) => {
      websocketRef.current.send(JSON.stringify({ type: 'awareness', data: encodeBase64(update) }));
    });

    return () => {
      unsubscribe();
      presence?.destroy();
    };
  }, []);

  const onLocalUpdate = useCallback((update: Uint8Array) => {
    // send over the network
    websocketRef.current.send(JSON.stringify({ type: 'update', data: encodeBase64(update) }));
  }, []);

  return (
    <Editor loroDoc={loroDoc} onUpdate={onLocalUpdate} store={presenceStore.current} user={user} />
  );
};

export default Editor;
