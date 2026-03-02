import React from 'react';
import type { DropEdge } from '../hooks/useDragToTile';
import { COLORS } from '../config/colors';

interface TileDropZonesProps {
  /** The edge currently being hovered (null = no highlight). */
  activeEdge: DropEdge | null;
}

/**
 * Renders 4 edge overlays + 1 center overlay inside a tile.
 * During a drag, the active zone highlights with a semi-transparent fill.
 * CSS-positioned, visibility toggled by parent state — no DOM events needed.
 */
export function TileDropZones({ activeEdge }: TileDropZonesProps): React.ReactElement {
  return (
    <>
      <DropZone edge="left" active={activeEdge === 'left'} />
      <DropZone edge="right" active={activeEdge === 'right'} />
      <DropZone edge="top" active={activeEdge === 'top'} />
      <DropZone edge="bottom" active={activeEdge === 'bottom'} />
      <DropZone edge="center" active={activeEdge === 'center'} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Internal zone renderer
// ---------------------------------------------------------------------------

interface DropZoneProps {
  edge: DropEdge;
  active: boolean;
}

const ZONE_SIZE = '25%'; // inline-ok: matches DROP_EDGE_THRESHOLD

function getZoneStyle(edge: DropEdge, active: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    transition: 'background 150ms ease',
    zIndex: 5, // inline-ok
    background: active
      ? edge === 'center'
        ? COLORS.TILE_DROP_ZONE_CENTER
        : COLORS.TILE_DROP_ZONE_ACTIVE
      : 'transparent',
    borderRadius: '2px', // inline-ok
  };

  switch (edge) {
    case 'left':
      return { ...base, top: 0, left: 0, bottom: 0, width: ZONE_SIZE };
    case 'right':
      return { ...base, top: 0, right: 0, bottom: 0, width: ZONE_SIZE };
    case 'top':
      return { ...base, top: 0, left: ZONE_SIZE, right: ZONE_SIZE, height: ZONE_SIZE };
    case 'bottom':
      return { ...base, bottom: 0, left: ZONE_SIZE, right: ZONE_SIZE, height: ZONE_SIZE };
    case 'center':
      return {
        ...base,
        top: ZONE_SIZE,
        left: ZONE_SIZE,
        right: ZONE_SIZE,
        bottom: ZONE_SIZE,
      };
  }
}

function DropZone({ edge, active }: DropZoneProps): React.ReactElement {
  return <div style={getZoneStyle(edge, active)} />;
}
