// Server-only exports - DO NOT import on client

// Zero server utilities
export {
  withValidation,
  type ReadonlyJSONValue,
  mustGetQuery,
  mustGetMutator,
} from '@rocicorp/zero';
export { handleQueryRequest, handleMutateRequest } from '@rocicorp/zero/server';

// Database
export { createDB, createZeroDBProvider, type DrizzleDB, type ZeroDBProvider } from './db';

// Auth
export { createAuth, type Auth } from './auth';
export { VersionVector } from 'loro-crdt';
export {
  decode,
  encode,
  MessageType,
  type JoinRequest,
  type DocUpdate,
  type JoinResponseOk,
  type JoinError,
  JoinErrorCode,
  type RoomError,
  RoomErrorCode,
  CrdtType,
  type MessageBase,
  UpdateStatusCode,
  MAX_MESSAGE_SIZE,
  type Ack,
} from 'loro-protocol';
