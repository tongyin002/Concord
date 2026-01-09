import {
  AllSelection,
  Command,
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from 'prosemirror-state';
import { LoroDoc, UndoManager } from 'lib/shared';
import { getLoroCursorFromPMPosition, getPMPositionFromLoroCursor } from './collabCaret';

const pluginKey = new PluginKey<{
  undoManager: UndoManager;
}>('undo-redo');

export function undoRedo(loroDoc: LoroDoc) {
  const undoManager = new UndoManager(loroDoc, {
    maxUndoSteps: 100,
  });

  return new Plugin({
    key: pluginKey,
    state: {
      init: () => {
        return {
          undoManager,
        };
      },
      apply: (_tr, state) => {
        return state;
      },
    },
    view: (view) => {
      undoManager.setOnPush((isUndo) => {
        if (isUndo) {
          const selection = view.state.selection;
          const cursors = [];
          const anchorCursor = getLoroCursorFromPMPosition(selection.$anchor, loroDoc);
          if (anchorCursor) cursors.push(anchorCursor);
          const headCursor = getLoroCursorFromPMPosition(selection.$head, loroDoc);
          if (headCursor) cursors.push(headCursor);

          return {
            value: null,
            cursors,
          };
        }

        return {
          value: null,
          cursors: [],
        };
      });
      undoManager.setOnPop((_isUndo, { cursors }) => {
        // restore the cursors to the original position
        if (cursors.length !== 2) {
          // Free any cursors even if we can't use them
          cursors.forEach((cursor) => cursor?.free());
          return;
        }
        const [anchorCursor, headCursor] = cursors;
        const anchorPosition = getPMPositionFromLoroCursor(anchorCursor, loroDoc, view.state);
        const headPosition = getPMPositionFromLoroCursor(headCursor, loroDoc, view.state);

        // Free cursors after use to prevent memory leaks
        anchorCursor?.free();
        headCursor?.free();

        if (anchorPosition === null || headPosition === null) return;

        if (anchorPosition === 0 && headPosition === view.state.doc.nodeSize) {
          view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
          return;
        }

        const $anchorPosition = view.state.doc.resolve(anchorPosition);
        const $headPosition = view.state.doc.resolve(headPosition);
        view.dispatch(
          view.state.tr.setSelection(new TextSelection($anchorPosition, $headPosition))
        );
      });
      return {};
    },
  });
}

export const undo: Command = (state: EditorState) => {
  const undoManager = pluginKey.getState(state)?.undoManager;
  if (!undoManager) return false;
  return undoManager.undo();
};

export const redo: Command = (state: EditorState) => {
  const undoManager = pluginKey.getState(state)?.undoManager;
  if (!undoManager) return false;
  return undoManager.redo();
};
