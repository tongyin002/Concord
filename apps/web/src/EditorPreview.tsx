import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from 'prosemirror-state';
import { loroDocToPMDoc, pmSchema } from './loroToPm';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { EditorView } from 'prosemirror-view';
import { LoroDoc } from 'loro-crdt';
import { useQuery } from 'lib/zero-client';
import { queries } from '../../../packages/lib/src/queries';
import { decodeBase64 } from 'lib/sharedUtils';
import { Dialog } from '@base-ui/react/dialog';
import { Slider } from '@base-ui/react/slider';
import { loroSyncAdvanced, updateLoroDocGivenTransaction } from './loroSync';

interface EditorPreviewProps {
  docId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const EditorPreview = ({ docId, open, onOpenChange }: EditorPreviewProps) => {
  const [docs] = useQuery(queries.doc.byId({ id: docId }));
  const loroDoc = useMemo(() => {
    if (!docs.length || !open) return null;
    const theDoc = docs[0];
    const loro = new LoroDoc();
    loro.setRecordTimestamp(true);
    loro.import(decodeBase64(theDoc.content));
    loro.toJSON();
    return loro;
    // oxlint-disable-next-line exhaustive-deps
  }, [docId, open]);

  const [sliderIndex, setSliderIndex] = useState<number>(0);
  const { timestamps, changes } = useMemo(() => {
    if (!loroDoc) return { timestamps: [] as number[], changes: new Map() };
    const changesByPeer = loroDoc.getAllChanges();
    const ts = new Set(
      Array.from(
        changesByPeer
          .values()
          .flatMap((changes) => changes.values().map((change) => change.timestamp))
      )
    );
    const result = Array.from(ts).sort((a, b) => a - b);
    return {
      timestamps: result as number[],
      changes: changesByPeer,
    };
  }, [loroDoc]);

  const getFrontiersForTimestamp = useCallback(
    (ts: number) => {
      const frontiers: Array<{ peer: `${number}`; counter: number }> = [];

      // Record the highest counter for each peer where it's change is not later than
      // our target timestamp.
      changes.forEach((changes, peer) => {
        let counter = -1;
        for (const change of changes) {
          if (change.timestamp <= ts) {
            counter = Math.max(counter, change.counter + change.length - 1);
          }
        }
        if (counter > -1) {
          frontiers.push({ counter, peer: peer as `${number}` });
        }
      });
      return frontiers;
    },
    [changes]
  );

  const currentTimestamp = timestamps[sliderIndex] ?? 0;

  useEffect(() => {
    if (!loroDoc || !currentTimestamp) return;
    const frontiers = getFrontiersForTimestamp(currentTimestamp);
    loroDoc.checkout(frontiers);
  }, [getFrontiersForTimestamp, loroDoc, currentTimestamp]);

  const editorRef = useRef<EditorView | null>(null);

  const editorContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }

      if (!node || !loroDoc) return;

      const state = EditorState.create({
        doc: loroDocToPMDoc(loroDoc),
        plugins: [keymap(baseKeymap)],
      });

      const editorView = new EditorView(node, {
        state,
        dispatchTransaction(tr) {
          const updatedTr = updateLoroDocGivenTransaction(tr, loroDoc, editorView.state);
          const newState = editorView.state.apply(updatedTr);
          editorView.updateState(newState);
        },
        plugins: [loroSyncAdvanced(loroDoc, pmSchema)],
        editable: () => false,
      });
      editorRef.current = editorView;
    },
    [loroDoc]
  );

  const handleSliderChange = useCallback((value: number | number[]) => {
    setSliderIndex(Array.isArray(value) ? value[0] : value);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity duration-200 data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Popup className="w-full max-w-2xl h-[600px] bg-white rounded-2xl p-6 shadow-xl shadow-slate-200/50 border border-slate-200 transition-all duration-200 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 flex flex-col">
            <Dialog.Title className="text-lg font-semibold text-slate-900 mb-4">
              Document History
            </Dialog.Title>

            {/* Editor container */}
            <div className="flex-1 overflow-hidden border border-slate-200 rounded-lg mb-4">
              <div ref={editorContainerRef} className="h-full overflow-y-scroll" />
            </div>

            {/* Timestamp slider */}
            {timestamps.length > 0 ? (
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-500 whitespace-nowrap">
                  {new Date(timestamps[sliderIndex] * 1000).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                <Slider.Root
                  min={0}
                  max={timestamps.length - 1}
                  step={1}
                  value={sliderIndex}
                  onValueChange={handleSliderChange}
                  className="flex-1"
                >
                  <Slider.Control className="flex items-center h-4 cursor-pointer">
                    <Slider.Track className="h-1.5 flex-1 rounded-full bg-slate-200">
                      <Slider.Indicator className="rounded-full bg-teal-600" />
                      <Slider.Thumb className="size-4 rounded-full bg-white border-2 border-teal-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2" />
                    </Slider.Track>
                  </Slider.Control>
                </Slider.Root>
              </div>
            ) : (
              <div className="text-sm text-slate-400 text-center py-4">No history available</div>
            )}

            {/* Close button */}
            <div className="flex justify-end gap-3 mt-4">
              <Dialog.Close className="px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                Close
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default EditorPreview;
