import React from 'react';

const ZEN_ASPECT_WIDTH = 220;
const ZEN_ASPECT_HEIGHT = 260;

interface ZenOwlblobProps {
  size?: number;
  className?: string;
}

export function ZenOwlblob({
  size = 180,
  className,
}: ZenOwlblobProps): React.ReactElement {
  const height = (size / ZEN_ASPECT_WIDTH) * ZEN_ASPECT_HEIGHT;

  return (
    <svg
      width={size}
      height={height}
      viewBox={`0 0 ${ZEN_ASPECT_WIDTH} ${ZEN_ASPECT_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* Shadow */}
      <ellipse cx="110" cy="232" rx="55" ry="8" fill="#000" opacity="0.10" />

      {/* Breathing wrapper */}
      <g className="zen-breathe">
        {/* Body — slightly wider, lower center for seated pose */}
        <ellipse cx="110" cy="158" rx="72" ry="68" fill="#5c4a6a" />

        {/* Belly */}
        <ellipse cx="110" cy="168" rx="50" ry="48" fill="#7a6890" />

        {/* Belly stripes */}
        <path
          d="M 80 155 Q 110 165 140 155"
          stroke="#8a78a0"
          strokeWidth="2"
          fill="none"
          opacity="0.5"
        />
        <path
          d="M 83 170 Q 110 180 137 170"
          stroke="#8a78a0"
          strokeWidth="2"
          fill="none"
          opacity="0.5"
        />
        <path
          d="M 86 185 Q 110 195 134 185"
          stroke="#8a78a0"
          strokeWidth="2"
          fill="none"
          opacity="0.5"
        />

        {/* Head group */}
        <g>
          {/* Ears — slightly drooped */}
          <g transform="rotate(5, 58, 98)">
            <path d="M 58 98 L 55 78 L 72 92" fill="#5c4a6a" />
            <path d="M 60 96 L 58 82 L 70 92" fill="#7a6890" />
          </g>
          <g transform="rotate(-5, 162, 98)">
            <path d="M 162 98 L 165 78 L 148 92" fill="#5c4a6a" />
            <path d="M 160 96 L 162 82 L 150 92" fill="#7a6890" />
          </g>

          {/* Eye sockets */}
          <circle cx="86" cy="118" r="24" fill="#6a587a" />
          <circle cx="134" cy="118" r="24" fill="#6a587a" />

          {/* Inner eye fill (peaceful closed-eye look) */}
          <circle cx="86" cy="118" r="19" fill="#8a78a0" />
          <circle cx="134" cy="118" r="19" fill="#8a78a0" />

          {/* Closed eyes — downward arcs */}
          <path
            d="M 74 118 Q 86 128 98 118"
            stroke="#3d2b4f"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 122 118 Q 134 128 146 118"
            stroke="#3d2b4f"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />

          {/* Peaceful smile */}
          <path
            d="M 103 136 Q 110 142 117 136"
            stroke="#e8a838"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />

          {/* Cheek blush — slightly more visible in zen */}
          <circle cx="68" cy="130" r="8" fill="#e8a0c8" opacity="0.35" />{/* inline-ok: svg artwork */}
          <circle cx="152" cy="130" r="8" fill="#e8a0c8" opacity="0.35" />{/* inline-ok: svg artwork */}

          {/* Top hat (matches OwlblobMascot) */}
          <ellipse cx="110" cy="82" rx="30" ry="7" fill="#2d2d44" />{/* inline-ok: svg artwork */}
          <rect x="84" y="60" width="52" height="22" rx="4" fill="#2d2d44" />{/* inline-ok: svg artwork */}
          <rect x="88" y="55" width="44" height="9" rx="3" fill="#2d2d44" />{/* inline-ok: svg artwork */}
          <rect x="84" y="76" width="52" height="4" fill="#b8a0d8" />{/* inline-ok: svg artwork */}
        </g>

        {/* Wings — resting lower and flatter, animated with CSS */}
        <ellipse
          className="zen-wing-left"
          cx="40"
          cy="162"
          rx="14"
          ry="10"
          fill="#5c4a6a"
        />
        <ellipse
          className="zen-wing-right"
          cx="180"
          cy="162"
          rx="14"
          ry="10"
          fill="#5c4a6a"
        />

        {/* Crossed legs + toes with gentle sway */}
        <g className="zen-legs-sway">
          <path
            d="M 88 218 Q 100 228 110 220 Q 120 228 132 218"
            stroke="#e8a838"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          {/* Left toes */}
          <g className="zen-toes-wiggle">
            <path
              d="M 86 218 L 80 222 M 86 218 L 86 223 M 86 218 L 92 222"
              stroke="#e8a838"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </g>
          {/* Right toes */}
          <g className="zen-toes-wiggle zen-toes-wiggle--right">
            <path
              d="M 134 218 L 128 222 M 134 218 L 134 223 M 134 218 L 140 222"
              stroke="#e8a838"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        </g>
      </g>
    </svg>
  );
}
