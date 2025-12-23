import {
  Container,
  Cursor,
  isContainer,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
} from 'loro-crdt';

export type LoroParagraph = {
  type: 'paragraph';
  content?: LoroText;
};

type LoroDocument = {
  type: 'doc';
  content: LoroMovableList<LoroMap<LoroParagraph>>;
};

export function isMovableList(container: Container): container is LoroMovableList {
  return container.kind() === 'MovableList';
}

export function isLoroText(container: Container): container is LoroText {
  return container.kind() === 'Text';
}

export function isLoroList(container: Container): container is LoroList {
  return container.kind() === 'List';
}

export function isLoroMap(container: Container): container is LoroMap {
  return container.kind() === 'Map';
}

export function isLoroParagraph(container: Container): container is LoroMap<LoroParagraph> {
  if (!isLoroMap(container)) return false;
  if (container.get('type') !== 'paragraph') return false;
  const content = container.get('content');
  return !content || (isContainer(content) && isLoroText(content));
}

export function isLoroDocument(container: Container): container is LoroMap<LoroDocument> {
  if (!isLoroMap(container)) return false;
  if (container.get('type') !== 'doc') return false;
  const content = container.get('content');
  // best effort check, we don't check the content type to speed things up
  return !!content && isContainer(content) && isMovableList(content);
}

export function assert<T>(
  loroNode: any,
  assertion: (loroNode: any) => loroNode is T
): asserts loroNode is T {
  if (!loroNode || !assertion(loroNode)) {
    if (import.meta.env.DEV) {
      console.log(`Loro node does not match the assertion:`, loroNode?.toJSON());
    }
    throw new Error(`Loro node does not match the assertion`);
  }
}

export function isCursorEqual(cursor?: Cursor | null, cursor2?: Cursor | null): boolean {
  if (!cursor && !cursor2) return true;
  if (!cursor || !cursor2) return false;

  const pos1 = cursor.pos();
  const pos2 = cursor2.pos();
  return (
    pos1?.counter === pos2?.counter &&
    pos1?.peer === pos2?.peer &&
    cursor.containerId() === cursor2.containerId()
  );
}
