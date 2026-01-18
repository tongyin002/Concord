import { useEffect, useMemo } from 'react';
import { decodeBase64, LoroDoc, queries } from 'lib/shared';
import { LoroAdaptor, LoroEphemeralAdaptor, LoroWebsocketClient, useQuery } from 'lib/client';
import { PresenceStore } from './presenceStore';

interface UseCollaborativeDocOptions {
  docId: string;
}

/**
 * Manages a collaborative document with real-time sync via WebSocket
 * and persistence sync via Zero.
 *
 * Sync strategy:
 * - WebSocket provides real-time updates between peers
 * - Zero persists to database every ~15s and syncs back
 */
export function useCollaborativeDoc({ docId }: UseCollaborativeDocOptions) {
  const [doc] = useQuery(queries.doc.byId({ id: docId }));

  // ─────────────────────────────────────────────────────────────────────────────
  // Loro Document & PresenceStore (with proper cleanup)
  // Using useState + useEffect instead of useMemo to enable proper WASM cleanup.
  // ─────────────────────────────────────────────────────────────────────────────
  const { loroDoc, presenceStore } = useMemo(() => {
    const newDoc = new LoroDoc();
    newDoc.configTextStyle({
      bold: { expand: 'none' },
      italic: { expand: 'none' },
      underline: { expand: 'none' },
    });
    newDoc.setRecordTimestamp(true);
    return { loroDoc: newDoc, presenceStore: new PresenceStore(newDoc.peerIdStr) };
    // oxlint-disable-next-line eslint-plugin-react-hooks/exhaustive-deps
  }, [docId]);

  const isValidLoroDoc = useMemo(() => {
    if (!loroDoc) return false;
    if (doc?.content) {
      loroDoc.import(decodeBase64(doc.content));
    }
    return !!loroDoc.getShallowValue()['docRoot'];
  }, [loroDoc, doc?.content]);

  // ─────────────────────────────────────────────────────────────────────────────
  // WebSocket Client & Room (single effect to avoid race conditions)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
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
  }, [docId, loroDoc, presenceStore]);

  return {
    loroDoc: isValidLoroDoc ? loroDoc : null,
    presenceStore,
  };
}
