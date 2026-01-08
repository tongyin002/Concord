import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { LoroDoc } from "loro-crdt";
import { loroDocToPMDoc, pmSchema } from "./loroToPm";
import { loroSyncAdvanced, updateLoroDocGivenTransaction } from "./loroSync";
import { collabCaret } from "./collabCaret";
import { PresenceStore } from "./presenceStore";
import { redo, undo, undoRedo } from "./undoRedo";
import { decodeBase64, encodeBase64 } from "lib/sharedUtils";

const Editor = ({
  loroDoc,
  onUpdate,
  store,
  user,
  editable,
}: {
  loroDoc: LoroDoc;
  onUpdate: (update: Uint8Array) => void;
  store: PresenceStore;
  user: {
    name: string;
    color: string;
  };
  editable: boolean;
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
          "Mod-b": toggleMark(pmSchema.marks.bold),
          "Mod-i": toggleMark(pmSchema.marks.italic),
          "Mod-u": toggleMark(pmSchema.marks.underline),
          "Mod-z": undo,
          "Mod-Shift-z": redo,
        }),
        collabCaret(loroDoc, store, user),
        undoRedo(loroDoc),
      ],
    });

    const editorView = new EditorView(editorContainerRef.current, {
      state,
      dispatchTransaction(tr) {
        const updatedTr = updateLoroDocGivenTransaction(
          tr,
          loroDoc,
          editorView.state
        );
        const newState = editorView.state.apply(updatedTr);
        editorView.updateState(newState);
      },
      plugins: [loroSyncAdvanced(loroDoc, pmSchema)],
      editable: () => editable,
    });
    editorRef.current = editorView;

    const unsubscribe = loroDoc.subscribeLocalUpdates(onUpdate);

    return () => {
      unsubscribe();
      editorRef.current?.destroy();
    };
  }, [loroDoc, onUpdate, user, store, editable]);

  return <div ref={editorContainerRef} className="h-full overflow-y-scroll" />;
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
  const loroDoc = useMemo(() => {
    const newLoroDoc = new LoroDoc();
    newLoroDoc.configTextStyle({
      bold: { expand: "none" },
      italic: { expand: "none" },
      underline: { expand: "none" },
    });
    newLoroDoc.setRecordTimestamp(true);
    newLoroDoc.import(decodeBase64(doc.content));
    newLoroDoc.toJSON();
    return newLoroDoc;
    // oxlint-disable-next-line exhaustive-deps
  }, [doc.id]);

  // if content is updated, import it
  useEffect(() => {
    loroDoc.import(decodeBase64(doc.content));
  }, [doc.content, loroDoc]);

  useEffect(() => {
    return () => loroDoc.free();
  }, [loroDoc]);

  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 10;

  useEffect(() => {
    let isMounted = true;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!isMounted) return;

      const websocket = new WebSocket(
        `${import.meta.env.VITE_WS_URL ?? "ws://localhost:8787"}/ws?docId=${
          doc.id
        }`
      );
      websocketRef.current = websocket;

      websocket.onopen = () => {
        if (!isMounted) return;
        reconnectAttempts.current = 0;
      };

      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "update") {
          loroDoc.import(decodeBase64(data.data));
        } else if (data.type === "awareness") {
          presenceStore.current?.apply(decodeBase64(data.data));
        }
      };

      websocket.onclose = () => {
        if (!isMounted) return;
        websocketRef.current = null;

        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempts.current),
            30000
          );
          reconnectAttempts.current++;
          reconnectTimeout = setTimeout(connect, delay);
        }
      };

      websocket.onerror = () => {
        // onclose will be called after onerror, so we just let it handle reconnection
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      websocketRef.current?.close();
      websocketRef.current = null;
    };
  }, [doc.id, loroDoc]);

  const presenceStore = useRef<PresenceStore>(
    new PresenceStore(loroDoc.peerIdStr)
  );
  useEffect(() => {
    const presence = presenceStore.current;
    const unsubscribe = presence.subscribeLocalUpdates((update) => {
      const ws = websocketRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "awareness", data: encodeBase64(update) })
        );
      }
    });

    return () => {
      unsubscribe();
      presence?.destroy();
    };
  }, []);

  const onLocalUpdate = useCallback(
    (update: Uint8Array) => {
      const ws = websocketRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "update",
            docId: doc.id,
            data: encodeBase64(update),
          })
        );
      }
    },
    [doc.id]
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <Editor
          loroDoc={loroDoc}
          onUpdate={onLocalUpdate}
          store={presenceStore.current}
          user={user}
          editable
        />
      </div>
    </div>
  );
};

export default Editor;
