import { isContainer, isContainerId, LoroDoc } from 'loro-crdt';
import { Node } from 'prosemirror-model';
import { isLoroMap } from './loroUtils';

export function getLoroNodeFromPMNode(loroDoc: LoroDoc, node: Node) {
  const loroId = node.attrs['loro-id'];
  if (!loroId) {
    return null;
  }

  if (!isContainerId(loroId)) {
    throw new Error(`${loroId} is not a loro container id`);
  }

  const loroNode = loroDoc.getContainerById(loroId);
  if (!isContainer(loroNode) || !isLoroMap(loroNode)) {
    throw new Error('Loro container cannot be found or is not a loro map');
  }

  if (loroNode.get('type') !== node.type.name) {
    throw new Error('Loro node type does not match the pm node type');
  }

  return loroNode;
}
