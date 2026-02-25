import React from 'react';
import type { SessionStatus } from '@shared/types';
import { STATUS_CONFIG } from '../config/statusConfig';

interface StatusDotProps {
  status: SessionStatus;
  size?: number;
}

export function StatusDot({ status, size = 8 }: StatusDotProps): React.ReactElement {
  const config = STATUS_CONFIG[status];
  const animationName = config.dotAnimation !== 'none' ? config.dotAnimation : undefined;
  const animationDuration =
    config.dotAnimation === 'pulse'
      ? '1.5s'
      : config.dotAnimation === 'pulse-slow'
        ? '2s'
        : config.dotAnimation === 'blink'
          ? '1.5s'
          : config.dotAnimation === 'glow'
            ? '2s'
            : undefined;

  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: `var(${config.cssVar})`,
        opacity: config.dotOpacity,
        animation: animationName
          ? `${animationName} ${animationDuration} infinite`
          : undefined,
        flexShrink: 0,
      }}
    />
  );
}
