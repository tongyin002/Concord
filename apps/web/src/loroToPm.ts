import { Fragment, Mark, Node, NodeSpec, Schema, SchemaSpec } from 'prosemirror-model';
import 'prosemirror-view/style/prosemirror.css';
import { LoroDoc, LoroText, isContainer, LoroMap } from 'loro-crdt';
import { isLoroText, isMovableList } from './loroUtils';

export const LORO_ID_ATTR = 'loro-id';
// This is the default identifier for newly created pm node which doesn't have a matching loro node yet
export const LORO_DEFAULT_TEMP_ID = 'temp:id';

const schemaSpec = {
  nodes: {
    doc: {
      content: 'paragraph+',
      attrs: {
        [LORO_ID_ATTR]: { default: LORO_DEFAULT_TEMP_ID, validate: 'string' },
      },
    } as const satisfies NodeSpec,
    paragraph: {
      content: 'text*',
      attrs: {
        [LORO_ID_ATTR]: { default: LORO_DEFAULT_TEMP_ID, validate: 'string' },
      },
      toDOM(node) {
        return ['p', { [LORO_ID_ATTR]: node.attrs[LORO_ID_ATTR] }, 0];
      },
      parseDOM: [
        {
          tag: 'p',
        },
      ],
    } as const satisfies NodeSpec,
    text: {
      inline: true,
      marks: 'bold italic underline',
    } as const satisfies NodeSpec,
  },
  marks: {
    bold: {
      parseDOM: [{ tag: 'b' }],
      toDOM: () => ['b', 0],
    },
    italic: {
      parseDOM: [{ tag: 'em' }],
      toDOM: () => ['em', 0],
    },
    underline: {
      parseDOM: [{ tag: 'u' }],
      toDOM: () => ['u', 0],
    },
  },
} as const satisfies SchemaSpec;

export const pmSchema = new Schema(schemaSpec);

// Extract node names as a union type from the const schemaSpec
// This gives you: 'doc' | 'paragraph' | 'text'
type PMNodeName = keyof typeof schemaSpec.nodes;

export function LoroTextToPMTextNodes(loroText: LoroText): Node[] {
  const pmTexts: Node[] = [];

  loroText.toDelta().forEach((delta) => {
    const lastPmText = pmTexts.length - 1 ? pmTexts[pmTexts.length - 1] : null;

    if (delta.insert !== undefined) {
      const validMarksFromLoro: Mark[] = [];

      Object.entries(delta.attributes ?? {}).forEach(([key, value]) => {
        if (!(key in pmSchema.marks)) return;
        if (typeof value !== 'boolean' || !value) return;

        const mark = pmSchema.mark(key);
        validMarksFromLoro.push(mark);
      });

      const lastMarks = lastPmText?.marks ?? [];
      const marksMatched =
        lastMarks.length === validMarksFromLoro.length &&
        validMarksFromLoro.every((mark) => mark.isInSet(lastMarks));

      if (lastPmText && marksMatched) {
        const combinedText = pmSchema.text(lastPmText.text + delta.insert, lastPmText.marks);
        pmTexts[pmTexts.length - 1] = combinedText;
      } else {
        pmTexts.push(
          pmSchema.text(delta.insert, validMarksFromLoro.length ? validMarksFromLoro : undefined)
        );
      }
    }
  });

  return pmTexts;
}

// consecutive pm text nodes are managed by a single loro text node
type LoroNodeType = Exclude<PMNodeName, 'text'>;

// rough type before validation
type MaybeLegitLoroNode<T extends LoroNodeType> = LoroMap<{ type: T; content?: unknown }>;

function maybeLegitLoroNode<T extends LoroNodeType>(
  container: unknown
): container is MaybeLegitLoroNode<T> {
  if (!isContainer(container)) return false;
  if (container.kind() !== 'Map') return false;

  const type = (container as LoroMap).get('type');
  return typeof type === 'string' && type in pmSchema.nodes && type !== 'text';
}

export function buildPMNodeFromLoroNode(loroNode: unknown): Node {
  if (!maybeLegitLoroNode(loroNode)) {
    throw new Error(`Node is not a legit loro node`);
  }

  const type = loroNode.get('type');
  const content = loroNode.get('content');

  let fragment: Fragment | undefined;
  if (content) {
    if (isContainer(content)) {
      if (isMovableList(content)) {
        fragment = Fragment.fromArray(content.toArray().map(buildPMNodeFromLoroNode));
      } else if (isLoroText(content)) {
        fragment = Fragment.fromArray(LoroTextToPMTextNodes(content));
      } else {
        throw new Error('Invalid content for node type ${type}');
      }
    } else {
      throw new Error(`Invalid content for node type ${type} is not a container`);
    }
  }

  if (fragment && !pmSchema.nodes[type].validContent(fragment)) {
    throw new Error(`Invalid content for node type ${type}`);
  }

  return pmSchema.node(
    type,
    {
      [LORO_ID_ATTR]: loroNode.id,
    },
    fragment
  );
}

export function loroDocToPMDoc(loroDoc: LoroDoc): Node {
  const root = loroDoc.getByPath('docRoot');
  if (!root) {
    throw new Error('Doc root not found');
  }

  return buildPMNodeFromLoroNode(root);
}
