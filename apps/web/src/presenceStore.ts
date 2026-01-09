import { Cursor, EphemeralStore } from 'lib/shared';

export class PresenceStore extends EphemeralStore<{
  [peerId: string]: {
    anchor: Uint8Array | null;
    head: Uint8Array | null;
    user: {
      name: string;
      color: string;
    } | null;
  };
}> {
  private readonly peer: string;

  constructor(peer: string, timeout?: number) {
    super(timeout);
    this.peer = peer;
  }

  getLocal() {
    const value = this.get(this.peer);
    if (!value) return undefined;

    const { anchor, head, user } = value;
    return {
      anchor: anchor ? Cursor.decode(anchor) : null,
      head: head ? Cursor.decode(head) : null,
      user: user ?? null,
    };
  }

  setLocal(
    anchor: Cursor | null,
    head: Cursor | null,
    user: { name: string; color: string } | null
  ) {
    this.set(this.peer, {
      anchor: anchor ? anchor.encode() : null,
      head: head ? head.encode() : null,
      user: user ?? null,
    });
  }

  hasLocal() {
    return this.get(this.peer) !== undefined;
  }

  deleteLocal() {
    this.delete(this.peer);
  }

  getAll(includeLocal: boolean = false) {
    return Object.entries(this.getAllStates())
      .filter(([peerId, state]) => {
        if (!state) return false;
        return includeLocal || peerId !== this.peer;
      })
      .map(([peerId, state]) => {
        return {
          peerId,
          anchor: state?.anchor ? Cursor.decode(state.anchor) : null,
          head: state?.head ? Cursor.decode(state.head) : null,
          user: state?.user ?? null,
        };
      });
  }
}
