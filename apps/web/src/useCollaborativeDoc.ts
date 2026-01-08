import { useEffect, useMemo, useRef, useCallback } from "react";
import { LoroDoc } from "loro-crdt";
import { decodeBase64, encodeBase64 } from "lib/sharedUtils";
import { useQuery } from "lib/zero-client";
import { queries } from "../../../packages/lib/src/queries";
import { PresenceStore } from "./presenceStore";

interface UseCollaborativeDocOptions {
  docId: string;
}

/**
 * Sync state for coordinating between WebSocket (real-time) and Zero (persistence).
 *
 * State transitions:
 *   NEEDS_CATCHUP --(WS message)--> REALTIME_SYNCED
 *   NEEDS_CATCHUP --(Zero import)--> REALTIME_SYNCED
 *   REALTIME_SYNCED --(WS reconnect)--> NEEDS_CATCHUP
 */
type SyncSource = "needs_catchup" | "realtime_synced";

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
  // Zero Query
  // ─────────────────────────────────────────────────────────────────────────────

  const [doc] = useQuery(queries.doc.byId({ id: docId }));
  const content = doc?.content ?? null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Document & Presence Setup
  // ─────────────────────────────────────────────────────────────────────────────

  // Only create loroDoc once we have content
  const loroDoc = useMemo(() => {
    if (content === null) return null;

    const newDoc = new LoroDoc();
    newDoc.configTextStyle({
      bold: { expand: "none" },
      italic: { expand: "none" },
      underline: { expand: "none" },
    });
    newDoc.setRecordTimestamp(true);
    newDoc.import(decodeBase64(content));
    newDoc.toJSON(); // Materialize the document state
    return newDoc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, content === null]); // Recreate when docId changes or when content becomes available

  const presenceStore = useMemo(() => {
    if (!loroDoc) return null;
    return new PresenceStore(loroDoc.peerIdStr);
  }, [loroDoc?.peerIdStr]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Sync State
  // ─────────────────────────────────────────────────────────────────────────────

  const wsRef = useRef<WebSocket | null>(null);

  // Tracks whether we need to catch up from Zero's persisted state.
  // - "needs_catchup": Initial load or WS reconnected (might have missed updates)
  // - "realtime_synced": WS is delivering updates (Zero would be redundant)
  const syncSourceRef = useRef<SyncSource>("needs_catchup");

  // Tracks the last Zero content we processed to avoid re-processing on re-renders.
  const lastZeroContentRef = useRef<string | null>(content);

  // ─────────────────────────────────────────────────────────────────────────────
  // WebSocket Connection
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!loroDoc || !presenceStore) return;

    let isMounted = true;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let hasConnectedOnce = false;
    const maxReconnectAttempts = 10;

    const connect = () => {
      if (!isMounted) return;

      const ws = new WebSocket(
        `${
          import.meta.env.VITE_WS_URL ?? "ws://localhost:8787"
        }/ws?docId=${docId}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) return;
        reconnectAttempts = 0;

        if (hasConnectedOnce) {
          // Reconnection: we might have missed updates while disconnected
          syncSourceRef.current = "needs_catchup";
        }
        hasConnectedOnce = true;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "update") {
            loroDoc.import(decodeBase64(msg.data));
            // WebSocket is delivering real-time updates
            syncSourceRef.current = "realtime_synced";
          } else if (msg.type === "awareness") {
            presenceStore.apply(decodeBase64(msg.data));
          }
        } catch (e) {
          console.error("WebSocket message parse error:", e);
        }
      };

      ws.onclose = () => {
        if (!isMounted) return;
        wsRef.current = null;

        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
          reconnectAttempts++;
          reconnectTimeout = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        // onclose handles reconnection
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [docId, loroDoc, presenceStore]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Zero Sync (Persistence Layer)
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!loroDoc || content === null) return;

    // Skip if Zero hasn't pushed new content
    if (lastZeroContentRef.current === content) return;
    lastZeroContentRef.current = content;

    // Skip if we're receiving real-time updates via WebSocket
    if (syncSourceRef.current === "realtime_synced") return;

    // Import from Zero to catch up on potentially missed updates
    loroDoc.import(decodeBase64(content));
    syncSourceRef.current = "realtime_synced";
  }, [content, loroDoc]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Presence Subscription
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!presenceStore) return;

    const unsubscribe = presenceStore.subscribeLocalUpdates((update) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "awareness", data: encodeBase64(update) })
        );
      }
    });

    return () => {
      unsubscribe();
      presenceStore.destroy();
    };
  }, [presenceStore]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Send Updates
  // ─────────────────────────────────────────────────────────────────────────────

  const sendUpdate = useCallback(
    (update: Uint8Array) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "update",
            docId,
            data: encodeBase64(update),
          })
        );
      }
    },
    [docId]
  );

  return { loroDoc, presenceStore, sendUpdate };
}
