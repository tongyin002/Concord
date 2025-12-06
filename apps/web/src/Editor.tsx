import { useEffect, useRef } from 'react';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Fragment, Node } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import 'prosemirror-view/style/prosemirror.css';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { ContainerID, LoroDoc, LoroList, LoroMap, LoroMovableList, LoroText } from 'loro-crdt';
import { LoroDocToPmDoc, pmSchema } from './loroToPm';

const pluginKey = new PluginKey('loro');

const loroDoc = new LoroDoc();
const docContainer = loroDoc.getMap('doc');
docContainer.set('type', 'doc');

// Use return values to get the actual attached containers
const paragraphsList = docContainer.setContainer('content', new LoroMovableList());

// Paragraph 1
const paragraph1 = paragraphsList.pushContainer(new LoroMap());
paragraph1.set('type', 'paragraph');
const paragraph1Content = paragraph1.setContainer('content', new LoroList());
const text1 = paragraph1Content.pushContainer(new LoroText());
text1.insert(0, 'apple orange');

// Paragraph 2
const paragraph2 = paragraphsList.pushContainer(new LoroMap());
paragraph2.set('type', 'paragraph');
const paragraph2Content = paragraph2.setContainer('content', new LoroList());
const text2 = paragraph2Content.pushContainer(new LoroText());
text2.insert(0, 'blue green');
text2.mark({ start: 1, end: 3 }, 'bold', true);
text2.mark({ start: 2, end: 4 }, 'italic', true);
text2.delete(5, 2);

// Paragraph 3
const paragraph3 = paragraphsList.pushContainer(new LoroMap());
paragraph3.set('type', 'paragraph');
const paragraph3Content = paragraph3.setContainer('content', new LoroList());
const text3 = paragraph3Content.pushContainer(new LoroText());
text3.insert(0, 'hello world');

const snapshot = loroDoc.export({ mode: 'snapshot' });

const loroDoc2 = new LoroDoc();
loroDoc2.import(snapshot);

text3.delete(0, 3);
const update = loroDoc.export({ mode: 'update' });

text3.insert(1, 'newyork');
const update2 = loroDoc.export({ mode: 'update' });

text3.mark({ start: 1, end: 3 }, 'underline', true);
text3.insert(3, 'after');
text3.delete(3, 1);
text3.delete(14, 2);
const update3 = loroDoc.export({ mode: 'update' });

function loroSync(loroDoc: LoroDoc) {
  return new Plugin({
    key: pluginKey,
    view: (view) => {
      const unsubscribe = loroDoc.subscribe(({ events, by }) => {
        if (by === 'local') return;

        if (by === 'import') {
          const { tr, doc } = view.state;
          tr.setMeta('loro-import', true);
          let from = 0;

          events.forEach(({ diff, path }) => {
            if (diff.type === 'text') {
              let targetNode = doc;
              path.forEach((p) => {
                if (p === 'doc' || p === 'content') return;
                if (typeof p === 'number') {
                  if (targetNode.inlineContent) {
                    from += 1;
                    let groupTexts: Node[][] = [];
                    for (let idx = 0; idx < targetNode.childCount; idx++) {
                      const lastChild = idx > 0 ? targetNode.child(idx - 1) : null;
                      const child = targetNode.child(idx);
                      if (child.isText) {
                        if (lastChild?.isText) {
                          groupTexts[groupTexts.length - 1].push(child);
                        } else {
                          groupTexts.push([child]);
                        }
                      } else {
                        groupTexts.push([child]);
                      }

                      if (p <= groupTexts.length - 1) {
                        from += Fragment.fromArray(groupTexts.slice(0, p).flat()).size;
                        break;
                      }
                    }
                  } else {
                    const totalSizeBefore = Fragment.fromArray(
                      targetNode.children.slice(0, p)
                    ).size;
                    from += totalSizeBefore;
                    targetNode = targetNode.child(p);
                  }
                }
              });

              let targetText = doc.nodeAt(from);
              if (!targetText?.isText) {
                throw new Error('Target node is not a text node');
              }

              console.debug(`diff`, diff);
              diff.diff.forEach((delta) => {
                if (delta.retain) {
                  Object.entries(delta.attributes ?? {}).forEach(([key, value]) => {
                    if (!(key in pmSchema.marks)) return;
                    if (typeof value !== 'boolean') return;

                    if (value) {
                      tr.addMark(from, from + delta.retain, pmSchema.mark(key));
                    } else {
                      tr.removeMark(from, from + delta.retain, pmSchema.mark(key));
                    }
                  });
                  from += delta.retain;
                } else if (delta.delete) {
                  tr.delete(from, from + delta.delete);
                } else if (delta.insert) {
                  tr.insertText(delta.insert, from);

                  if (delta.attributes) {
                    Object.entries(delta.attributes ?? {}).forEach(([key, value]) => {
                      if (!(key in pmSchema.marks)) return;
                      if (typeof value !== 'boolean') return;

                      if (value) {
                        tr.addMark(from, from + delta.insert.length, pmSchema.mark(key));
                      } else {
                        tr.removeMark(from, from + delta.insert.length, pmSchema.mark(key));
                      }
                    });
                  }
                  from += delta.insert.length;
                }
              });

              view.dispatch(tr);
            }
          });
        }
      });
      return {
        destroy: unsubscribe,
      };
    },
  });
}

const Editor = ({ loroDoc, docId }: { loroDoc: LoroDoc; docId: ContainerID }) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorContainerRef.current) return;

    const state = EditorState.create({
      doc: LoroDocToPmDoc(loroDoc, docContainer.id),
      plugins: [keymap(baseKeymap), loroSync(loroDoc)],
    });

    editorRef.current = new EditorView(editorContainerRef.current, {
      state,
    });

    return () => {
      editorRef.current?.destroy();
    };
  }, [loroDoc, docId]);

  return <div ref={editorContainerRef} className="border border-gray-300" />;
};

const EditorTestBed = () => {
  useEffect(() => {
    console.debug(`import`);
    loroDoc2.import(update);
    setTimeout(() => {
      loroDoc2.import(update2);
      setTimeout(() => {
        loroDoc2.import(update3);
      }, 1000);
    }, 1000);
  }, []);
  return (
    <>
      <Editor loroDoc={loroDoc} docId={docContainer.id} />
      <Editor loroDoc={loroDoc2} docId={docContainer.id} />
    </>
  );
};

export default EditorTestBed;
