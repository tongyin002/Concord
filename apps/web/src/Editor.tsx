import { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { LoroDoc, LoroMap, LoroMovableList, LoroText } from 'loro-crdt';
import { loroDocToPMDoc, pmSchema } from './loroToPm';
import { loroSyncAdvanced } from './loroSync';
import { collabCaret } from './collabCaret';
import { PresenceStore } from './presenceStore';

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
const docRoot = loroDoc.getMap('docRoot');
docRoot.set('type', 'doc');
const docContent = docRoot.setContainer('content', new LoroMovableList());

// p1
const p1 = docContent.pushContainer(new LoroMap());
p1.set('type', 'paragraph');
const p1Content = p1.setContainer('content', new LoroText());
p1Content.insert(0, 'apple orange');

// p2
const p2 = docContent.pushContainer(new LoroMap());
p2.set('type', 'paragraph');
const p2Content = p2.setContainer('content', new LoroText());
p2Content.insert(0, 'blue green');
p2Content.mark({ start: 1, end: 3 }, 'bold', true);
p2Content.mark({ start: 2, end: 4 }, 'italic', true);
p2Content.delete(5, 2);

// p3
const p3 = docContent.pushContainer(new LoroMap());
p3.set('type', 'paragraph');
const p3Content = p3.setContainer('content', new LoroText());
p3Content.insert(0, 'hello world');

const snapshot = loroDoc.export({ mode: 'snapshot' });

// loro doc 2
const loroDoc2 = new LoroDoc();
loroDoc2.configTextStyle({
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
loroDoc2.import(snapshot);

// p3 updates
p3Content.delete(0, 3);
const update = loroDoc.export({ mode: 'update' });
p3Content.insert(1, 'newyork');
const update2 = loroDoc.export({ mode: 'update' });
p3Content.mark({ start: 1, end: 3 }, 'underline', true);
p3Content.insert(3, 'after');
p3Content.delete(3, 1);
p3Content.delete(14, 2);
const update3 = loroDoc.export({ mode: 'update' });

// delete p3
docContent.delete(2, 1);
const update4 = loroDoc.export({ mode: 'update' });

// insert a paragrah as 2nd
const insertedParagraph = docContent.insertContainer(1, new LoroMap());
insertedParagraph.set('type', 'paragraph');
const insertedParagraphContent = insertedParagraph.setContainer('content', new LoroText());
insertedParagraphContent.insert(0, 'inserted paragraph');
const update5 = loroDoc.export({ mode: 'update' });

loroDoc2.import(update);
loroDoc2.import(update2);
loroDoc2.import(update3);
loroDoc2.import(update4);
loroDoc2.import(update5);

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
        }),
        loroSyncAdvanced(loroDoc, pmSchema),
        collabCaret(loroDoc, store, user),
      ],
    });

    editorRef.current = new EditorView(editorContainerRef.current, {
      state,
    });

    const unsubscribe = loroDoc.subscribeLocalUpdates(onUpdate);

    return () => {
      unsubscribe();
      editorRef.current?.destroy();
      loroDoc.free();
    };
  }, [loroDoc]);

  return <div ref={editorContainerRef} className="border border-gray-300" />;
};

const EditorTestBed = () => {
  const onLocalUpdate = useCallback((update: Uint8Array) => {
    loroDoc2.import(update);
  }, []);

  const onLocalUpdate2 = useCallback((update: Uint8Array) => {
    loroDoc.import(update);
  }, []);

  const ephemeralStore = useRef<PresenceStore>(new PresenceStore(loroDoc.peerIdStr));
  useEffect(() => {
    const unsubscribe = ephemeralStore.current.subscribeLocalUpdates((update) => {
      ephermeralStore2.current.apply(update);
    });
    return () => {
      unsubscribe();
      ephemeralStore.current?.destroy();
    };
  }, []);
  const ephermeralStore2 = useRef<PresenceStore>(new PresenceStore(loroDoc2.peerIdStr));
  useEffect(() => {
    const unsubscribe = ephermeralStore2.current.subscribeLocalUpdates((update) => {
      ephemeralStore.current.apply(update);
    });
    return () => {
      unsubscribe();
      ephermeralStore2.current?.destroy();
    };
  }, []);

  const { user1, user2 } = useMemo(() => {
    return {
      user1: {
        name: 'User 1',
        color: '#FF0000',
      },
      user2: {
        name: 'User 2',
        color: 'green',
      },
    };
  }, []);
  return (
    <>
      <Editor
        loroDoc={loroDoc}
        onUpdate={onLocalUpdate}
        store={ephemeralStore.current}
        user={user1}
      />
      <Editor
        loroDoc={loroDoc2}
        onUpdate={onLocalUpdate2}
        store={ephermeralStore2.current}
        user={user2}
      />
    </>
  );
};

export default EditorTestBed;
