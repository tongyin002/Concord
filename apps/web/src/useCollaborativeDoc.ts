import { useEffect, useState } from 'react';
import { decodeBase64, LoroDoc, zql } from 'lib/shared';
import { LoroAdaptor, LoroEphemeralAdaptor, LoroWebsocketClient, useQuery } from 'lib/client';
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
 * - On WebSocket reconnection, one Zero import is allowed to catch up on missed updates
 */
export function useCollaborativeDoc({ docId }: UseCollaborativeDocOptions) {
  const [doc] = useQuery(zql.doc.where('id', docId).one());
  const [state, setState] = useState<LoroDocState | null>(null);

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
      });
    });

    return () => {
      cancelled = true;
      ephemeralAdaptor.destroy();
      loroAdaptor.destroy();
      wsClient.destroy();
    };
  }, [docId, state]);

  return { loroDoc: state?.loroDoc ?? null, presenceStore: state?.presenceStore ?? null };
}
