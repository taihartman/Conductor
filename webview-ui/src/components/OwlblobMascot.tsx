import React, { useRef } from 'react';
import { useOwlblobIdle } from '../hooks/useOwlblobIdle';
import type { OwlblobIdleRefs } from '../hooks/useOwlblobIdle';

const OB_ASPECT_WIDTH = 220;
const OB_ASPECT_HEIGHT = 260;

interface OwlblobMascotProps {
  size?: number;
  animated?: boolean;
  className?: string;
}

export function OwlblobMascot({
  size = OB_ASPECT_WIDTH,
  animated = true,
  className,
}: OwlblobMascotProps): React.ReactElement {
  const headRef = useRef<SVGGElement>(null);
  const earLeftRef = useRef<SVGGElement>(null);
  const earRightRef = useRef<SVGGElement>(null);
  const eyelidLeftRef = useRef<SVGPathElement>(null);
  const eyelidRightRef = useRef<SVGPathElement>(null);
  const wingLeftRef = useRef<SVGEllipseElement>(null);
  const wingRightRef = useRef<SVGEllipseElement>(null);
  const rootRef = useRef<SVGGElement>(null);

  const refs: OwlblobIdleRefs = {
    head: headRef,
    earLeft: earLeftRef,
    earRight: earRightRef,
    eyelidLeft: eyelidLeftRef,
    eyelidRight: eyelidRightRef,
    wingLeft: wingLeftRef,
    wingRight: wingRightRef,
    root: rootRef,
  };

  useOwlblobIdle(refs, { enabled: animated });

  const height = (size / OB_ASPECT_WIDTH) * OB_ASPECT_HEIGHT;

  return (
    <svg
      width={size}
      height={height}
      viewBox={`0 0 ${OB_ASPECT_WIDTH} ${OB_ASPECT_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* Musical notes */}
      <text className="ob-note-float" x="30" y="35" fontSize="17" fill="#b8a0d8" opacity="0.5">
        &#9835;
      </text>
      <text
        className="ob-note-float ob-note-float--delayed"
        x="178"
        y="45"
        fontSize="13"
        fill="#b8a0d8"
        opacity="0.3"
      >
        &#9834;
      </text>

      {/* Outer float layer (vertical bob) */}
      <g className="ob-float-layer">
        {/* Shadow */}
        <ellipse cx="110" cy="228" rx="50" ry="8" fill="#000" opacity="0.12" />

        {/* Inner root layer (idle behaviors) */}
        <g ref={rootRef} data-ob-root>
          {/* Body */}
          <ellipse cx="110" cy="150" rx="68" ry="72" fill="#5c4a6a" />

          {/* Belly */}
          <ellipse cx="110" cy="162" rx="48" ry="50" fill="#7a6890" />

          {/* Belly stripes */}
          <path
            d="M 82 148 Q 110 158 138 148"
            stroke="#8a78a0"
            strokeWidth="2"
            fill="none"
            opacity="0.5"
          />
          <path
            d="M 85 164 Q 110 174 135 164"
            stroke="#8a78a0"
            strokeWidth="2"
            fill="none"
            opacity="0.5"
          />
          <path
            d="M 88 180 Q 110 190 132 180"
            stroke="#8a78a0"
            strokeWidth="2"
            fill="none"
            opacity="0.5"
          />

          {/* Head group */}
          <g ref={headRef} data-ob-head>
            {/* Ears - outer */}
            <g ref={earLeftRef} data-ob-ear-left>
              <path d="M 58 98 L 55 78 L 72 92" fill="#5c4a6a" />
              <path d="M 60 96 L 58 82 L 70 92" fill="#7a6890" />
            </g>
            <g ref={earRightRef} data-ob-ear-right>
              <path d="M 162 98 L 165 78 L 148 92" fill="#5c4a6a" />
              <path d="M 160 96 L 162 82 L 150 92" fill="#7a6890" />
            </g>

            {/* Eye sockets */}
            <circle cx="86" cy="118" r="24" fill="#6a587a" />
            <circle cx="134" cy="118" r="24" fill="#6a587a" />

            {/* Irises */}
            <circle cx="86" cy="118" r="19" fill="#8a78a0" />
            <circle cx="134" cy="118" r="19" fill="#8a78a0" />

            {/* Eyelid arcs (animated for blink) */}
            <path
              ref={eyelidLeftRef}
              data-ob-eyelid-left
              d="M 72 116 Q 86 104 100 116"
              stroke="#3d2b4f"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <path
              ref={eyelidRightRef}
              data-ob-eyelid-right
              d="M 120 116 Q 134 104 148 116"
              stroke="#3d2b4f"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />

            {/* Beak */}
            <path d="M 105 132 L 110 142 L 115 132 Z" fill="#e8a838" />

            {/* Cheek blush */}
            <circle cx="68" cy="130" r="7" fill="#e8a0c8" opacity="0.3" />
            <circle cx="152" cy="130" r="7" fill="#e8a0c8" opacity="0.3" />

            {/* Top hat */}
            <ellipse cx="110" cy="82" rx="30" ry="7" fill="#2d2d44" />
            <rect x="84" y="60" width="52" height="22" rx="4" fill="#2d2d44" />
            <rect x="88" y="55" width="44" height="9" rx="3" fill="#2d2d44" />
            <rect x="84" y="76" width="52" height="4" fill="#b8a0d8" />
          </g>

          {/* Wings */}
          <ellipse
            ref={wingLeftRef}
            data-ob-wing-left
            cx="44"
            cy="152"
            rx="16"
            ry="12"
            fill="#5c4a6a"
            transform="rotate(-5 44 152)"
          />
          <ellipse
            ref={wingRightRef}
            data-ob-wing-right
            cx="176"
            cy="152"
            rx="16"
            ry="12"
            fill="#5c4a6a"
            transform="rotate(5 176 152)"
          />

          {/* Feet */}
          <path
            d="M 90 220 L 82 228 M 90 220 L 90 229 M 90 220 L 98 228"
            stroke="#e8a838"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 130 220 L 122 228 M 130 220 L 130 229 M 130 220 L 138 228"
            stroke="#e8a838"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}
