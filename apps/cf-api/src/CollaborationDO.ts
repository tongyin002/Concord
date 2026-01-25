import { DurableObject } from 'cloudflare:workers';
import {
  CrdtType,
  createDB,
  createZeroDBProvider,
  decode,
  encode,
  JoinErrorCode,
  JoinRequest,
  MessageBase,
  MessageType,
  UpdateStatusCode,
} from 'lib/server';
import { decodeBase64, encodeBase64, LoroDoc, zql } from 'lib/shared';

const DOC_SAVE_INTERVAL = 15000; // 15 seconds

/**
 * Durable Object for coordinating real-time collaboration via WebSockets.
 *
 * - Accepts WebSocket connections from clients editing the same document
 * - Broadcasts updates to all connected clients
 * - Buffers updates in DO storage for durability
 * - Flushes to database every 20 seconds via alarm
 */
export class CollaborationDO extends DurableObject<CloudflareBindings> {
  private sql: SqlStorage;
  private kv: SyncKvStorage;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    if (!ctx.getWebSocketAutoResponse()) {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    this.sql = ctx.storage.sql;
    this.kv = ctx.storage.kv;

    // create doc_update table in sqlite with primary id auto generated, updates column with binary data
    this.sql.exec(`
        CREATE TABLE IF NOT EXISTS doc_update (
          id TEXT PRIMARY KEY,
          updates BLOB NOT NULL
        )
      `);
  }

