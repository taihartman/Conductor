/**
 * @module tileTree
 *
 * Pure functions for manipulating the TileNode binary tree.
 * No side effects, no store access — suitable for unit testing.
 */

import type { TileNode } from '@shared/types';

/** Counter for generating unique tile IDs within a session. */
let tileIdCounter = 0;

/** Generate a unique tile ID (leaf or split prefix). */
export function generateTileId(prefix: 'l' | 's' = 'l'): string {
  tileIdCounter += 1;
  return `${prefix}-${tileIdCounter}`;
}

/** Reset the tile ID counter (for testing). */
export function resetTileIdCounter(): void {
  tileIdCounter = 0;
}

/**
 * Walk all leaf nodes in the tile tree, invoking the callback for each.
 */
export function walkLeaves(
  node: TileNode,
  callback: (leaf: TileNode & { type: 'leaf' }) => void
): void {
  if (node.type === 'leaf') {
    callback(node);
    return;
  }
  walkLeaves(node.children[0], callback);
  walkLeaves(node.children[1], callback);
}

/**
 * Collect all non-null sessionIds from the tree's leaf nodes.
 * This is the derived `subscribedSessionIds` value.
 */
export function getSubscribedIds(root: TileNode): string[] {
  const ids: string[] = [];
  walkLeaves(root, (leaf) => {
    if (leaf.sessionId !== null) {
      ids.push(leaf.sessionId);
    }
  });
  return ids;
}

/**
 * Split a leaf node into a split with the existing leaf and a new leaf.
 * Returns a new tree (immutable — original is not mutated).
 *
 * @param root - The current tile tree root.
 * @param tileId - ID of the leaf to split.
 * @param direction - Split direction ('horizontal' or 'vertical').
 * @param sessionId - Session to assign to the new leaf.
 * @param insertBefore - When true, the new leaf becomes children[0] (left/top).
 * @returns New tree root with the split applied, or the original if tileId not found.
 */
export function splitNode(
  root: TileNode,
  tileId: string,
  direction: 'horizontal' | 'vertical',
  sessionId: string,
  insertBefore = false
): TileNode {
  if (root.type === 'leaf') {
    if (root.id === tileId) {
      const newLeaf: TileNode = {
        type: 'leaf',
        id: generateTileId('l'),
        sessionId,
      };
      return {
        type: 'split',
        id: generateTileId('s'),
        direction,
        children: insertBefore ? [newLeaf, root] : [root, newLeaf],
        sizes: [50, 50],
      };
    }
    return root;
  }

  const newChild0 = splitNode(root.children[0], tileId, direction, sessionId, insertBefore);
  const newChild1 = splitNode(root.children[1], tileId, direction, sessionId, insertBefore);

  if (newChild0 === root.children[0] && newChild1 === root.children[1]) {
    return root;
  }

  return {
    ...root,
    children: [newChild0, newChild1],
  };
}

/**
 * Remove a leaf from the tree. When a leaf is removed from a split,
 * its sibling replaces the split node. Returns null if the root leaf
 * itself is removed.
 *
 * @param root - The current tile tree root.
 * @param tileId - ID of the leaf to remove.
 * @returns New tree root, or null if the entire tree is removed.
 */
export function removeNode(root: TileNode, tileId: string): TileNode | null {
  if (root.type === 'leaf') {
    return root.id === tileId ? null : root;
  }

  // Check if either direct child is the target leaf
  const [child0, child1] = root.children;

  if (child0.type === 'leaf' && child0.id === tileId) {
    return child1;
  }
  if (child1.type === 'leaf' && child1.id === tileId) {
    return child0;
  }

  // Recurse into split children
  const newChild0 = removeNode(child0, tileId);
  const newChild1 = removeNode(child1, tileId);

  if (newChild0 === null) return child1;
  if (newChild1 === null) return child0;

  if (newChild0 === child0 && newChild1 === child1) {
    return root;
  }

  return {
    ...root,
    children: [newChild0, newChild1],
  };
}

/**
 * Update sizes of a split node by its ID. Returns new tree (immutable).
 */
export function updateSizes(root: TileNode, splitId: string, sizes: [number, number]): TileNode {
  if (root.type === 'leaf') return root;

  if (root.id === splitId) {
    return { ...root, sizes };
  }

  const newChild0 = updateSizes(root.children[0], splitId, sizes);
  const newChild1 = updateSizes(root.children[1], splitId, sizes);

  if (newChild0 === root.children[0] && newChild1 === root.children[1]) {
    return root;
  }

  return {
    ...root,
    children: [newChild0, newChild1],
  };
}

/**
 * Set the sessionId of a leaf node. Returns new tree (immutable).
 */
export function setLeafSession(root: TileNode, tileId: string, sessionId: string | null): TileNode {
  if (root.type === 'leaf') {
    if (root.id === tileId) {
      return { ...root, sessionId };
    }
    return root;
  }

  const newChild0 = setLeafSession(root.children[0], tileId, sessionId);
  const newChild1 = setLeafSession(root.children[1], tileId, sessionId);

  if (newChild0 === root.children[0] && newChild1 === root.children[1]) {
    return root;
  }

  return {
    ...root,
    children: [newChild0, newChild1],
  };
}

/**
 * Count the total number of leaf nodes in the tree.
 */
export function countLeaves(root: TileNode): number {
  if (root.type === 'leaf') return 1;
  return countLeaves(root.children[0]) + countLeaves(root.children[1]);
}

/**
 * Find a leaf node by its ID. Returns the leaf or undefined.
 */
export function findLeaf(
  root: TileNode,
  tileId: string
): (TileNode & { type: 'leaf' }) | undefined {
  if (root.type === 'leaf') {
    return root.id === tileId ? root : undefined;
  }
  return findLeaf(root.children[0], tileId) ?? findLeaf(root.children[1], tileId);
}

/**
 * Find a leaf node by its sessionId. Returns the first match (left-first DFS)
 * or undefined. Mirrors {@link findLeaf} which searches by tile ID.
 *
 * @remarks If the same session appears in multiple tiles, the leftmost leaf is returned.
 */
export function findLeafBySessionId(
  root: TileNode,
  sessionId: string
): (TileNode & { type: 'leaf' }) | undefined {
  if (root.type === 'leaf') {
    return root.sessionId === sessionId ? root : undefined;
  }
  return (
    findLeafBySessionId(root.children[0], sessionId) ??
    findLeafBySessionId(root.children[1], sessionId)
  );
}
