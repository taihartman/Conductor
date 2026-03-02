import React, { useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { TileNode } from '@shared/types';
import { useDashboardStore } from '../store/dashboardStore';
import { TilePanel } from './TilePanel';
import { EmptyTile } from './EmptyTile';

interface TilingWorkspaceProps {
  root: TileNode;
}

/**
 * Recursively renders the TileNode tree using nested react-resizable-panels.
 * Leaf nodes render TilePanel or EmptyTile; split nodes render nested PanelGroups.
 */
export function TilingWorkspace({ root }: TilingWorkspaceProps): React.ReactElement {
  const setTileSizes = useDashboardStore((s) => s.setTileSizes);

  if (root.type === 'leaf') {
    return root.sessionId ? (
      <TilePanel tileId={root.id} sessionId={root.sessionId} />
    ) : (
      <EmptyTile tileId={root.id} />
    );
  }

  return (
    <TileSplit node={root} onSizesChange={setTileSizes}>
      <TilingWorkspace root={root.children[0]} />
      <TilingWorkspace root={root.children[1]} />
    </TileSplit>
  );
}

// ---------------------------------------------------------------------------
// Internal split node renderer
// ---------------------------------------------------------------------------

interface TileSplitProps {
  node: TileNode & { type: 'split' };
  onSizesChange: (splitId: string, sizes: [number, number]) => void;
  children: [React.ReactElement, React.ReactElement];
}

function TileSplit({ node, onSizesChange, children }: TileSplitProps): React.ReactElement {
  const handleLayoutChange = useCallback(
    (layout: Record<string, number>) => {
      const size0 = layout[`${node.id}-0`];
      const size1 = layout[`${node.id}-1`];
      if (size0 !== undefined && size1 !== undefined) {
        onSizesChange(node.id, [size0, size1]);
      }
    },
    [node.id, onSizesChange]
  );

  return (
    <Group
      orientation={node.direction}
      defaultLayout={{ [`${node.id}-0`]: node.sizes[0], [`${node.id}-1`]: node.sizes[1] }}
      onLayoutChanged={handleLayoutChange}
      style={{ flex: 1, overflow: 'hidden' }}
    >
      <Panel
        id={`${node.id}-0`}
        minSize="10%"
        style={{
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {children[0]}
      </Panel>
      <Separator />
      <Panel
        id={`${node.id}-1`}
        minSize="10%"
        style={{
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {children[1]}
      </Panel>
    </Group>
  );
}
