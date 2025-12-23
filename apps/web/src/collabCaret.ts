import { LoroDoc } from 'loro-crdt';
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

function createDecorationsForPeer(
  loroDoc: LoroDoc,
  state: EditorState,
  peerId: string,
  anchor: ReturnType<typeof import('loro-crdt').Cursor.decode> | null,
  head: ReturnType<typeof import('loro-crdt').Cursor.decode> | null,
  user: { name: string; color: string } | null
): Decoration[] {
  const decorations: Decoration[] = [];

  if (!head) return decorations;

  const headCursorPos = loroDoc.getCursorPos(head);
  if (!headCursorPos) return decorations;

  const { offset } = headCursorPos;
  const path = loroDoc.getPathToContainer(head.containerId());
  if (!path) return decorations;

  let node = state.doc;
  let pos = 1;
  for (const p of path) {
    if (typeof p === 'number') {
      if (node.childCount <= p) return decorations;
      pos += Fragment.fromArray(node.children.slice(0, p)).size;
      node = node.child(p);
    }
  }

  let headPosition = pos + offset;
  // i.e. a full selection
  if (!node.isTextblock) {
    headPosition = Fragment.fromArray(node.children.slice(0, offset)).size + 1;
  }

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
        const cursorColor = user?.color ?? 'black';
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
        userDiv.insertBefore(document.createTextNode(`${user?.name ?? 'Unknown'}`), null);

        const nonbreakingSpace1 = document.createTextNode('\u2060');
        const nonbreakingSpace2 = document.createTextNode('\u2060');
        cursorContainer.insertBefore(nonbreakingSpace1, null);
        cursorContainer.insertBefore(userDiv, null);
        cursorContainer.insertBefore(nonbreakingSpace2, null);
        return cursorContainer;
      },
      { peerId }
    )
  );

  if (anchor && !isCursorEqual(anchor, head)) {
    const anchorCursorPos = loroDoc.getCursorPos(anchor);
    if (anchorCursorPos) {
      const { offset } = anchorCursorPos;
      const path = loroDoc.getPathToContainer(anchor.containerId());
      if (!path) return decorations;

      let node = state.doc;
      let pos = 1;
      for (const p of path) {
        if (typeof p === 'number') {
          if (node.childCount <= p) return decorations;
          pos += Fragment.fromArray(node.children.slice(0, p)).size;
          node = node.child(p);
        }
      }

      let anchorPosition = pos + offset;
      if (!node.isTextblock) {
        anchorPosition = Fragment.fromArray(state.doc.children.slice(0, offset)).size + 1;
      }
      const from = anchorPosition < headPosition ? anchorPosition : headPosition;
      const to = anchorPosition > headPosition ? anchorPosition : headPosition;
      const selectionColor = user?.color ?? 'black';
      decorations.push(
        Decoration.inline(
          from,
          to,
          { style: `background-color: color-mix(in srgb, ${selectionColor} 30%, transparent);` },
          { peerId }
        )
      );
    }
  }

  return decorations;
}

function getLoroCursorFromPMPosition(position: ResolvedPos, loroDoc: LoroDoc) {
  const anchorNode = position.node();
  // This is because loro sync plugin will append an additional transaction to update the doc
  // we can ignore it
  if (anchorNode.attrs['loro-id'] === 'temp:id') {
    return null;
  }

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
        return DecorationSet.create(
          state.doc,
          store
            .getAll()
            .flatMap(({ peerId, anchor, head, user }) =>
              createDecorationsForPeer(loroDoc, state, peerId, anchor, head, user)
            )
        );
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

          store.getAll().forEach(({ peerId, anchor, head, user }) => {
            if (updated.has(peerId)) {
              newDecorations.push(
                ...createDecorationsForPeer(loroDoc, newState, peerId, anchor, head, user)
              );
            }
          });

          return decorationSet.remove(decorationsToRemove).add(newState.doc, newDecorations);
        }

        if (!tr.getMeta('loro-import')) {
          const { selection } = newState;

          const anchorCursor = getLoroCursorFromPMPosition(selection.$anchor, loroDoc);
          const headCursor = getLoroCursorFromPMPosition(selection.$head, loroDoc);
          const existingStatus = store.getLocal();

          if (
            !isCursorEqual(existingStatus?.anchor, anchorCursor) ||
            !isCursorEqual(existingStatus?.head, headCursor)
          ) {
            store.setLocal(anchorCursor ?? null, headCursor ?? null, user);
          }
          anchorCursor?.free();
          headCursor?.free();
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

            timeoutId = setTimeout(() => {
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
