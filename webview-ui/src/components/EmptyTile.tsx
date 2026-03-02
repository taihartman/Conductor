import React from 'react';
import { COLORS } from '../config/colors';
import { UI_STRINGS } from '../config/strings';
import { TileDropZones } from './TileDropZones';
import type { DropEdge } from '../hooks/useDragToTile';
import { useDashboardStore } from '../store/dashboardStore';

interface EmptyTileProps {
  tileId: string;
}

/**
 * Placeholder rendered when a tile leaf has no session assigned.
 * Displays instructional text and accepts drop events.
 */
export function EmptyTile({ tileId }: EmptyTileProps): React.ReactElement {
  const dragTarget = useDashboardStore((s) => s.dragToTileTarget);

  return (
    <div
      data-tile-id={tileId}
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        background: COLORS.TILE_EMPTY_BG,
        border: `1px dashed ${COLORS.TILE_EMPTY_BORDER}`,
        borderRadius: '4px', // inline-ok
        color: 'var(--fg-secondary)',
        fontSize: '13px', // inline-ok
        userSelect: 'none',
      }}
    >
      <TileDropZones
        activeEdge={dragTarget?.tileId === tileId ? (dragTarget.edge as DropEdge) : null}
      />
      {UI_STRINGS.TILE_EMPTY_PROMPT}
    </div>
  );
}
