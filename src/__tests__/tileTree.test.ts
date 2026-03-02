import { describe, it, expect, beforeEach } from 'vitest';
import type { TileNode } from '../models/types';
import {
  generateTileId,
  resetTileIdCounter,
  walkLeaves,
  getSubscribedIds,
  splitNode,
  removeNode,
  updateSizes,
  setLeafSession,
  countLeaves,
  findLeaf,
  findLeafBySessionId,
} from '../../webview-ui/src/utils/tileTree';

describe('tileTree', () => {
  beforeEach(() => {
    resetTileIdCounter();
  });

  // ── generateTileId ───────────────────────────────────────────────

  describe('generateTileId', () => {
    it('generates unique leaf IDs with l- prefix by default', () => {
      const id1 = generateTileId();
      const id2 = generateTileId();
      expect(id1).toBe('l-1');
      expect(id2).toBe('l-2');
    });

    it('generates unique split IDs with s- prefix', () => {
      const id1 = generateTileId('s');
      const id2 = generateTileId('s');
      expect(id1).toBe('s-1');
      expect(id2).toBe('s-2');
    });

    it('resets counter correctly', () => {
      generateTileId();
      generateTileId();
      resetTileIdCounter();
      expect(generateTileId()).toBe('l-1');
    });
  });

  // ── walkLeaves ───────────────────────────────────────────────────

  describe('walkLeaves', () => {
    it('visits a single leaf', () => {
      const leaf: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      const visited: string[] = [];
      walkLeaves(leaf, (l) => visited.push(l.id));
      expect(visited).toEqual(['t1']);
    });

    it('visits all leaves in a split', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'abc' },
          { type: 'leaf', id: 't2', sessionId: 'def' },
        ],
        sizes: [50, 50],
      };
      const visited: string[] = [];
      walkLeaves(tree, (l) => visited.push(l.id));
      expect(visited).toEqual(['t1', 't2']);
    });

    it('visits leaves in nested splits (left-to-right order)', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          {
            type: 'split',
            id: 's2',
            direction: 'vertical',
            children: [
              { type: 'leaf', id: 't1', sessionId: 'a' },
              { type: 'leaf', id: 't2', sessionId: 'b' },
            ],
            sizes: [50, 50],
          },
          { type: 'leaf', id: 't3', sessionId: 'c' },
        ],
        sizes: [60, 40],
      };
      const visited: string[] = [];
      walkLeaves(tree, (l) => visited.push(l.id));
      expect(visited).toEqual(['t1', 't2', 't3']);
    });
  });

  // ── getSubscribedIds ─────────────────────────────────────────────

  describe('getSubscribedIds', () => {
    it('returns non-null sessionIds from leaves', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'abc' },
          { type: 'leaf', id: 't2', sessionId: null },
        ],
        sizes: [50, 50],
      };
      expect(getSubscribedIds(tree)).toEqual(['abc']);
    });

    it('returns empty array when all leaves are empty', () => {
      const tree: TileNode = { type: 'leaf', id: 't1', sessionId: null };
      expect(getSubscribedIds(tree)).toEqual([]);
    });

    it('includes duplicate sessionIds (same session in multiple tiles)', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'abc' },
          { type: 'leaf', id: 't2', sessionId: 'abc' },
        ],
        sizes: [50, 50],
      };
      expect(getSubscribedIds(tree)).toEqual(['abc', 'abc']);
    });
  });

  // ── splitNode ────────────────────────────────────────────────────

  describe('splitNode', () => {
    it('splits a root leaf into a horizontal split', () => {
      const leaf: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      const result = splitNode(leaf, 't1', 'horizontal', 'def');

      expect(result.type).toBe('split');
      if (result.type === 'split') {
        expect(result.direction).toBe('horizontal');
        expect(result.sizes).toEqual([50, 50]);
        expect(result.children[0]).toBe(leaf); // original leaf preserved
        expect(result.children[1].type).toBe('leaf');
        if (result.children[1].type === 'leaf') {
          expect(result.children[1].sessionId).toBe('def');
        }
      }
    });

    it('splits a nested leaf by ID', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'abc' },
          { type: 'leaf', id: 't2', sessionId: 'def' },
        ],
        sizes: [50, 50],
      };
      const result = splitNode(tree, 't2', 'vertical', 'ghi');

      expect(result.type).toBe('split');
      if (result.type === 'split') {
        // Left child unchanged
        expect(result.children[0]).toBe(tree.children[0]);
        // Right child is now a split
        expect(result.children[1].type).toBe('split');
      }
    });

    it('returns original tree when tileId not found', () => {
      const tree: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      const result = splitNode(tree, 'nonexistent', 'horizontal', 'def');
      expect(result).toBe(tree);
    });

    it('places new leaf as children[0] when insertBefore is true (root level)', () => {
      const leaf: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      const result = splitNode(leaf, 't1', 'horizontal', 'def', true);

      expect(result.type).toBe('split');
      if (result.type === 'split') {
        expect(result.direction).toBe('horizontal');
        expect(result.sizes).toEqual([50, 50]);
        // New leaf should be first (children[0])
        expect(result.children[0].type).toBe('leaf');
        if (result.children[0].type === 'leaf') {
          expect(result.children[0].sessionId).toBe('def');
        }
        // Original leaf should be second (children[1])
        expect(result.children[1]).toBe(leaf);
      }
    });

    it('places new leaf as children[0] when insertBefore is true (nested level)', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'abc' },
          { type: 'leaf', id: 't2', sessionId: 'def' },
        ],
        sizes: [50, 50],
      };
      const result = splitNode(tree, 't2', 'vertical', 'ghi', true);

      expect(result.type).toBe('split');
      if (result.type === 'split') {
        // Left child unchanged
        expect(result.children[0]).toBe(tree.children[0]);
        // Right child is now a split with new leaf first
        const rightSplit = result.children[1];
        expect(rightSplit.type).toBe('split');
        if (rightSplit.type === 'split') {
          expect(rightSplit.direction).toBe('vertical');
          // New leaf is children[0] (insertBefore)
          if (rightSplit.children[0].type === 'leaf') {
            expect(rightSplit.children[0].sessionId).toBe('ghi');
          }
          // Original leaf is children[1]
          expect(rightSplit.children[1]).toBe(tree.children[1]);
        }
      }
    });

    it('preserves default behavior (children[1]) when insertBefore is omitted', () => {
      const leaf: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      const result = splitNode(leaf, 't1', 'horizontal', 'def');

      expect(result.type).toBe('split');
      if (result.type === 'split') {
        // Original leaf should be first (children[0])
        expect(result.children[0]).toBe(leaf);
        // New leaf should be second (children[1])
        if (result.children[1].type === 'leaf') {
          expect(result.children[1].sessionId).toBe('def');
        }
      }
    });

    it('does not mutate the original tree', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'abc' },
          { type: 'leaf', id: 't2', sessionId: 'def' },
        ],
        sizes: [50, 50],
      };
      const childrenBefore = [...tree.children];
      splitNode(tree, 't2', 'vertical', 'ghi');
      expect(tree.children).toEqual(childrenBefore);
    });
  });

  // ── removeNode ───────────────────────────────────────────────────

  describe('removeNode', () => {
    it('returns null when removing the only leaf', () => {
      const leaf: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      expect(removeNode(leaf, 't1')).toBeNull();
    });

    it('returns sibling when removing a leaf from a split', () => {
      const right: TileNode = { type: 'leaf', id: 't2', sessionId: 'def' };
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [{ type: 'leaf', id: 't1', sessionId: 'abc' }, right],
        sizes: [50, 50],
      };
      const result = removeNode(tree, 't1');
      expect(result).toBe(right);
    });

    it('returns sibling when removing right child', () => {
      const left: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [left, { type: 'leaf', id: 't2', sessionId: 'def' }],
        sizes: [50, 50],
      };
      const result = removeNode(tree, 't2');
      expect(result).toBe(left);
    });

    it('removes a deeply nested leaf and collapses parent split', () => {
      const deepLeaf: TileNode = { type: 'leaf', id: 't3', sessionId: 'ghi' };
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'abc' },
          {
            type: 'split',
            id: 's2',
            direction: 'vertical',
            children: [{ type: 'leaf', id: 't2', sessionId: 'def' }, deepLeaf],
            sizes: [50, 50],
          },
        ],
        sizes: [60, 40],
      };

      const result = removeNode(tree, 't3');
      expect(result).not.toBeNull();
      if (result && result.type === 'split') {
        // Right child should now be t2 directly (s2 collapsed)
        expect(result.children[1]).toEqual({ type: 'leaf', id: 't2', sessionId: 'def' });
      }
    });

    it('returns original tree when tileId not found', () => {
      const tree: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      expect(removeNode(tree, 'nonexistent')).toBe(tree);
    });
  });

  // ── updateSizes ──────────────────────────────────────────────────

  describe('updateSizes', () => {
    it('updates sizes of a split node by ID', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'abc' },
          { type: 'leaf', id: 't2', sessionId: 'def' },
        ],
        sizes: [50, 50],
      };
      const result = updateSizes(tree, 's1', [30, 70]);
      expect(result.type).toBe('split');
      if (result.type === 'split') {
        expect(result.sizes).toEqual([30, 70]);
      }
    });

    it('returns original tree when splitId not found', () => {
      const tree: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      expect(updateSizes(tree, 'nonexistent', [30, 70])).toBe(tree);
    });
  });

  // ── setLeafSession ───────────────────────────────────────────────

  describe('setLeafSession', () => {
    it('sets sessionId on a matching leaf', () => {
      const tree: TileNode = { type: 'leaf', id: 't1', sessionId: null };
      const result = setLeafSession(tree, 't1', 'abc');
      expect(result.type).toBe('leaf');
      if (result.type === 'leaf') {
        expect(result.sessionId).toBe('abc');
      }
    });

    it('clears sessionId to null', () => {
      const tree: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      const result = setLeafSession(tree, 't1', null);
      if (result.type === 'leaf') {
        expect(result.sessionId).toBeNull();
      }
    });

    it('returns original tree when tileId not found', () => {
      const tree: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      expect(setLeafSession(tree, 'nonexistent', 'def')).toBe(tree);
    });
  });

  // ── countLeaves ──────────────────────────────────────────────────

  describe('countLeaves', () => {
    it('returns 1 for a single leaf', () => {
      expect(countLeaves({ type: 'leaf', id: 't1', sessionId: null })).toBe(1);
    });

    it('returns 2 for a simple split', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          { type: 'leaf', id: 't1', sessionId: 'a' },
          { type: 'leaf', id: 't2', sessionId: 'b' },
        ],
        sizes: [50, 50],
      };
      expect(countLeaves(tree)).toBe(2);
    });

    it('returns 3 for a nested split', () => {
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [
          {
            type: 'split',
            id: 's2',
            direction: 'vertical',
            children: [
              { type: 'leaf', id: 't1', sessionId: 'a' },
              { type: 'leaf', id: 't2', sessionId: 'b' },
            ],
            sizes: [50, 50],
          },
          { type: 'leaf', id: 't3', sessionId: 'c' },
        ],
        sizes: [60, 40],
      };
      expect(countLeaves(tree)).toBe(3);
    });
  });

  // ── findLeaf ─────────────────────────────────────────────────────

  describe('findLeaf', () => {
    it('finds a root leaf', () => {
      const leaf: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      expect(findLeaf(leaf, 't1')).toBe(leaf);
    });

    it('finds a nested leaf', () => {
      const target: TileNode = { type: 'leaf', id: 't2', sessionId: 'def' };
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [{ type: 'leaf', id: 't1', sessionId: 'abc' }, target],
        sizes: [50, 50],
      };
      expect(findLeaf(tree, 't2')).toBe(target);
    });

    it('returns undefined when not found', () => {
      const tree: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      expect(findLeaf(tree, 'nonexistent')).toBeUndefined();
    });
  });

  // ── findLeafBySessionId ─────────────────────────────────────────

  describe('findLeafBySessionId', () => {
    it('finds a root leaf by sessionId', () => {
      const leaf: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      const result = findLeafBySessionId(leaf, 'abc');
      expect(result).toBe(leaf);
    });

    it('finds a nested leaf by sessionId', () => {
      const target: TileNode = { type: 'leaf', id: 't2', sessionId: 'def' };
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [{ type: 'leaf', id: 't1', sessionId: 'abc' }, target],
        sizes: [50, 50],
      };
      expect(findLeafBySessionId(tree, 'def')).toBe(target);
    });

    it('returns undefined when sessionId not found', () => {
      const tree: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      expect(findLeafBySessionId(tree, 'nonexistent')).toBeUndefined();
    });

    it('returns the leftmost leaf when the same session appears in multiple tiles', () => {
      const left: TileNode = { type: 'leaf', id: 't1', sessionId: 'abc' };
      const right: TileNode = { type: 'leaf', id: 't2', sessionId: 'abc' };
      const tree: TileNode = {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        children: [left, right],
        sizes: [50, 50],
      };
      const result = findLeafBySessionId(tree, 'abc');
      expect(result).toBe(left);
    });

    it('returns undefined for a leaf with null sessionId', () => {
      const leaf: TileNode = { type: 'leaf', id: 't1', sessionId: null };
      expect(findLeafBySessionId(leaf, 'abc')).toBeUndefined();
    });
  });
});
