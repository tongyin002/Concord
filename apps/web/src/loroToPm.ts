import {
  Mark,
  Node,
  NodeSpec as ProseMirrorNodeSpec,
  Schema,
  SchemaSpec,
} from 'prosemirror-model';
import 'prosemirror-view/style/prosemirror.css';
import {
  LoroDoc,
  LoroList,
  LoroMovableList,
  LoroText,
  ContainerType as LoroContainerType,
  ContainerID,
  Container,
  LoroMap,
  isContainer,
} from 'loro-crdt';

type NodeSpec = ProseMirrorNodeSpec & {
  loroContainer: {
    type: LoroContainerType;
  };
};

const schemaSpec = {
  nodes: {
    doc: {
      content: 'paragraph+',
      loroContainer: { type: 'MovableList' },
    } as const satisfies NodeSpec,
    paragraph: {
      content: 'text*',
      attrs: {
        'data-id': { default: 'temp:id', validate: 'string' },
      },
      toDOM(node) {
        return ['p', { 'data-id': node.attrs['data-id'] }, 0];
      },
      parseDOM: [
        {
          tag: 'p',
          getAttrs: (dom) => ({
            'data-id': dom.getAttribute('data-id'),
          }),
        },
      ],
      loroContainer: { type: 'List' },
    } as const satisfies NodeSpec,
    text: {
      inline: true,
      marks: 'bold italic underline',
      loroContainer: { type: 'Text' },
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
type PMNodeName = keyof typeof schemaSpec.nodes;
// This gives you: 'doc' | 'paragraph' | 'text'

type LoroBlockNode = LoroMap<{
  type: Exclude<PMNodeName, 'text'>;
  content: LoroMovableList<LoroNode> | LoroList<LoroNode>;
}>;

type LoroNode = LoroText | LoroBlockNode;

type MaybeLoroNodeContent = LoroMovableList<unknown> | LoroList<unknown>;

type MaybeLoroBlockNode = LoroMap<{
  type: Exclude<PMNodeName, 'text'>;
  content: MaybeLoroNodeContent;
}>;

function isLoroTextNode(container: Container): container is LoroText {
  return container.kind() === 'Text';
}

function isLoroMovableList(container: Container): container is LoroMovableList {
  return container.kind() === 'MovableList';
}

function isLoroList(container: Container): container is LoroList {
  return container.kind() === 'List';
}

function maybeLoroBockNode(
  container: Container
): container is MaybeLoroBlockNode {
  if (container.kind() !== 'Map') return false;

  const map = container as LoroMap;

  const blockType = map.get('type');
  if (typeof blockType !== 'string' || !(blockType in pmSchema.nodes))
    return false;

  const blockContent = map.get('content');
  if (
    !blockContent ||
    !isContainer(blockContent) ||
    !(isLoroMovableList(blockContent) || isLoroList(blockContent))
  )
    return false;

  return true;
}

function maybeLoroNode(item: unknown): item is LoroText | MaybeLoroBlockNode {
  if (!isContainer(item)) return false;

  return isLoroTextNode(item) || maybeLoroBockNode(item);
}

function LoroTextToTextNodes(loroText: LoroText): Node[] {
  const pmTexts: Node[] = [];

  loroText.toDelta().forEach((delta) => {
    const lastPmText = pmTexts.length - 1 ? pmTexts[pmTexts.length - 1] : null;

    if (delta.retain !== undefined) {
    } else if (delta.insert !== undefined) {
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
        const combinedText = pmSchema.text(
          lastPmText.text + delta.insert,
          lastPmText.marks
        );
        pmTexts[pmTexts.length - 1] = combinedText;
      } else {
        pmTexts.push(
          pmSchema.text(
            delta.insert,
            validMarksFromLoro.length ? validMarksFromLoro : undefined
          )
        );
      }
    } else {
    }
  });
  return pmTexts;
}

function createPmBlockNodeFromLoroBlockNode(
  loroBlockNode: MaybeLoroBlockNode
): Node {
  const nodeType = loroBlockNode.get('type');
  const content = loroBlockNode.get('content');

  const pmNode = pmSchema.nodes[nodeType];

  if (pmNode.inlineContent) {
    const loroItems = content.toArray();
    const pmInlineNodes: Node[] = [];

    for (const item of loroItems) {
      if (!maybeLoroNode(item)) {
        throw new Error('Container is not a loro container');
      }

      if (isLoroTextNode(item)) {
        pmInlineNodes.push(...LoroTextToTextNodes(item));
      }
    }

    return pmSchema.node(
      nodeType,
      {
        'data-id': loroBlockNode.id,
      },
      pmInlineNodes
    );
  }

  return pmSchema.node(
    nodeType,
    {
      'data-id': loroBlockNode.id,
    },
    content.toArray().map((item) => {
      if (!maybeLoroNode(item)) {
        throw new Error('Container is not a loro container');
      }

      if (isLoroTextNode(item)) {
        return pmSchema.text('');
      }

      return createPmBlockNodeFromLoroBlockNode(item);
    })
  );
}

export function LoroDocToPmDoc(loroDoc: LoroDoc, docId: ContainerID): Node {
  const loroDocNode = loroDoc.getContainerById(docId);
  if (!loroDocNode || !maybeLoroBockNode(loroDocNode)) {
    throw new Error('Container is not a loro doc node');
  }

  const nodeType = loroDocNode.get('type');
  if (nodeType !== 'doc') {
    throw new Error('Container is not a loro doc node');
  }

  console.debug(`loroDoc`, loroDoc.toJSON());
  return createPmBlockNodeFromLoroBlockNode(loroDocNode);
}
