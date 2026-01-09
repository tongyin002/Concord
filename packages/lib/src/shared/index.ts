// Shared exports - safe to use on both client and server

// Schema and Zero types
export {
  schema,
  zql,
  type Schema,
  type Account,
  type Doc,
  type User,
} from "./zero-schema.gen";
export * from "./schema";

// Queries and mutators
export { queries, type ZeroContext } from "./queries";
export { mutators } from "./mutators";

// Utilities
export { decodeBase64, encodeBase64 } from "./utils";

// Loro CRDT re-exports
export {
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  UndoManager,
  EphemeralStore,
  Cursor,
  isContainer,
  isContainerId,
  type Container,
  type ContainerID,
} from "loro-crdt";
