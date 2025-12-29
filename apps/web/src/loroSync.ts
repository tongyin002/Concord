import { EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { ContainerID, isContainer, LoroDoc, LoroMap, LoroText } from 'loro-crdt';
import { AddMarkStep, AttrStep, RemoveMarkStep, ReplaceStep } from 'prosemirror-transform';
import { getLoroNodeFromPMNode } from './pmToLoro';
import { assert, isLoroDocument, isLoroParagraph, isMovableList } from './loroUtils';
import { Fragment, Schema } from 'prosemirror-model';
import { Node } from 'prosemirror-model';
import { LORO_ID_ATTR, LORO_DEFAULT_TEMP_ID } from './loroToPm';

const pluginKey = new PluginKey<Map<ContainerID, number>>('loroSync');

/**
 * Synchronizes ProseMirror document changes to the Loro CRDT document.
 *
 * Called on every local transaction that modifies the editor content.
 * Performance is critical here since this runs on every keystroke and edit operation.
 *
 * @param tr - The ProseMirror transaction containing the document changes
 * @param loroDoc - The Loro CRDT document to sync changes to
 * @param editorOldState - The editor state before the transaction was applied
 * @returns The transaction, potentially with additional steps to assign Loro IDs to new nodes
 */
export function updateLoroDocGivenTransaction(
  tr: Transaction,
  loroDoc: LoroDoc,
  editorOldState: EditorState
) {
  if (!tr.docChanged || tr.getMeta('sync-loro-to-pm')) {
    return tr;
  }

  const stepDataByNewlyAddedLoroContainerId = new Map<
    ContainerID,
    {
      pos: number;
      stepIndex: number;
    }
  >();

  // We run the transaction in a separate "simulated" transaction to track when new ProseMirror nodes
  // are created and need Loro IDs assigned. We can't just modify and return the simulated transaction
  // because the original transaction contains important metadata (selection state, stored marks, plugin
  // meta, etc.) that must be preserved. Instead, we replay each step, detect when AttrStep is needed
  // to assign Loro IDs, and append those additional steps to the original transaction at the end.
  let simulatedTr = editorOldState.tr;
  tr.steps.forEach((step, stepIndex) => {
    const docBeforeStep = simulatedTr.doc; // Capture before applying
    simulatedTr.step(step);
    const docAfterStep = simulatedTr.doc; // Capture after applying

    if (step instanceof ReplaceStep) {
      let { from, to } = step;

      // ========== DELETION PHASE ==========
      // Walk through nodes in the deleted range and remove corresponding content from Loro
      docBeforeStep.nodesBetween(from, to, (node, pos, parent) => {
        if (pos >= from && pos + node.nodeSize <= to) {
          const loroNode = getLoroNodeFromPMNode(loroDoc, node);
          if (loroNode) {
            if (!parent) throw new Error('not possible');
            const loroParent = getLoroNodeFromPMNode(loroDoc, parent);
            assert(loroParent, isLoroDocument);

            // Use Loro's path-based lookup to find the node's index within its parent.
            // This is O(1) compared to iterating through all siblings which would be O(n).
            const path = loroDoc.getPathToContainer(loroNode.id);
            const loroIndex = path?.[path.length - 1];
            if (typeof loroIndex !== 'number') {
              throw new Error(`Could not find index for loro node: ${loroNode.id}`);
            }
            stepDataByNewlyAddedLoroContainerId.delete(loroNode.id);
            loroParent.get('content').delete(loroIndex, 1);
            return false;
          }
        } else if (pos < from) {
          const loroNode = getLoroNodeFromPMNode(loroDoc, node);
          if (loroNode && isLoroParagraph(loroNode)) {
            const cutStart = from - pos - 1; // -1 to account for block node opening tag
            const cutLength = Math.min(node.content.size - cutStart, to - from);
            loroNode.get('content')?.delete(cutStart, cutLength);
            return false;
          }
        } else if (pos + node.nodeSize > to) {
          const loroNode = getLoroNodeFromPMNode(loroDoc, node);
          if (loroNode && isLoroParagraph(loroNode)) {
            const cutStart = 0;
            const cutLength = Math.min(node.content.size, to - pos - 1); // - 1 to account for block node opening tag
            loroNode.get('content')?.delete(cutStart, cutLength);
            // Handle paragraph merging: When a deletion causes two paragraphs to join together
            // (e.g., pressing backspace at the start of a paragraph), we need to merge the
            // content of this paragraph into its previous sibling in Loro.
            // This happens when: (1) the deletion starts inside a previous node (from !== pos),
            // and (2) the deleted slice has an open start (openStart !== 0), indicating the
            // previous paragraph's closing boundary was removed.
            const sliceToBeDeleted = docBeforeStep.slice(from, to);
            if (from !== pos && sliceToBeDeleted.openStart !== 0) {
              if (!parent) throw new Error('not possible');
              const loroDocNode = getLoroNodeFromPMNode(loroDoc, parent);
              assert(loroDocNode, isLoroDocument);

              const path = loroDoc.getPathToContainer(loroNode.id);
              const loroIndex = path?.[path.length - 1];
              if (typeof loroIndex !== 'number') {
                throw new Error(`Could not find index for loro node: ${loroNode.id}`);
              }

              const loroNodeBefore = loroDocNode.get('content').get(loroIndex - 1);
              if (
                loroNodeBefore &&
                isContainer(loroNodeBefore) &&
                isLoroParagraph(loroNodeBefore)
              ) {
                const deltaToJoin = loroNode.get('content')?.toDelta() ?? [];
                const loroTextBefore = loroNodeBefore.get('content');

                const loroList = loroNode.parent();
                if (!loroList || !isMovableList(loroList)) {
                  throw new Error(`Could not find target loro list for: ${loroNode.id}`);
                }

                deltaToJoin.forEach((delta) => {
                  if (delta.insert) {
                    loroTextBefore?.push(delta.insert);
                    Object.entries(delta.attributes ?? {}).forEach(([key, value]) => {
                      if (!['bold', 'italic', 'underline'].includes(key)) return;
                      if (value === null) {
                        loroTextBefore?.unmark(
                          {
                            start: loroTextBefore.length - delta.insert.length,
                            end: loroTextBefore.length,
                          },
                          key
                        );
                      } else if (value) {
                        loroTextBefore?.mark(
                          {
                            start: loroTextBefore.length - delta.insert.length,
                            end: loroTextBefore.length,
                          },
                          key,
                          true
                        );
                      }
                    });
                  }
                });

                // Delete the merged paragraph from Loro. Also remove any pending AttrStep
                // for this node (in case it was just created by an earlier step in this
                // same transaction and hasn't been assigned its Loro ID yet).
                stepDataByNewlyAddedLoroContainerId.delete(loroNode.id);
                loroList.delete(loroIndex, 1);
              }
            }
            return false;
          }
        } else {
          // All cases should be covered: node fully inside range, partially overlapping from left, or from right
          throw new Error(`Unexpected case in nodesBetween`);
        }

        return true;
      });
      // ========== END DELETION PHASE ==========

      // Map positions through this step's changes to find where inserted content ends up
      const mappedFrom = step.getMap().map(from, -1);
      const mappedTo = step.getMap().map(to);

      // ========== INSERTION PHASE ==========
      // Walk through the newly inserted range and create corresponding Loro nodes/content
      docAfterStep.nodesBetween(mappedFrom, mappedTo, (node, pos, parent, index) => {
        if (pos >= mappedFrom && pos + node.nodeSize <= mappedTo) {
          const loroId = node.attrs[LORO_ID_ATTR];
          if (loroId === LORO_DEFAULT_TEMP_ID) {
            if (!parent) throw new Error('not possible');
            if (node.type.name === 'paragraph') {
              const loroParent = getLoroNodeFromPMNode(loroDoc, parent);
              assert(loroParent, isLoroDocument);

              const newLoroParagraph = loroParent
                .get('content')
                .insertContainer(index, new LoroMap());
              newLoroParagraph.set('type', 'paragraph');
              const loroText = newLoroParagraph.setContainer('content', new LoroText());
              node.forEach((child) => {
                const { text, marks } = child;
                if (text) {
                  loroText.push(text);
                  marks.forEach((mark) => {
                    loroText.mark(
                      {
                        start: loroText.length - text.length,
                        end: loroText.length,
                      },
                      mark.type.name,
                      true
                    );
                  });
                }
              });

              // Queue an AttrStep to set this paragraph's Loro ID attribute.
              // This links the ProseMirror node to its Loro counterpart for future syncing.
              simulatedTr = simulatedTr.step(new AttrStep(pos, LORO_ID_ATTR, newLoroParagraph.id));
              stepDataByNewlyAddedLoroContainerId.set(newLoroParagraph.id, {
                pos,
                stepIndex,
              });
            }
          }
          return false;
        } else if (pos < mappedFrom) {
          const loroNode = getLoroNodeFromPMNode(loroDoc, node);
          if (loroNode && isLoroParagraph(loroNode)) {
            const sliceStart = mappedFrom - pos - 1;
            const sliceLength = Math.min(node.content.size - sliceStart, mappedTo - mappedFrom);

            const loroText = loroNode.get('content');
            node.slice(sliceStart, sliceStart + sliceLength).content.forEach((child, offset) => {
              const { text, marks } = child;
              if (text) {
                loroText?.insert(sliceStart + offset, text);
                marks.forEach((mark) => {
                  loroText?.mark(
                    {
                      start: sliceStart + offset,
                      end: sliceStart + offset + text.length,
                    },
                    mark.type.name,
                    true
                  );
                });
              }
            });

            // Trim excess content from Loro text if the PM node is now shorter.
            // This occurs when inserting a block (e.g., pressing Enter) splits the paragraph,
            // pushing trailing content into a newly created paragraph (handled in case 3 below).
            if (node.content.size < (loroText?.length ?? 0)) {
              loroText?.delete(node.content.size, loroText.length - node.content.size);
            }

            return false;
          }
        } else if (pos + node.nodeSize > mappedTo) {
          const sliceStart = 0;
          const sliceLength = Math.min(node.content.size, mappedTo - pos - 1);

          const loroId = node.attrs[LORO_ID_ATTR];
          // Determine if we need to create a new Loro node. This is required when:
          // 1. The node has a temporary ID (newly created in PM, not yet in Loro), or
          // 2. The node shares the same Loro ID as its previous sibling (happens when a paragraph
          //    is split - both halves initially reference the same Loro node).
          const previousNode = index > 0 ? parent?.child(index - 1) : null;
          if (loroId === LORO_DEFAULT_TEMP_ID || previousNode?.attrs[LORO_ID_ATTR] === loroId) {
            if (!parent) throw new Error('not possible');
            if (node.type.name === 'paragraph') {
              const loroParent = getLoroNodeFromPMNode(loroDoc, parent);
              assert(loroParent, isLoroDocument);

              const newLoroParagraph = loroParent
                .get('content')
                .insertContainer(index, new LoroMap());
              newLoroParagraph.set('type', 'paragraph');
              const loroText = newLoroParagraph.setContainer('content', new LoroText());
              node.forEach((child) => {
                const { text, marks } = child;
                if (text) {
                  loroText.push(text);
                  marks.forEach((mark) => {
                    loroText.mark(
                      {
                        start: loroText.length - text.length,
                        end: loroText.length,
                      },
                      mark.type.name,
                      true
                    );
                  });
                }
              });

              // Queue an AttrStep to assign the Loro ID to this new paragraph node
              simulatedTr = simulatedTr.step(new AttrStep(pos, LORO_ID_ATTR, newLoroParagraph.id));
              stepDataByNewlyAddedLoroContainerId.set(newLoroParagraph.id, {
                pos,
                stepIndex,
              });
            }
            return false;
          }

          const loroNode = getLoroNodeFromPMNode(loroDoc, node);
          if (!loroNode) {
            return false;
          }

          if (isLoroParagraph(loroNode)) {
            node.slice(sliceStart, sliceStart + sliceLength).content.forEach((child, offset) => {
              const { text, marks } = child;
              if (text) {
                loroNode.get('content')?.insert(offset, text);
                marks.forEach((mark) => {
                  loroNode.get('content')?.mark(
                    {
                      start: offset,
                      end: offset + text.length,
                    },
                    mark.type.name,
                    true
                  );
                });
              }
            });
            return false;
          }
        } else {
          // All cases should be covered: node fully inside range, partially overlapping from left, or from right
          throw new Error(`Unexpected case in nodesBetween`);
        }
        return true;
      });
      // ========== END INSERTION PHASE ==========
    }

    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      const { from, to, mark } = step;
      docBeforeStep.nodesBetween(from, to, (node, pos) => {
        if (pos >= from && pos + node.nodeSize <= to) {
          const loroNode = getLoroNodeFromPMNode(loroDoc, node);
          if (loroNode && isLoroParagraph(loroNode)) {
            if (step instanceof AddMarkStep) {
              loroNode
                .get('content')
                ?.mark({ start: 0, end: node.content.size }, mark.type.name, true);
            } else if (step instanceof RemoveMarkStep) {
              loroNode.get('content')?.unmark({ start: 0, end: node.content.size }, mark.type.name);
            }
            return false;
          }
        } else if (pos < from) {
          const loroNode = getLoroNodeFromPMNode(loroDoc, node);
          if (loroNode && isLoroParagraph(loroNode)) {
            const sliceStart = from - pos - 1;
            const sliceLength = Math.min(node.content.size - sliceStart, to - from);
            if (step instanceof AddMarkStep) {
              loroNode
                .get('content')
                ?.mark({ start: sliceStart, end: sliceStart + sliceLength }, mark.type.name, true);
            } else if (step instanceof RemoveMarkStep) {
              loroNode
                .get('content')
                ?.unmark({ start: sliceStart, end: sliceStart + sliceLength }, mark.type.name);
            }
            return false;
          }
        } else if (pos + node.nodeSize > to) {
          const loroNode = getLoroNodeFromPMNode(loroDoc, node);
          if (loroNode && isLoroParagraph(loroNode)) {
            const sliceStart = 0;
            const sliceLength = Math.min(node.content.size, to - pos - 1);
            if (step instanceof AddMarkStep) {
              loroNode
                .get('content')
                ?.mark({ start: sliceStart, end: sliceStart + sliceLength }, mark.type.name, true);
            } else if (step instanceof RemoveMarkStep) {
              loroNode
                .get('content')
                ?.unmark({ start: sliceStart, end: sliceStart + sliceLength }, mark.type.name);
            }
            return false;
          }
        } else {
          // All cases should be covered: node fully inside range, partially overlapping from left, or from right
          throw new Error(`Unexpected case in nodesBetween`);
        }
        return true;
      });
    }
  });

  // Append all queued AttrSteps to the original transaction.
  // These steps assign Loro IDs to newly created ProseMirror paragraph nodes.
  // We map positions through subsequent steps to account for document changes since the node was created.
  stepDataByNewlyAddedLoroContainerId.forEach((data, id) => {
    tr.step(new AttrStep(tr.mapping.slice(data.stepIndex + 1).map(data.pos), LORO_ID_ATTR, id));
  });
  loroDoc.commit();

  return tr;
}

