import type { SessionStatus } from '@shared/types';

export const STATUS_CONFIG: Record<
  SessionStatus,
  {
    label: string;
    dotAnimation: 'pulse' | 'pulse-slow' | 'blink' | 'glow' | 'none';
    dotOpacity: number;
    cssVar: string;
  }
> = {
  working: {
    label: 'Working',
    dotAnimation: 'pulse',
    dotOpacity: 1,
    cssVar: '--status-working',
  },
  thinking: {
    label: 'Thinking',
    dotAnimation: 'pulse-slow',
    dotOpacity: 1,
    cssVar: '--status-thinking',
  },
  waiting: {
    label: 'Awaiting Input',
    dotAnimation: 'blink',
    dotOpacity: 1,
    cssVar: '--status-waiting',
  },
  error: {
    label: 'Needs Attention',
    dotAnimation: 'glow',
    dotOpacity: 1,
    cssVar: '--status-error',
  },
  idle: {
    label: 'Idle',
    dotAnimation: 'none',
    dotOpacity: 0.6,
    cssVar: '--status-idle',
  },
  done: {
    label: 'Completed',
    dotAnimation: 'none',
    dotOpacity: 0.8,
    cssVar: '--status-done',
  },
};
