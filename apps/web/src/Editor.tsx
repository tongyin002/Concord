import { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { LoroDoc, LoroMap, LoroMovableList } from 'loro-crdt';
import { loroDocToPMDoc, pmSchema } from './loroToPm';
import { loroSyncAdvanced, updateLoroDocGivenTransaction } from './loroSync';
import { collabCaret } from './collabCaret';
import { PresenceStore } from './presenceStore';
import { redo, undo, undoRedo } from './undoRedo';

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
      loroDoc.free();
    };
  }, [loroDoc]);

  return <div ref={editorContainerRef} className="h-full overflow-y-scroll" />;
};

export const EditorContainer = ({
  content,
  user,
}: {
  content: string;
  user: { name: string; color: string };
}) => {
  const loroDocFromContent = useMemo(() => {
    const loroDoc = new LoroDoc();
    loroDoc.configTextStyle({
      bold: {
        expand: 'none',
      },
      italic: {
        expand: 'none',
      },
      underline: {
        expand: 'none',
      },
    });

    if (!content) {
      const docRoot = loroDoc.getMap('docRoot');
      docRoot.set('type', 'doc');
      const docContent = docRoot.setContainer('content', new LoroMovableList());
      const p1 = docContent.pushContainer(new LoroMap());
      p1.set('type', 'paragraph');

      console.debug(`hey loro content`);
    } else {
      // serialize base64 string to byte array
      const byteArray = atob(content);
      const uint8Array = new Uint8Array(byteArray.length);
      for (let i = 0; i < byteArray.length; i++) {
        uint8Array[i] = byteArray.charCodeAt(i);
      }
      loroDoc.import(uint8Array);
    }
    return loroDoc;
  }, [content]);

  const ephemeralStore = useRef<PresenceStore>(new PresenceStore(loroDocFromContent.peerIdStr));
  useEffect(() => {
    const unsubscribe = ephemeralStore.current.subscribeLocalUpdates((update) => {
      //loroDocFromContent.import(update);
    });

    return () => {
      unsubscribe();
      ephemeralStore.current?.destroy();
    };
  }, []);

  const onLocalUpdate = useCallback((update: Uint8Array) => {
    // send over the network
  }, []);

  return (
    <Editor
      loroDoc={loroDocFromContent}
      onUpdate={onLocalUpdate}
      store={ephemeralStore.current}
      user={user}
    />
  );
};

export default Editor;
