import { Cursor, LoroDoc } from 'lib/shared';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { getLoroNodeFromPMNode } from './pmToLoro';
import { isCursorEqual, isLoroDocument, isLoroParagraph } from './loroUtils';
import { PresenceStore } from './presenceStore';
import { Fragment, ResolvedPos } from 'prosemirror-model';

type PresenceUpdateMeta = {
  updated: Set<string>;
  removed: Set<string>;
};

type DecorationSpec = {
  peerId: string;
};

const pluginKey = new PluginKey<DecorationSet>('collabCaret');

export function getPMPositionFromLoroCursor(cursor: Cursor, loroDoc: LoroDoc, state: EditorState) {
  const cursorPos = loroDoc.getCursorPos(cursor);
  if (!cursorPos) return null;

  const path = loroDoc.getPathToContainer(cursor.containerId());
  if (!path) return null;

  const { offset } = cursorPos;

  let node = state.doc;
  let pos = 1;
  for (const p of path) {
    if (typeof p === 'number') {
      if (node.childCount <= p) return null;
      pos += Fragment.fromArray(node.children.slice(0, p)).size;
      node = node.child(p);
    }
  }

  // if the node is not a textblock, we need aggregate the size of the children (because of list)
  // and add 1 for block node's beginning open tag
  return node.isTextblock
    ? pos + cursorPos.offset
    : Fragment.fromArray(node.children.slice(0, offset)).size + 1;
}

function createDecorationsForPeer(
  loroDoc: LoroDoc,
  state: EditorState,
  anchor: ReturnType<typeof Cursor.decode> | null,
  head: ReturnType<typeof Cursor.decode> | null,
  user: { peerId: string; name: string; color: string }
): Decoration[] {
  const decorations: Decoration[] = [];

  if (!head) return decorations;

  const headPosition = getPMPositionFromLoroCursor(head, loroDoc, state);
  if (headPosition === null) return decorations;

  decorations.push(
    Decoration.widget(
      headPosition,
      () => {
        const cursorContainer = document.createElement('span');
        cursorContainer.classList.add(
          'relative',
          '-mr-[1px]',
          '-ml-[1px]',
          'border-l-[1px]',
          'border-r-[1px]',
          'pointer-events-none',
          'break-normal'
        );
        const cursorColor = user.color;
        cursorContainer.style.borderColor = `color-mix(in srgb, ${cursorColor} 30%, transparent)`;

        const userDiv = document.createElement('div');
        userDiv.classList.add(
          'absolute',
          '-left-[1px]',
          '-top-[16px]',
          'text-xs',
          'pl-1',
          'pr-1',
          'whitespace-nowrap'
        );
        userDiv.style.backgroundColor = `color-mix(in srgb, ${cursorColor} 50%, white)`;
        userDiv.insertBefore(document.createTextNode(`${user.name}`), null);

        const nonbreakingSpace1 = document.createTextNode('\u2060');
        const nonbreakingSpace2 = document.createTextNode('\u2060');
        cursorContainer.insertBefore(nonbreakingSpace1, null);
        cursorContainer.insertBefore(userDiv, null);
        cursorContainer.insertBefore(nonbreakingSpace2, null);
        return cursorContainer;
      },
      { peerId: user.peerId }
    )
  );

  if (anchor && !isCursorEqual(anchor, head)) {
    const anchorPosition = getPMPositionFromLoroCursor(anchor, loroDoc, state);
    if (anchorPosition !== null) {
      const from = anchorPosition < headPosition ? anchorPosition : headPosition;
      const to = anchorPosition > headPosition ? anchorPosition : headPosition;
      const selectionColor = user?.color ?? 'black';
      decorations.push(
        Decoration.inline(
          from,
          to,
          {
            style: `background-color: color-mix(in srgb, ${selectionColor} 30%, transparent);`,
          },
          { peerId: user.peerId }
        )
      );
    }
  }

  return decorations;
}

export function getLoroCursorFromPMPosition(position: ResolvedPos, loroDoc: LoroDoc) {
  const anchorNode = position.node();

  const loroAnchor = getLoroNodeFromPMNode(loroDoc, anchorNode);
  if (loroAnchor) {
    if (isLoroParagraph(loroAnchor) || isLoroDocument(loroAnchor)) {
      const start = position.start();
      const loroCursor = loroAnchor.get('content')?.getCursor(position.pos - start);
      return loroCursor;
    }
  }
  return null;
}

