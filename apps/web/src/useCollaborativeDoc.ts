import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeBase64, LoroDoc, queries } from 'lib/shared';
import {
  LoroAdaptor,
  LoroEphemeralAdaptor,
  LoroWebsocketClient,
  RoomJoinStatus,
  useQuery,
} from 'lib/client';
import { PresenceStore } from './presenceStore';

interface UseCollaborativeDocOptions {
  docId: string;
}

interface LoroDocState {
  loroDoc: LoroDoc;
  presenceStore: PresenceStore;
}

/**
 * Manages a collaborative document with real-time sync via WebSocket
 * and persistence sync via Zero.
 *
 * Sync strategy:
 * - WebSocket provides real-time updates between peers
 * - Zero persists to database every ~20s and syncs back
 * - When WebSocket is delivering updates, Zero imports are skipped (redundant)
 * - On WebSocket reconnection, imports latest doc.content from Zero to catch up on missed updates
 *   (Loro CRDT handles deduplication - already-seen ops are no-ops)
 */
export function useCollaborativeDoc({ docId }: UseCollaborativeDocOptions) {
  const [doc] = useQuery(queries.doc.byId({ id: docId }));
  const [state, setState] = useState<LoroDocState | null>(null);

  // Store latest doc.content in a ref so the catch-up callback can access it
  // without needing it in dependencies (which would cause re-renders)
  const docContentRef = useRef(doc?.content);
  docContentRef.current = doc?.content;

  // ─────────────────────────────────────────────────────────────────────────────
  // Loro Document & PresenceStore (with proper cleanup)
  // Using useState + useEffect instead of useMemo to enable proper WASM cleanup.
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!doc) {
      setState(null);
      return;
    }

    const loroDoc = new LoroDoc();
    loroDoc.configTextStyle({
      bold: { expand: 'none' },
      italic: { expand: 'none' },
      underline: { expand: 'none' },
    });
    loroDoc.setRecordTimestamp(true);
    loroDoc.import(decodeBase64(doc.content));
    loroDoc.getShallowValue();

    const presenceStore = new PresenceStore(loroDoc.peerIdStr);
    setState({ loroDoc, presenceStore });

    return () => {
      loroDoc.free();
    };
    // Only recreate when docId changes or when doc goes from undefined to defined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, doc?.content === undefined]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Catch-up import: Called when reconnected after disconnect
  // Loro CRDT automatically deduplicates - already-seen ops are no-ops
  // ─────────────────────────────────────────────────────────────────────────────
  const catchUpFromZero = useCallback(() => {
    if (!state || !docContentRef.current) return;
    state.loroDoc.import(decodeBase64(docContentRef.current));
  }, [state]);

  // ─────────────────────────────────────────────────────────────────────────────
  // WebSocket Client & Room (single effect to avoid race conditions)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state) return;
    const { loroDoc, presenceStore } = state;

    // Create client - it auto-connects in constructor
    const wsClient = new LoroWebsocketClient({
      url: `ws://localhost:8787/ws?docId=${docId}`,
    });

    const ephemeralAdaptor = new LoroEphemeralAdaptor(presenceStore);
    const loroAdaptor = new LoroAdaptor(loroDoc);

    // Track if we were previously reconnecting to trigger catch-up
    let wasReconnecting = false;

    // Join room after connection is established
    let cancelled = false;
    wsClient.waitConnected().then(() => {
      if (cancelled) return;

      wsClient.join({
        roomId: docId,
        crdtAdaptor: ephemeralAdaptor,
      });

      wsClient.join({
        roomId: docId,
        crdtAdaptor: loroAdaptor,
        onStatusChange: (status) => {
          if (status === RoomJoinStatus.Reconnecting) {
            wasReconnecting = true;
          } else if (status === RoomJoinStatus.Joined && wasReconnecting) {
            // Reconnected after being disconnected - import latest from Zero
            // Loro CRDT handles deduplication - already-seen ops are no-ops
            wasReconnecting = false;
            catchUpFromZero();
          }
        },
      });
    });

    return () => {
      cancelled = true;
      ephemeralAdaptor.destroy();
      loroAdaptor.destroy();
      wsClient.destroy();
    };
  }, [docId, state, catchUpFromZero]);

  return { loroDoc: state?.loroDoc ?? null, presenceStore: state?.presenceStore ?? null };
}
