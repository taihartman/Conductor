/**
 * Playwright script to capture a dashboard screenshot for the VS Code Marketplace.
 *
 * Usage:
 *   cd webview-ui && npm run build && cd ..
 *   npx playwright test scripts/capture-screenshot.ts
 *
 * Output: media/dashboard-screenshot.png (1280x800)
 */
import { test } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';

const DIST_DIR = join(__dirname, '..', 'webview-ui', 'dist');
const OUTPUT_PATH = join(__dirname, '..', 'media', 'dashboard-screenshot.png');
const PORT = 9182;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function startStaticServer(): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      let filePath = join(DIST_DIR, req.url === '/' ? 'index.html' : req.url!);
      if (!existsSync(filePath)) {
        // SPA fallback
        filePath = join(DIST_DIR, 'index.html');
      }
      try {
        const data = await readFile(filePath);
        const ext = extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

/** Mock session data showcasing different statuses. */
function buildMockState() {
  const now = new Date();
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

  const sessions = [
    {
      sessionId: 'sess-001',
      slug: 'a1b2c3d4',
      summary: '',
      status: 'working',
      model: 'claude-opus-4-6',
      gitBranch: 'feat/auth-system',
      cwd: '/home/user/projects/web-app',
      startedAt: minutesAgo(45),
      lastActivityAt: minutesAgo(0),
      turnCount: 32,
      totalInputTokens: 284500,
      totalOutputTokens: 52300,
      totalCacheReadTokens: 180000,
      totalCacheCreationTokens: 45000,
      isSubAgent: false,
      isArtifact: false,
      filePath: '/tmp/mock.jsonl',
      autoName: 'Implementing OAuth2 authentication',
      lastToolName: 'Edit',
      lastToolInput: 'src/auth/oauth-handler.ts',
      lastAssistantText:
        "I'll update the OAuth callback handler to validate the state parameter...",
      childAgents: [
        {
          sessionId: 'sess-005',
          slug: 'e5f6g7h8',
          status: 'done' as const,
          description: 'Writing auth middleware tests',
          totalInputTokens: 45000,
          totalOutputTokens: 12000,
          lastActivityAt: minutesAgo(5),
        },
      ],
    },
    {
      sessionId: 'sess-002',
      slug: 'b2c3d4e5',
      summary: '',
      status: 'thinking',
      model: 'claude-sonnet-4-6',
      gitBranch: 'refactor/db-layer',
      cwd: '/home/user/projects/api-server',
      startedAt: minutesAgo(20),
      lastActivityAt: minutesAgo(0),
      turnCount: 14,
      totalInputTokens: 156000,
      totalOutputTokens: 28700,
      totalCacheReadTokens: 98000,
      totalCacheCreationTokens: 22000,
      isSubAgent: false,
      isArtifact: false,
      filePath: '/tmp/mock2.jsonl',
      autoName: 'Refactoring database connection pool',
      lastAssistantText: 'Analyzing the connection pooling strategy to identify the bottleneck...',
    },
    {
      sessionId: 'sess-003',
      slug: 'c3d4e5f6',
      summary: '',
      status: 'waiting',
      model: 'claude-sonnet-4-6',
      gitBranch: 'test/unit-coverage',
      cwd: '/home/user/projects/web-app',
      startedAt: minutesAgo(12),
      lastActivityAt: minutesAgo(1),
      turnCount: 8,
      totalInputTokens: 89000,
      totalOutputTokens: 18200,
      totalCacheReadTokens: 52000,
      totalCacheCreationTokens: 11000,
      isSubAgent: false,
      isArtifact: false,
      filePath: '/tmp/mock3.jsonl',
      autoName: 'Adding unit tests for user service',
      lastToolName: 'Bash',
      lastToolInput: 'npm run test -- --watch',
      pendingQuestion: {
        question: 'Should I also add integration tests for the database layer?',
        options: [
          { label: 'Yes', description: 'Add integration tests with a test database' },
          { label: 'No', description: 'Unit tests are sufficient for now' },
        ],
        multiSelect: false,
      },
    },
    {
      sessionId: 'sess-004',
      slug: 'd4e5f6g7',
      summary: '',
      status: 'done',
      model: 'claude-haiku-4-5',
      gitBranch: 'fix/ci-pipeline',
      cwd: '/home/user/projects/infra',
      startedAt: minutesAgo(60),
      lastActivityAt: minutesAgo(8),
      turnCount: 6,
      totalInputTokens: 42000,
      totalOutputTokens: 8900,
      totalCacheReadTokens: 28000,
      totalCacheCreationTokens: 5000,
      isSubAgent: false,
      isArtifact: false,
      filePath: '/tmp/mock4.jsonl',
      autoName: 'Fix CI pipeline timeout',
      lastToolName: 'Write',
      lastToolInput: '.github/workflows/ci.yml',
    },
  ];

  const activities = [
    {
      id: 'evt-1',
      sessionId: 'sess-001',
      sessionSlug: 'a1b2c3d4',
      timestamp: minutesAgo(2),
      type: 'tool_call' as const,
      toolName: 'Read',
      toolInput: 'src/auth/oauth-handler.ts',
    },
    {
      id: 'evt-2',
      sessionId: 'sess-001',
      sessionSlug: 'a1b2c3d4',
      timestamp: minutesAgo(1),
      type: 'tool_result' as const,
      isError: false,
    },
    {
      id: 'evt-3',
      sessionId: 'sess-001',
      sessionSlug: 'a1b2c3d4',
      timestamp: minutesAgo(1),
      type: 'tool_call' as const,
      toolName: 'Edit',
      toolInput: 'src/auth/oauth-handler.ts → validateState()',
    },
    {
      id: 'evt-4',
      sessionId: 'sess-002',
      sessionSlug: 'b2c3d4e5',
      timestamp: minutesAgo(0),
      type: 'text' as const,
      text: 'Analyzing the connection pooling strategy...',
    },
    {
      id: 'evt-5',
      sessionId: 'sess-003',
      sessionSlug: 'c3d4e5f6',
      timestamp: minutesAgo(1),
      type: 'tool_call' as const,
      toolName: 'Bash',
      toolInput: 'npm run test -- --watch',
    },
  ];

  const toolStats = [
    { toolName: 'Edit', callCount: 48, errorCount: 2, totalDurationMs: 14400, avgDurationMs: 300 },
    { toolName: 'Read', callCount: 85, errorCount: 0, totalDurationMs: 8500, avgDurationMs: 100 },
    { toolName: 'Bash', callCount: 34, errorCount: 5, totalDurationMs: 68000, avgDurationMs: 2000 },
    { toolName: 'Write', callCount: 12, errorCount: 0, totalDurationMs: 3600, avgDurationMs: 300 },
    { toolName: 'Grep', callCount: 27, errorCount: 0, totalDurationMs: 2700, avgDurationMs: 100 },
    { toolName: 'Glob', callCount: 19, errorCount: 0, totalDurationMs: 1900, avgDurationMs: 100 },
    { toolName: 'Task', callCount: 4, errorCount: 1, totalDurationMs: 48000, avgDurationMs: 12000 },
  ];

  const tokenSummaries = [
    {
      sessionId: 'sess-001',
      sessionSlug: 'a1b2c3d4',
      model: 'claude-opus-4-6',
      inputTokens: 284500,
      outputTokens: 52300,
      cacheReadTokens: 180000,
      cacheCreationTokens: 45000,
      estimatedCostUsd: 8.4523,
    },
    {
      sessionId: 'sess-002',
      sessionSlug: 'b2c3d4e5',
      model: 'claude-sonnet-4-6',
      inputTokens: 156000,
      outputTokens: 28700,
      cacheReadTokens: 98000,
      cacheCreationTokens: 22000,
      estimatedCostUsd: 1.0284,
    },
    {
      sessionId: 'sess-003',
      sessionSlug: 'c3d4e5f6',
      model: 'claude-sonnet-4-6',
      inputTokens: 89000,
      outputTokens: 18200,
      cacheReadTokens: 52000,
      cacheCreationTokens: 11000,
      estimatedCostUsd: 0.5817,
    },
    {
      sessionId: 'sess-004',
      sessionSlug: 'd4e5f6g7',
      model: 'claude-haiku-4-5',
      inputTokens: 42000,
      outputTokens: 8900,
      cacheReadTokens: 28000,
      cacheCreationTokens: 5000,
      estimatedCostUsd: 0.0746,
    },
  ];

  return { sessions, activities, toolStats, tokenSummaries };
}

test('capture dashboard screenshot', async ({ page }) => {
  const server = await startStaticServer();

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });

    // Wait for React to mount
    await page.waitForSelector('#root');
    await page.waitForTimeout(500);

    // Inject mock data via postMessage (same mechanism the extension uses)
    const mock = buildMockState();
    await page.evaluate((data) => {
      window.postMessage(
        {
          type: 'state:full',
          sessions: data.sessions,
          activities: data.activities,
          conversation: [],
          toolStats: data.toolStats,
          tokenSummaries: data.tokenSummaries,
          isNestedSession: false,
          focusedSessionId: null,
        },
        '*'
      );
    }, mock);

    // Wait for the store to process and UI to re-render
    await page.waitForTimeout(800);

    // Take screenshot
    await page.screenshot({
      path: OUTPUT_PATH,
      type: 'png',
    });

    console.log(`Screenshot saved to ${OUTPUT_PATH}`);
  } finally {
    server.close();
  }
});
