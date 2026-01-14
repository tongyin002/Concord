import { DurableObject } from 'cloudflare:workers';
import { randomBytes } from 'node:crypto';
import {
  CrdtType,
  createDB,
  createZeroDBProvider,
  decode,
  DocUpdate,
  encode,
  JoinErrorCode,
  JoinRequest,
  MessageBase,
  MessageType,
  RoomErrorCode,
  UpdateStatusCode,
} from 'lib/server';
import { decodeBase64, encodeBase64, LoroDoc, zql } from 'lib/shared';

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
    // create doc_update table in sqlite with priamry id auto generated, updates column with binary data
    this.sql.exec(`
        CREATE TABLE IF NOT EXISTS doc_update (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        this.handleDocUpdate(decodedMessage, ws);
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
    const db = createDB(this.env.HYPERDRIVE);
    const zeroDBProvider = createZeroDBProvider(db);
    const doc = await zeroDBProvider.run(zql.doc.where('id', this.docId).one());

    if (!doc) {
      ws.send(
        encode({
          type: MessageType.JoinError,
          code: JoinErrorCode.Unknown,
          message: 'Document not found',
          crdt: joinRequest.crdt,
          roomId: joinRequest.roomId,
        })
      );
      return;
    }

    let docContentBytes = decodeBase64(doc.content);
    const rows = this.sql
      .exec<{ updates: ArrayBuffer }>(
        `
      SELECT updates FROM doc_update
    `
      )
      .toArray();

    const loroDoc = new LoroDoc();
    loroDoc.configTextStyle({
      bold: { expand: 'none' },
      italic: { expand: 'none' },
      underline: { expand: 'none' },
    });
    loroDoc.setRecordTimestamp(true);
    loroDoc.import(docContentBytes);

    if (rows.length > 0) {
      loroDoc.importBatch(rows.map(({ updates }) => new Uint8Array(updates)));
      docContentBytes = loroDoc.export({ mode: 'snapshot' });
    }

    ws.send(
      encode({
        type: MessageType.JoinResponseOk,
        permission: 'write',
        roomId: joinRequest.roomId,
        crdt: joinRequest.crdt,
        version: loroDoc.version().encode(),
      })
    );

    const batchId = `0x${randomBytes(8).toString('hex')}` as const;
    ws.send(
      encode({
        type: MessageType.DocUpdate,
        crdt: joinRequest.crdt,
        roomId: joinRequest.roomId,
        updates: [docContentBytes],
        batchId,
      })
    );
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

  private async handleDocUpdate(docUpdate: DocUpdate, givenWs: WebSocket) {
    if (!this.isCorrectRoomId(docUpdate)) {
      givenWs.send(
        encode({
          type: MessageType.RoomError,
          code: RoomErrorCode.Unknown,
          message: 'Invalid room id',
          roomId: docUpdate.roomId,
          crdt: docUpdate.crdt,
        })
      );
      return;
    }

    this.ctx.getWebSockets().forEach((ws) => {
      if (ws !== givenWs) {
        ws.send(encode(docUpdate));
      } else {
        ws.send(
          encode({
            type: MessageType.Ack,
            refId: docUpdate.batchId,
            status: UpdateStatusCode.Ok,
            crdt: docUpdate.crdt,
            roomId: docUpdate.roomId,
          })
        );
      }
    });

    if (docUpdate.crdt === CrdtType.LoroEphemeralStore) {
      return;
    }

    // insert updates to table doc_update
    if (docUpdate.updates.length > 0) {
      try {
        const placeholders = docUpdate.updates.map(() => '(?)').join(', ');
        this.sql.exec(
          `INSERT INTO doc_update (updates) VALUES ${placeholders};`,
          ...docUpdate.updates
        );
      } catch (err) {
        console.error(`SQL insert error:`, err);
      }
    }

    // read updates from table doc_update
    const rows = this.ctx.storage.sql
      .exec<{ updates: ArrayBuffer }>(
        `
      SELECT updates FROM doc_update;
    `
      )
      .toArray();

    if (rows.length >= 100) {
      const db = createDB(this.env.HYPERDRIVE);
      const zeroDBProvider = createZeroDBProvider(db);

      const allUpdates = rows.map(({ updates }) => new Uint8Array(updates));
      await zeroDBProvider.transaction(async (tr) => {
        const doc = await tr.run(zql.doc.where('id', docUpdate.roomId).one());
        if (!doc) {
          throw new Error(`Doc not found: ${docUpdate.roomId}`);
        }

        const loroDoc = new LoroDoc();
        loroDoc.configTextStyle({
          bold: { expand: 'none' },
          italic: { expand: 'none' },
          underline: { expand: 'none' },
        });
        loroDoc.setRecordTimestamp(true);
        loroDoc.importBatch(allUpdates);

        await tr.mutate.doc.update({
          id: this.docId,
          content: encodeBase64(loroDoc.export({ mode: 'snapshot' })),
        });

        this.sql.exec(
          `
          DELETE FROM doc_update
        `
        );
      });
    } else {
      const alarmTime = await this.ctx.storage.getAlarm();
      if (alarmTime === null) {
        await this.ctx.storage.setAlarm(Date.now() + 1000);
      }
    }
  }

  async alarm() {
    // read updates from table doc_update

    const rows = this.sql
      .exec<{ updates: ArrayBuffer }>(
        `
      SELECT updates FROM doc_update
    `
      )
      .toArray();

    if (rows.length > 0) {
      const db = createDB(this.env.HYPERDRIVE);
      const zeroDBProvider = createZeroDBProvider(db);

      const allUpdates = rows.map(({ updates }) => new Uint8Array(updates));
      await zeroDBProvider.transaction(async (tr) => {
        const doc = await tr.run(zql.doc.where('id', this.docId).one());
        if (!doc) {
          throw new Error(`Doc not found: ${this.docId}`);
        }

        const loroDoc = new LoroDoc();
        loroDoc.configTextStyle({
          bold: { expand: 'none' },
          italic: { expand: 'none' },
          underline: { expand: 'none' },
        });
        loroDoc.setRecordTimestamp(true);
        loroDoc.importBatch(allUpdates);

        await tr.mutate.doc.update({
          id: this.docId,
          content: encodeBase64(loroDoc.export({ mode: 'snapshot' })),
        });

        this.sql.exec(
          `
          DELETE FROM doc_update
        `
        );
      });
    }
  }

  async webSocketClose(
    _ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): Promise<void> {
    // If this was the last connection, flush immediately
    const remainingConnections = this.ctx.getWebSockets().length;
    if (remainingConnections === 0) {
      // Cancel any scheduled alarm and flush now
      this.ctx.storage.deleteAlarm();
      this.alarm();
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