export function collabCaret(
  loroDoc: LoroDoc,
  store: PresenceStore,
  user: { name: string; color: string }
) {
  return new Plugin({
    key: pluginKey,
    state: {
      init: (_config, state) => {
        const presenceData = store.getAll();
        const decorations = presenceData.flatMap(({ peerId, anchor, head, user }) =>
          createDecorationsForPeer(loroDoc, state, anchor, head, { ...user, peerId })
        );
        // Free cursors after creating decorations to prevent memory leaks
        presenceData.forEach(({ anchor, head }) => {
          anchor?.free();
          head?.free();
        });
        return DecorationSet.create(state.doc, decorations);
      },
      apply: (tr, decorationSet, _oldState, newState) => {
        const presenceUpdate = tr.getMeta('loro-presence-update') as PresenceUpdateMeta | undefined;
        if (presenceUpdate) {
          const { updated, removed } = presenceUpdate;

          // Find decorations to remove (updated or removed peers)
          const decorationsToRemove = decorationSet.find(
            undefined,
            undefined,
            ({ peerId }: DecorationSpec) => {
              return updated.has(peerId) || removed.has(peerId);
            }
          );

          // Create new decorations for updated peers
          const newDecorations: Decoration[] = [];
          const presenceData = store.getAll();

          presenceData.forEach(({ peerId, anchor, head, user }) => {
            if (updated.has(peerId)) {
              newDecorations.push(
                ...createDecorationsForPeer(loroDoc, newState, anchor, head, { ...user, peerId })
              );
            }
          });

          // Free all cursors after creating decorations to prevent memory leaks
          presenceData.forEach(({ anchor, head }) => {
            anchor?.free();
            head?.free();
          });

          return decorationSet.remove(decorationsToRemove).add(newState.doc, newDecorations);
        }

        if (!tr.getMeta('sync-loro-to-pm')) {
          const { selection } = newState;

          const anchorCursor = getLoroCursorFromPMPosition(selection.$anchor, loroDoc);
          const headCursor = getLoroCursorFromPMPosition(selection.$head, loroDoc);
          const existingStatus = store.getLocal();

          try {
            if (
              !isCursorEqual(existingStatus?.anchor, anchorCursor) ||
              !isCursorEqual(existingStatus?.head, headCursor)
            ) {
              store.setLocal(anchorCursor ?? null, headCursor ?? null, user);
            }
          } finally {
            // Free all cursors to prevent memory leaks
            // Using try/finally ensures cleanup happens regardless of control flow
            anchorCursor?.free();
            headCursor?.free();
            existingStatus?.anchor?.free();
            existingStatus?.head?.free();
          }
        }

        return decorationSet.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations: (state) => {
        return pluginKey.getState(state);
      },
    },
    view: (view) => {
      let timeoutId: number | null = null;
      let pendingChanges = {
        updated: new Set<string>(),
        removed: new Set<string>(),
      };

      const unsubscribe = store.subscribe((event) => {
        if (event.by === 'import' || event.by === 'timeout') {
          // update cursors by updating view state
          const { added, updated, removed } = event;
          if (added.length || updated.length || removed.length) {
            // Accumulate changes while waiting for the timeout
            // Both added and updated peers need decorations created
            // Later events override earlier ones (e.g., removed then added = updated)
            added.forEach((id) => {
              pendingChanges.removed.delete(id);
              pendingChanges.updated.add(id);
            });
            updated.forEach((id) => {
              pendingChanges.removed.delete(id);
              pendingChanges.updated.add(id);
            });
            removed.forEach((id) => {
              pendingChanges.updated.delete(id);
              pendingChanges.removed.add(id);
            });

            if (timeoutId) {
              return;
            }

            timeoutId = window.setTimeout(() => {
              if (view.isDestroyed) return;
              const tr = view.state.tr.setMeta('loro-presence-update', pendingChanges);
              view.dispatch(tr);
              pendingChanges = { updated: new Set(), removed: new Set() };
              timeoutId = null;
            }, 0);
          }
        }
      });

      return {
        destroy: () => {
          store.deleteLocal();
          unsubscribe();
        },
      };
    },
  });
}