  private get docId(): string {
    return this.kv.get('docId') ?? '';
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const docId = url.searchParams.get('docId');
    if (!docId) {
      return new Response('docId is required', { status: 400 });
    }

    // Ensure table exists - needed after deleteAll() if DO hasn't hibernated yet
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS doc_update (
        id TEXT PRIMARY KEY,
        updates BLOB NOT NULL
      )
    `);

    const webSocketPair = new WebSocketPair();
    const { 0: client, 1: server } = webSocketPair;
    this.kv.put('docId', docId);
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (!(message instanceof ArrayBuffer)) {
      // the only 'string' messages we accept are 'ping', 'pong'
      // which are hanlded by auto response
      return;
    }

    const bytes = new Uint8Array(message);
    const decodedMessage = decode(bytes);

    switch (decodedMessage.type) {
      case MessageType.Ack:
        break;
      case MessageType.DocUpdate:
        this.handleDocUpdate(message, ws);
        break;
      case MessageType.DocUpdateFragmentHeader:
        break;
      case MessageType.DocUpdateFragment:
        break;
      case MessageType.JoinRequest:
        this.handleJoinRequest(decodedMessage, ws);
        break;
      case MessageType.JoinResponseOk:
      case MessageType.JoinError:
      case MessageType.RoomError:
        // client side message types, do nothing
        break;
      case MessageType.Leave:
        break;
      default: {
        const exhaustiveCheck: never = decodedMessage;
        throw new Error(`Unhandled message type: ${exhaustiveCheck}`);
      }
    }
  }

  private isCorrectRoomId(message: MessageBase): boolean {
    return this.docId === message.roomId;
  }

  private async handleJoinRequest(joinRequest: JoinRequest, ws: WebSocket) {
    if (!this.isCorrectRoomId(joinRequest)) {
      ws.send(
        encode({
          type: MessageType.JoinError,
          code: JoinErrorCode.Unknown,
          message: 'Invalid room id',
          roomId: joinRequest.roomId,
          crdt: joinRequest.crdt,
        })
      );
      return;
    }

    switch (joinRequest.crdt) {
      case CrdtType.Loro:
        return this.handleJoinLoroDoc(joinRequest, ws);
      case CrdtType.LoroEphemeralStore:
        return this.handleJoinLoroEphemeralDoc(joinRequest, ws);
      default:
        ws.send(
          encode({
            type: MessageType.JoinError,
            code: JoinErrorCode.Unknown,
            message: 'CRDT type not supported',
            crdt: joinRequest.crdt,
            roomId: joinRequest.roomId,
          })
        );
        return;
    }
  }

  private async handleJoinLoroDoc(joinRequest: JoinRequest, ws: WebSocket) {
    ws.send(
      encode({
        type: MessageType.JoinResponseOk,
        permission: 'write',
        roomId: joinRequest.roomId,
        crdt: joinRequest.crdt,
        version: joinRequest.version,
      })
    );

    const rows = this.sql
      .exec<{ updates: ArrayBuffer }>(
        `
      SELECT updates FROM doc_update
    `
      )
      .toArray();

    rows.forEach(({ updates }) => {
      ws.send(updates);
    });
  }

  private async handleJoinLoroEphemeralDoc(joinRequest: JoinRequest, ws: WebSocket) {
    ws.send(
      encode({
        type: MessageType.JoinResponseOk,
        permission: 'write',
        roomId: joinRequest.roomId,
        crdt: joinRequest.crdt,
        version: joinRequest.version,
      })
    );
  }

  private async handleDocUpdate(encodedMessage: ArrayBuffer, givenWs: WebSocket) {
    const decodedMessage = decode(new Uint8Array(encodedMessage));
    if (decodedMessage.type !== MessageType.DocUpdate) {
      return;
    }

    if (decodedMessage.crdt === CrdtType.Loro) {
      // insert updates to table doc_update
      try {
        const bytes = new Uint8Array(encodedMessage);
        const id = crypto.randomUUID();
        this.sql.exec(`INSERT INTO doc_update (id, updates) VALUES (?, ?)`, id, bytes);
      } catch (error) {
        console.error(`SQL insert error:`, error);
      }

      const existingAlarm = await this.ctx.storage.getAlarm();
      const now = Date.now();
      // if exisintgAlarm < now, we can assume the alarm will never
      // go off, this happens in dev when code changes after setting an alarm
      if (!existingAlarm || existingAlarm < now) {
        await this.ctx.storage.setAlarm(now + DOC_SAVE_INTERVAL);
      }
    }

    this.ctx.getWebSockets().forEach((ws) => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }

      if (ws !== givenWs) {
        ws.send(encodedMessage);
      } else {
        ws.send(
          encode({
            type: MessageType.Ack,
            refId: decodedMessage.batchId,
            status: UpdateStatusCode.Ok,
            crdt: decodedMessage.crdt,
            roomId: decodedMessage.roomId,
          })
        );
      }
    });
  }

  async alarm() {
    // read updates from table doc_update
    return this.ctx.blockConcurrencyWhile(async () => {
      const rows = this.sql
        .exec<{ id: string; updates: ArrayBuffer }>(
          `
      SELECT id, updates FROM doc_update
    `
        )
        .toArray();

      if (rows.length > 0) {
        const db = createDB(this.env.HYPERDRIVE);
        const zeroDBProvider = createZeroDBProvider(db);

        await zeroDBProvider.transaction(async (tr) => {
          const doc = await tr.run(zql.doc.where('id', this.docId).one());
          if (!doc) {
            // doc not found, likely deleted
            return;
          }

          const loroDoc = new LoroDoc();
          loroDoc.configTextStyle({
            bold: { expand: 'none' },
            italic: { expand: 'none' },
            underline: { expand: 'none' },
          });
          loroDoc.import(decodeBase64(doc.content));

          rows.forEach(({ updates }) => {
            const decodedMessage = decode(new Uint8Array(updates));
            if (decodedMessage.type !== MessageType.DocUpdate) {
              return;
            }

            loroDoc.importBatch(decodedMessage.updates);
          });

          await tr.mutate.doc.update({
            id: this.docId,
            content: encodeBase64(loroDoc.export({ mode: 'snapshot' })),
          });

          this.sql.exec(`DELETE FROM doc_update`);
        });
      }
    });
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): Promise<void> {
    // If this was the last connection, flush immediately
    // Note: The closing WebSocket is still in getWebSockets() during this callback
    const remainingConnections = this.ctx.getWebSockets().filter((w) => w !== ws).length;

    if (remainingConnections === 0) {
      // Cancel any scheduled alarm and flush now
      return this.ctx.blockConcurrencyWhile(async () => {
        await this.ctx.storage.deleteAlarm();
        await this.alarm();
        await this.ctx.storage.deleteAll();
      });
    }
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.error('WebSocket error:', error);
    // Close the connection on error
    try {
      ws.close(1011, 'Internal error');
    } catch {
      // Socket might already be closed
    }
  }
}
