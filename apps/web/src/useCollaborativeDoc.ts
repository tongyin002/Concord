import { useEffect, useMemo } from 'react';
import { LoroDoc } from 'lib/shared';
import { LoroAdaptor, LoroEphemeralAdaptor, LoroWebsocketClient } from 'lib/client';
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
 * - Zero persists to database every ~20s and syncs back
 * - When WebSocket is delivering updates, Zero imports are skipped (redundant)
 * - On WebSocket reconnection, one Zero import is allowed to catch up on missed updates
 */
export function useCollaborativeDoc({ docId }: UseCollaborativeDocOptions) {
  // ─────────────────────────────────────────────────────────────────────────────
  // Loro Document (memoized by docId)
  // ─────────────────────────────────────────────────────────────────────────────
  const loroDoc = useMemo(() => {
    const newDoc = new LoroDoc();
    newDoc.configTextStyle({
      bold: { expand: 'none' },
      italic: { expand: 'none' },
      underline: { expand: 'none' },
    });
    newDoc.setRecordTimestamp(true);
    return newDoc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]); // Intentionally recreate doc when docId changes

  const presenceStore = useMemo(() => {
    return new PresenceStore(loroDoc.peerIdStr);
  }, [loroDoc.peerIdStr]);

  // ─────────────────────────────────────────────────────────────────────────────
  // WebSocket Client & Room (single effect to avoid race conditions)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Create client - it auto-connects in constructor
    let wsClient: LoroWebsocketClient | null = new LoroWebsocketClient({
      url: `ws://localhost:8787/ws?docId=${docId}`,
    });

    // Join room after connection is established
    wsClient.waitConnected().then(() => {
      if (!wsClient) return;

      const ephemeralAdaptor = new LoroEphemeralAdaptor(presenceStore);
      wsClient.join({
        roomId: docId,
        crdtAdaptor: ephemeralAdaptor,
      });

      const loroAdaptor = new LoroAdaptor(loroDoc);
      wsClient.join({
        roomId: docId,
        crdtAdaptor: loroAdaptor,
      });
    });

    return () => {
      wsClient?.destroy();
      wsClient = null;
    };
  }, [docId, loroDoc, presenceStore]);

  return { loroDoc, presenceStore };
}