/**
 * Creates a ProseMirror plugin that syncs changes FROM Loro TO ProseMirror.
 *
 * This handles the reverse direction of updateLoroDocGivenTransaction:
 * - When remote peers make changes (imported via Loro)
 * - When undo/redo operations are performed in Loro
 *
 * The plugin subscribes to Loro document events and translates them into
 * ProseMirror transactions to keep the editor view in sync.
 *
 * @param loroDoc - The Loro CRDT document to subscribe to
 * @param pmSchema - The ProseMirror schema for creating nodes and marks
 * @returns A ProseMirror plugin that handles Loro-to-PM synchronization
 */
export function loroSyncAdvanced(loroDoc: LoroDoc, pmSchema: Schema) {
  return new Plugin({
    key: pluginKey,
    view: (view) => {
      const unsubscribe = loroDoc.subscribe(({ events, by, origin }) => {
        let shouldProceed = false;
        switch (by) {
          case 'import':
          case 'checkout':
            shouldProceed = true;
            break;
          case 'local':
            shouldProceed = origin === 'undo';
            break;
          default: {
            const exhaustiveCheck: never = by;
            throw new Error(`Unexpected event type: ${exhaustiveCheck}`);
          }
        }

        if (!shouldProceed) {
          return;
        }

        const tr = view.state.tr.setMeta('sync-loro-to-pm', {
          origin,
          by,
        });

        events.forEach(({ diff, path }) => {
          let node = tr.doc;
          const startingStepIndex = tr.steps.length;
          let pos = 0;
          path.forEach((p) => {
            if (typeof p === 'number') {
              pos += Fragment.fromArray(node.children.slice(0, p)).size;
              node = node.child(p);
            } else if (p === 'docRoot') {
              // Root level - position stays at 0
            } else if (p === 'content') {
              // 'content' is a structural key in Loro, not a position - skip it
            }
          });

          if (diff.type === 'list') {
            let index = 0;
            diff.diff.forEach((delta) => {
              if (delta.insert) {
                const paragraphs = delta.insert
                  .map((insert) => {
                    if (isContainer(insert) && isLoroParagraph(insert)) {
                      return pmSchema.node('paragraph', {
                        [LORO_ID_ATTR]: insert.id,
                      });
                    }
                    return null;
                  })
                  .filter(Boolean) as Node[];

                const insertionPos = tr.mapping
                  .slice(startingStepIndex)
                  .map(pos + Fragment.fromArray(node.children.slice(0, index)).size);
                tr.insert(insertionPos, paragraphs);
              } else if (delta.delete) {
                const start = tr.mapping
                  .slice(startingStepIndex)
                  .map(pos + Fragment.fromArray(node.children.slice(0, index)).size);
                const end = tr.mapping
                  .slice(startingStepIndex)
                  .map(pos + Fragment.fromArray(node.children.slice(0, index + delta.delete)).size);

                tr.delete(start, end);
                index += delta.delete;
              } else if (delta.retain) {
                index += delta.retain;
              }
            });
          }

          if (diff.type === 'text') {
            if (node.type.name !== 'paragraph') {
              throw new Error(`Target node mismatch: ${node.type.name} !== paragraph`);
            }

            // Add 1 to position to skip past the paragraph's opening tag in ProseMirror's flat position space
            pos += 1;
            diff.diff.forEach((delta) => {
              if (delta.insert) {
                const from = tr.mapping.slice(startingStepIndex).map(pos);
                const to = tr.mapping.slice(startingStepIndex).map(pos + delta.insert.length);

                // Use tr.insert() instead of tr.insertText() because insertText() automatically
                // inherits marks from the preceding text node, which would incorrectly apply
                // styles that weren't in the Loro delta
                tr.insert(from, pmSchema.text(delta.insert));
                Object.entries(delta.attributes ?? {}).forEach(([key, value]) => {
                  if (!['bold', 'italic', 'underline'].includes(key)) return;
                  if (value === null) {
                    tr.removeMark(from, to, pmSchema.mark(key));
                  } else if (value) {
                    tr.addMark(from, to, pmSchema.mark(key));
                  }
                });
              } else if (delta.delete) {
                const from = tr.mapping.slice(startingStepIndex).map(pos);
                const to = tr.mapping.slice(startingStepIndex).map(pos + delta.delete);

                tr.delete(from, to);
                pos += delta.delete;
              } else if (delta.retain) {
                const from = tr.mapping.slice(startingStepIndex).map(pos);
                const to = tr.mapping.slice(startingStepIndex).map(pos + delta.retain);

                Object.entries(delta.attributes ?? {}).forEach(([key, value]) => {
                  if (!['bold', 'italic', 'underline'].includes(key)) return;

                  if (value === null) {
                    tr.removeMark(from, to, pmSchema.mark(key));
                  } else if (value) {
                    tr.addMark(from, to, pmSchema.mark(key));
                  }
                });
                pos += delta.retain;
              }
            });
          }
        });

        if (tr.steps.length) {
          view.dispatch(tr);
        }
      });
      return {
        destroy: unsubscribe,
      };
    },
  });
}
