import { DurableObject } from "cloudflare:workers";
import { createDB, createZeroDBProvider } from "lib/server";
import { mutators } from "lib/shared";

/** Storage keys for persisting state */
const STORAGE_KEYS = {
  PENDING_UPDATES: "pendingUpdates",
  DOC_ID: "docId",
} as const;

/** Maximum number of updates to buffer before forcing a flush */
const MAX_PENDING_UPDATES = 1000;

type PendingUpdate = { type: string; docId: string; data: string };

/**
 * Flushes pending CRDT updates to the database.
 * Called by the Durable Object alarm handler.
 */
async function flushUpdatesToDatabase(
  env: CloudflareBindings,
  docId: string,
  updates: string[]
): Promise<void> {
  const db = createDB(env.HYPERDRIVE);
  const zeroDBProvider = createZeroDBProvider(db);

  await zeroDBProvider.transaction(async (tr) => {
    await mutators.doc.flushUpdates.fn({
      tx: tr,
      args: { docId, updates },
      ctx: { userID: "system" },
    });
  });
}

/**
 * Durable Object for coordinating real-time collaboration via WebSockets.
 *
 * - Accepts WebSocket connections from clients editing the same document
 * - Broadcasts updates to all connected clients
 * - Buffers updates in DO storage for durability
 * - Flushes to database every 20 seconds via alarm
 */
export class CollaborationDO extends DurableObject<CloudflareBindings> {
  private async getPendingUpdates(): Promise<PendingUpdate[]> {
    return (
      (await this.ctx.storage.get<PendingUpdate[]>(
        STORAGE_KEYS.PENDING_UPDATES
      )) ?? []
    );
  }

  private async setPendingUpdates(updates: PendingUpdate[]): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEYS.PENDING_UPDATES, updates);
  }

  private async getDocId(): Promise<string | null> {
    return (await this.ctx.storage.get<string>(STORAGE_KEYS.DOC_ID)) ?? null;
  }

  private async setDocId(docId: string): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEYS.DOC_ID, docId);
  }

  private async isAlarmScheduled(): Promise<boolean> {
    return (await this.ctx.storage.getAlarm()) !== null;
  }

  async fetch(request: Request) {
    // Extract docId from the request URL
    const url = new URL(request.url);
    const requestDocId = url.searchParams.get("docId");

    if (!requestDocId) {
      return new Response("docId is required", { status: 400 });
    }

    // Initialize or validate the docId for this DO
    const existingDocId = await this.getDocId();
    if (existingDocId === null) {
      // First connection - set the docId
      await this.setDocId(requestDocId);
    } else if (existingDocId !== requestDocId) {
      // Mismatch - this should not happen if routing is correct
      console.error(
        `DocId mismatch: expected ${existingDocId}, got ${requestDocId}`
      );
      return new Response("Document ID mismatch", { status: 400 });
    }

    const webSocketPair = new WebSocketPair();
    const { 0: client, 1: server } = webSocketPair;
    this.ctx.acceptWebSocket(server);

    // Send pending updates to the new client
    const pendingUpdates = await this.getPendingUpdates();
    for (const update of pendingUpdates) {
      server.send(JSON.stringify(update));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    // Broadcast to other clients
    this.ctx.getWebSockets().forEach((activeWs) => {
      if (activeWs !== ws) {
        activeWs.send(message);
      }
    });

    // Parse the message
    let parsed: { type: string; docId?: string; data: string } | null = null;

    try {
      parsed = JSON.parse(message);
    } catch {
      // Invalid JSON, skip
      return;
    }

    if (parsed?.type === "update" && parsed.data) {
      // Validate docId if provided in message
      const expectedDocId = await this.getDocId();
      if (parsed.docId && parsed.docId !== expectedDocId) {
        console.error(
          `Rejecting update: docId mismatch (expected ${expectedDocId}, got ${parsed.docId})`
        );
        return;
      }

      // Load pending updates
      const pendingUpdates = await this.getPendingUpdates();

      // Check buffer size limit
      if (pendingUpdates.length >= MAX_PENDING_UPDATES) {
        console.warn(
          `Buffer full (${MAX_PENDING_UPDATES} updates), forcing immediate flush`
        );
        await this.alarm();
      }

      // Add and persist update
      pendingUpdates.push({
        type: parsed.type,
        docId: expectedDocId!,
        data: parsed.data,
      });
      await this.setPendingUpdates(pendingUpdates);

      // Schedule alarm if not already scheduled
      if (!(await this.isAlarmScheduled())) {
        await this.ctx.storage.setAlarm(Date.now() + 20000);
      }
    }
  }

  async alarm() {
    const pendingUpdates = await this.getPendingUpdates();
    const docId = await this.getDocId();

    if (pendingUpdates.length === 0 || !docId) {
      return;
    }

    try {
      // Flush all pending updates to the database
      await flushUpdatesToDatabase(
        this.env,
        docId,
        pendingUpdates.map((u) => u.data)
      );

      // Clear buffer after successful flush
      await this.setPendingUpdates([]);
    } catch (error) {
      console.error("Failed to flush updates:", error);
      // Reschedule to retry
      await this.ctx.storage.setAlarm(Date.now() + 20000);
    }
  }

  async webSocketClose(
    _ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): Promise<void> {
    console.log(`WebSocket closed: code=${code}, reason=${reason}`);

    // If this was the last connection, flush immediately
    const remainingConnections = this.ctx.getWebSockets().length;
    if (remainingConnections === 0) {
      // Cancel any scheduled alarm and flush now
      await this.ctx.storage.deleteAlarm();
      await this.alarm();
    }
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.error("WebSocket error:", error);
    // Close the connection on error
    try {
      ws.close(1011, "Internal error");
    } catch {
      // Socket might already be closed
    }
  }
}
