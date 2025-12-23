import { Plugin, PluginKey } from 'prosemirror-state';
import { ContainerID, isContainer, LoroDoc, LoroMap, LoroText } from 'loro-crdt';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from 'prosemirror-transform';
import { getLoroNodeFromPMNode } from './pmToLoro';
import { assert, isLoroDocument, isLoroParagraph, isMovableList } from './loroUtils';
import { Fragment, Schema } from 'prosemirror-model';
import { Node } from 'prosemirror-model';
import { LORO_ID_ATTR, LORO_DEFAULT_TEMP_ID } from './loroToPm';

const pluginKey = new PluginKey<Map<ContainerID, number>>('loroSync');

export function loroSyncAdvanced(loroDoc: LoroDoc, pmSchema: Schema) {
  return new Plugin({
    key: pluginKey,
    state: {
      init: () => {
        // loroIdsToAssign is a map of loro ids to the positions in the pm doc where they should be assigned
        const loroIdsToAssign = new Map<ContainerID, number>();
        return loroIdsToAssign;
      },
      apply: (tr, loroIdsToAssign, _oldState, _newState) => {
        if (!tr.docChanged) {
          // no changes to the pm doc, no need to update loro doc
          return loroIdsToAssign;
        }

        if (tr.getMeta('loro-import')) {
          return loroIdsToAssign;
        }

        const newLoroIdsToAssign = new Map<ContainerID, number>();
        tr.steps.forEach((step, stepIndex) => {
          const docBeforeStep = tr.docs[stepIndex];
          const docAfterStep = tr.docs[stepIndex + 1] ?? tr.doc;

          if (step instanceof ReplaceStep) {
            let { from, to } = step;

            /** Begin: Delete content from loro nodes */
            docBeforeStep.nodesBetween(from, to, (node, pos, parent) => {
              if (pos >= from && pos + node.nodeSize <= to) {
                const loroNode = getLoroNodeFromPMNode(loroDoc, node);
                if (loroNode) {
                  if (!parent) throw new Error('not possible');
                  const loroParent = getLoroNodeFromPMNode(loroDoc, parent);
                  assert(loroParent, isLoroDocument);

                  const indexForLoroNode = loroParent
                    .get('content')
                    .toArray()
                    .findIndex((item) => item.id === loroNode.id);
                  loroParent.get('content').delete(indexForLoroNode, 1);
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
                  // ? should we combine this paragraph with its prev sibling?
                  // my speculation is that only when the slice cuts off previous paragraph (making its end open)
                  // so how do we detect that? -> from !== pos and the content before 'from' is open to be merged
                  const sliceToBeDeleted = docBeforeStep.slice(from, to);
                  if (from !== pos && sliceToBeDeleted.openStart !== 0) {
                    if (!parent) throw new Error('not possible');
                    const loroDocNode = getLoroNodeFromPMNode(loroDoc, parent);
                    assert(loroDocNode, isLoroDocument);
                    const indexForLoroNode = loroDocNode
                      .get('content')
                      .toArray()
                      .findIndex((item) => item.id === loroNode.id);
                    const loroNodeBefore = loroDocNode.get('content').get(indexForLoroNode - 1);
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

                      // delete loroNode
                      loroList.delete(indexForLoroNode, 1);
                    }
                  }
                  return false;
                }
              } else {
                // not possible, branches above should have handled all cases
                throw new Error(`Unexpected case in nodesBetween`);
              }

              return true;
            });
            /** End: Delete content from loro nodes */

            const mappedFrom = step.getMap().map(from, -1);
            const mappedTo = step.getMap().map(to);
            /** Begin: Insert content into loro nodes */
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

                    newLoroIdsToAssign.set(
                      newLoroParagraph.id,
                      tr.mapping.slice(stepIndex + 1).map(pos)
                    );
                  }
                }
                return false;
              } else if (pos < mappedFrom) {
                const loroNode = getLoroNodeFromPMNode(loroDoc, node);
                if (loroNode && isLoroParagraph(loroNode)) {
                  const sliceStart = mappedFrom - pos - 1;
                  const sliceLength = Math.min(
                    node.content.size - sliceStart,
                    mappedTo - mappedFrom
                  );

                  const loroText = loroNode.get('content');
                  node
                    .slice(sliceStart, sliceStart + sliceLength)
                    .content.forEach((child, offset) => {
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

                  // after text insertion, there might be extra content in the loro text that needs to be deleted
                  // this happens when inserting blocks of text which shift the content after the slice into a new
                  // block. we deal with that in case 3
                  if (node.content.size < (loroText?.length ?? 0)) {
                    loroText?.delete(node.content.size, loroText.length - node.content.size);
                  }

                  return false;
                }
              } else if (pos + node.nodeSize > mappedTo) {
                const sliceStart = 0;
                const sliceLength = Math.min(node.content.size, mappedTo - pos - 1);

                const loroId = node.attrs[LORO_ID_ATTR];
                // if its' a temp:id, or it's a repeatd loro id, it means we need to create a new loro node
                // how do we know if it's a repeated loro id? -> we check if it has the same id as the previous node
                const previousNode = index > 0 ? parent?.child(index - 1) : null;
                if (
                  loroId === LORO_DEFAULT_TEMP_ID ||
                  previousNode?.attrs[LORO_ID_ATTR] === loroId
                ) {
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

                    newLoroIdsToAssign.set(
                      newLoroParagraph.id,
                      tr.mapping.slice(stepIndex + 1).map(pos)
                    );
                  }
                  return false;
                }

                const loroNode = getLoroNodeFromPMNode(loroDoc, node);
                if (!loroNode) {
                  return false;
                }

                if (isLoroParagraph(loroNode)) {
                  node
                    .slice(sliceStart, sliceStart + sliceLength)
                    .content.forEach((child, offset) => {
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
                // not possible, branches above should have handled all cases
                throw new Error(`Unexpected case in nodesBetween`);
              }
              return true;
            });
            /** End: Insert content into loro nodes */
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
                    loroNode
                      .get('content')
                      ?.unmark({ start: 0, end: node.content.size }, mark.type.name);
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
                      ?.mark(
                        { start: sliceStart, end: sliceStart + sliceLength },
                        mark.type.name,
                        true
                      );
                  } else if (step instanceof RemoveMarkStep) {
                    loroNode
                      .get('content')
                      ?.unmark(
                        { start: sliceStart, end: sliceStart + sliceLength },
                        mark.type.name
                      );
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
                      ?.mark(
                        { start: sliceStart, end: sliceStart + sliceLength },
                        mark.type.name,
                        true
                      );
                  } else if (step instanceof RemoveMarkStep) {
                    loroNode
                      .get('content')
                      ?.unmark(
                        { start: sliceStart, end: sliceStart + sliceLength },
                        mark.type.name
                      );
                  }
                  return false;
                }
              } else {
                // not possible, branches above should have handled all cases
                throw new Error(`Unexpected case in nodesBetween`);
              }
              return true;
            });
          }
        });

        console.debug(`after apply:`, JSON.stringify(loroDoc.toJSON(), null, 2));
        loroDoc.commit();
        return !newLoroIdsToAssign.size && !loroIdsToAssign.size
          ? loroIdsToAssign
          : newLoroIdsToAssign;
      },
    },
    appendTransaction: (_transactions, _oldState, newState) => {
      const tr = newState.tr;
      const pluginState = pluginKey.getState(newState);
      if (pluginState?.size) {
        pluginState.forEach((pos, id) => {
          tr.setNodeAttribute(pos, LORO_ID_ATTR, id);
        });
      }
      return tr.steps.length ? tr : null;
    },
    view: (view) => {
      const unsubscribe = loroDoc.subscribe(({ events, by, origin }) => {
        let shouldProceed = false;
        switch (by) {
          case 'import':
            shouldProceed = true;
            break;
          case 'local':
            shouldProceed = origin === 'undo';
            break;
          case 'checkout':
            shouldProceed = false;
            break;
          default: {
            const exhaustiveCheck: never = by;
            throw new Error(`Unexpected event type: ${exhaustiveCheck}`);
          }
        }

        if (!shouldProceed) {
          return;
        }

        const tr = view.state.tr.setMeta('loro-import', true);

        events.forEach(({ diff, path }) => {
          let node = tr.doc;
          const startingStepIndex = tr.steps.length;
          let pos = 0;
          path.forEach((p) => {
            if (typeof p === 'number') {
              pos += Fragment.fromArray(node.children.slice(0, p)).size;
              node = node.child(p);
            } else if (p === 'docRoot') {
              // do nothing
            } else if (p === 'content') {
              // skip
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

            pos += 1; // account for block node opening tag
            diff.diff.forEach((delta) => {
              if (delta.insert) {
                const from = tr.mapping.slice(startingStepIndex).map(pos);
                const to = tr.mapping.slice(startingStepIndex).map(pos + delta.insert.length);

                // notice, we can't use tr.insertText because it auto inherits marks from previous text node
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
