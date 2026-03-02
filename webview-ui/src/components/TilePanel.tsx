import React, { useCallback } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { DetailPanel } from './DetailPanel';
import { EmptyTile } from './EmptyTile';
import { TileDropZones } from './TileDropZones';
import type { DropEdge } from '../hooks/useDragToTile';
import { UI_STRINGS } from '../config/strings';
import { vscode } from '../vscode';

interface TilePanelProps {
  tileId: string;
  sessionId: string;
}

const NOOP = (): void => {};

/**
 * Tile chrome wrapper around DetailPanel.
 * Renders a close button, active border, and delegates to DetailPanel
 * with a tileSessionId prop so it reads per-session Maps.
 */
export function TilePanel({ tileId, sessionId }: TilePanelProps): React.ReactElement {
  const session = useDashboardStore((s) =>
    s.sessions.find((sess) => sess.sessionId === sessionId)
  );
  const isActive = useDashboardStore((s) => s.activeTileId === tileId);
  const dragTarget = useDashboardStore((s) => s.dragToTileTarget);
  const setActiveTile = useDashboardStore((s) => s.setActiveTile);
  const closeTile = useDashboardStore((s) => s.closeTile);

  const handleClick = useCallback(() => {
    setActiveTile(tileId);
  }, [setActiveTile, tileId]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      vscode.postMessage({ type: 'tile:unsubscribe', sessionId });
      closeTile(tileId);
    },
    [closeTile, tileId, sessionId]
  );

  if (!session) {
    return <EmptyTile tileId={tileId} />;
  }

  return (
    <div
      data-tile-id={tileId}
      onClick={handleClick}
      style={{
        height: '100%',
        position: 'relative',
        outline: isActive ? '1px solid var(--focus-border)' : 'none', // inline-ok
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <TileDropZones
        activeEdge={dragTarget?.tileId === tileId ? (dragTarget.edge as DropEdge) : null}
      />
      {/* Close button */}
      <button
        onClick={handleClose}
        title={UI_STRINGS.TILE_CLOSE_TOOLTIP}
        style={{
          position: 'absolute',
          top: '4px', // inline-ok
          right: '4px', // inline-ok
          zIndex: 10, // inline-ok
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '3px', // inline-ok
          color: 'var(--fg-secondary)',
          cursor: 'pointer',
          padding: '2px 6px', // inline-ok
          fontSize: '11px', // inline-ok
          lineHeight: 1,
        }}
      >
        ✕{/* inline-ok: close icon character */}
      </button>
      <DetailPanel
        session={session}
        isExpanded={false}
        onToggleExpand={NOOP}
        tileSessionId={sessionId}
      />
    </div>
  );
}
