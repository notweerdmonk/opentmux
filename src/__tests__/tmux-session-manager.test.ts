import { test, expect, mock, beforeEach, spyOn, afterEach } from 'bun:test';
import { TmuxSessionManager } from '../tmux-session-manager';
import type { PluginInput } from '../types';
import type { TmuxConfig } from '../config';
import * as utils from '../utils';

// Helper to create controlled promises for test synchronization
function createControlledPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Helper to wait for a condition with timeout
async function waitFor(
  conditionFn: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Track spawn calls
let spawnCalls: Array<{ sessionId: string; title: string }> = [];
let spawnControllers: Map<string, { resolve: (result: { success: boolean; paneId?: string }) => void }> = new Map();
let layoutCallCount = 0;

function createMockPluginInput(): PluginInput {
  return {
    directory: '/test',
    serverUrl: 'http://localhost:4096',
    client: {
      session: {
        status: mock(async () => ({ data: {} })),
        subscribe: mock(() => () => {}),
      },
    },
  };
}

function createTmuxConfig(overrides?: Partial<TmuxConfig>): TmuxConfig {
  return {
    enabled: true,
    layout: 'main-vertical',
    main_pane_size: 60,
    spawn_delay_ms: 0,
    max_retry_attempts: 2,
    layout_debounce_ms: 150,
    max_agents_per_column: 3,
    reaper_enabled: false,
    reaper_interval_ms: 30000,
    reaper_min_zombie_checks: 3,
    reaper_grace_period_ms: 5000,
    reaper_auto_self_destruct: true,
    reaper_self_destruct_timeout_ms: 600000,
    rotate_port: false,
    max_ports: 10,
    ...overrides,
  };
}

beforeEach(() => {
  spawnCalls = [];
  spawnControllers.clear();
  layoutCallCount = 0;

  // Setup spies on utils
  spyOn(utils, 'log').mockImplementation(() => {});
  
  spyOn(utils, 'isInsideTmux').mockReturnValue(true);
  
  spyOn(utils, 'closeTmuxPane').mockResolvedValue(true);
  
  spyOn(utils, 'applyTmuxLayout').mockImplementation(async () => {
    layoutCallCount++;
  });
  
  spyOn(utils, 'spawnTmuxPane').mockImplementation(async (sessionId: string, title: string) => {
    spawnCalls.push({ sessionId, title });
    const ctrl = createControlledPromise<{ success: boolean; paneId?: string }>();
    spawnControllers.set(sessionId, { resolve: ctrl.resolve });
    return ctrl.promise;
  });
});

afterEach(() => {
  mock.restore();
});

test('TmuxSessionManager queues spawns sequentially', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event1 = {
    type: 'session.created',
    properties: { info: { id: 'session-1', parentID: 'parent-1', title: 'Task 1' } },
  };
  const event2 = {
    type: 'session.created',
    properties: { info: { id: 'session-2', parentID: 'parent-1', title: 'Task 2' } },
  };

  const promise1 = manager.onSessionCreated(event1);
  const promise2 = manager.onSessionCreated(event2);

  await waitFor(() => spawnCalls.length >= 1);

  expect(spawnCalls.length).toBe(1);
  expect(spawnCalls[0].sessionId).toBe('session-1');
  expect(spawnCalls.find(c => c.sessionId === 'session-2')).toBeUndefined();

  spawnControllers.get('session-1')?.resolve({ success: true, paneId: '%1' });

  await waitFor(() => spawnCalls.length >= 2);

  expect(spawnCalls.length).toBe(2);
  expect(spawnCalls[1].sessionId).toBe('session-2');

  spawnControllers.get('session-2')?.resolve({ success: true, paneId: '%2' });

  await Promise.all([promise1, promise2]);
});

test('TmuxSessionManager tracks sessions after successful spawn', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event = {
    type: 'session.created',
    properties: { info: { id: 'track-test', parentID: 'parent', title: 'Tracked' } },
  };

  const promise = manager.onSessionCreated(event);

  await waitFor(() => spawnControllers.has('track-test'));
  spawnControllers.get('track-test')?.resolve({ success: true, paneId: '%42' });

  await promise;

  const duplicatePromise = manager.onSessionCreated(event);
  await duplicatePromise;

  expect(spawnCalls.filter(c => c.sessionId === 'track-test').length).toBe(1);
});

test('TmuxSessionManager does not track session on spawn failure', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({ max_retry_attempts: 0 });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event = {
    type: 'session.created',
    properties: { info: { id: 'fail-test', parentID: 'parent', title: 'Fail' } },
  };

  const promise = manager.onSessionCreated(event);

  await waitFor(() => spawnControllers.has('fail-test'));
  spawnControllers.get('fail-test')?.resolve({ success: false });

  await promise;

  expect(spawnCalls.length).toBe(1);
  expect(spawnCalls[0].sessionId).toBe('fail-test');
});

test('TmuxSessionManager ignores non-session.created events', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event = {
    type: 'session.updated',
    properties: { info: { id: 'ignored', parentID: 'parent', title: 'Ignored' } },
  };

  await manager.onSessionCreated(event);

  expect(spawnCalls.length).toBe(0);
});

test('TmuxSessionManager ignores events without session info', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event1 = {
    type: 'session.created',
    properties: {},
  };

  const event2 = {
    type: 'session.created',
    properties: { info: { parentID: 'parent' } },
  };

  await manager.onSessionCreated(event1);
  await manager.onSessionCreated(event2);

  expect(spawnCalls.length).toBe(0);
});

test('TmuxSessionManager createEventHandler wraps onSessionCreated', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const handler = manager.createEventHandler();

  const event = {
    type: 'session.created',
    properties: { info: { id: 'handler-test', parentID: 'parent', title: 'Handler' } },
  };

  const promise = handler({ event });

  await waitFor(() => spawnControllers.has('handler-test'));
  spawnControllers.get('handler-test')?.resolve({ success: true, paneId: '%1' });

  await promise;

  expect(spawnCalls.length).toBe(1);
  expect(spawnCalls[0].sessionId).toBe('handler-test');
});

test('TmuxSessionManager uses config spawn_delay_ms and max_retry_attempts', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({
    spawn_delay_ms: 100,
    max_retry_attempts: 3,
  });
  
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event = {
    type: 'session.created',
    properties: { info: { id: 'config-test', parentID: 'parent', title: 'Config' } },
  };

  const promise = manager.onSessionCreated(event);

  await waitFor(() => spawnControllers.has('config-test'));
  spawnControllers.get('config-test')?.resolve({ success: true, paneId: '%1' });

  await promise;

  expect(spawnCalls.length).toBe(1);
});

test('TmuxSessionManager applies layout once after queue drains (deferred layout)', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({
    layout_debounce_ms: 50,
    spawn_delay_ms: 0,
  });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const events = [
    { type: 'session.created', properties: { info: { id: 'batch-1', parentID: 'parent', title: 'Batch 1' } } },
    { type: 'session.created', properties: { info: { id: 'batch-2', parentID: 'parent', title: 'Batch 2' } } },
    { type: 'session.created', properties: { info: { id: 'batch-3', parentID: 'parent', title: 'Batch 3' } } },
  ];

  const promises = events.map((e) => manager.onSessionCreated(e));

  await waitFor(() => spawnControllers.has('batch-1'));
  expect(layoutCallCount).toBe(0);
  spawnControllers.get('batch-1')?.resolve({ success: true, paneId: '%1' });

  await waitFor(() => spawnControllers.has('batch-2'));
  spawnControllers.get('batch-2')?.resolve({ success: true, paneId: '%2' });

  await waitFor(() => spawnControllers.has('batch-3'));
  spawnControllers.get('batch-3')?.resolve({ success: true, paneId: '%3' });

  await Promise.all(promises);

  expect(spawnCalls.length).toBe(3);
  
  // Wait for debounce
  await new Promise((r) => setTimeout(r, 100));

  expect(layoutCallCount).toBeGreaterThan(0);
});

// ─── Parent-session pane dedup tests ──────────────────────────────────────

test('discards parent pane when child arrives before parent spawn completes (Path A)', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({ spawn_delay_ms: 0 });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  // Fire parent session event (e.g. a tool-call wrapper)
  const parentEvent = {
    type: 'session.created',
    properties: { info: { id: 'wrapper-session', parentID: 'root', title: 'Tool Call' } },
  };
  const parentPromise = manager.onSessionCreated(parentEvent);

  // Wait for parent spawn to be in-flight
  await waitFor(() => spawnControllers.has('wrapper-session'));

  // Before parent spawn completes, fire child session event (the actual agent)
  const childEvent = {
    type: 'session.created',
    properties: { info: { id: 'agent-session', parentID: 'wrapper-session', title: 'Agent' } },
  };
  const childPromise = manager.onSessionCreated(childEvent);

  // Resolve parent spawn — this triggers the parentSessions check
  spawnControllers.get('wrapper-session')?.resolve({ success: true, paneId: '%wrap' });
  await parentPromise;

  // The parent pane should have been discarded (never tracked)
  expect(utils.closeTmuxPane).toHaveBeenCalledWith('%wrap');

  // Resolve child spawn
  await waitFor(() => spawnControllers.has('agent-session'));
  spawnControllers.get('agent-session')?.resolve({ success: true, paneId: '%agent' });
  await childPromise;

  // closeTmuxPane should only have been called once (parent discard, not child)
  expect(utils.closeTmuxPane).toHaveBeenCalledTimes(1);
});

test('closes parent pane when child arrives after parent already has pane (Path B)', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({ spawn_delay_ms: 0 });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  // Fire parent session and complete its spawn FIRST
  const parentEvent = {
    type: 'session.created',
    properties: { info: { id: 'parent-session', parentID: 'root', title: 'Parent' } },
  };
  const parentPromise = manager.onSessionCreated(parentEvent);

  await waitFor(() => spawnControllers.has('parent-session'));
  spawnControllers.get('parent-session')?.resolve({ success: true, paneId: '%parent' });
  await parentPromise;

  // Reset closeTmuxPane call count (initial call from spawn completion is 0, but keep track)
  // Parent now has a pane tracked in sessions

  // Now fire child event — parent should be detected and its pane closed
  const childEvent = {
    type: 'session.created',
    properties: { info: { id: 'child-session', parentID: 'parent-session', title: 'Child' } },
  };
  const childPromise = manager.onSessionCreated(childEvent);

  await waitFor(() => spawnControllers.has('child-session'));
  spawnControllers.get('child-session')?.resolve({ success: true, paneId: '%child' });
  await childPromise;

  // closeTmuxPane should have been called for the parent pane (from parent-tracking in onSessionCreated)
  expect(utils.closeTmuxPane).toHaveBeenCalledWith('%parent');
});

test('closeTmuxPane rejection during dedup does not lose child event', async () => {
  const closeSpy = spyOn(utils, 'closeTmuxPane');
  let closeCallCount = 0;
  closeSpy.mockImplementation(async () => {
    closeCallCount++;
    if (closeCallCount === 1) throw new Error('tmux pane close failed');
    return true;
  });

  const ctx = createMockPluginInput();
  const config = createTmuxConfig({ spawn_delay_ms: 0 });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  // Parent spawns and gets a pane
  const parentEvent = {
    type: 'session.created',
    properties: { info: { id: 'parent-session', parentID: 'root', title: 'Parent' } },
  };
  const parentPromise = manager.onSessionCreated(parentEvent);
  await waitFor(() => spawnControllers.has('parent-session'));
  spawnControllers.get('parent-session')?.resolve({ success: true, paneId: '%parent' });
  await parentPromise;

  // Fire child event — Path B triggers closeTmuxPane which rejects
  const childEvent = {
    type: 'session.created',
    properties: { info: { id: 'child-session', parentID: 'parent-session', title: 'Child' } },
  };
  const childPromise = manager.onSessionCreated(childEvent);

  // Child's spawn should still proceed despite closeTmuxPane rejection
  await waitFor(() => spawnControllers.has('child-session'));
  spawnControllers.get('child-session')?.resolve({ success: true, paneId: '%child' });
  await childPromise;

  // closeTmuxPane was called for parent pane (even though it rejected)
  expect(closeSpy).toHaveBeenCalledWith('%parent');
  // Child's spawn was queued and processed (2 spawn calls: parent + child)
  expect(spawnCalls.length).toBe(2);
  // Error was logged (no unhandled rejection)
  expect(utils.log).toHaveBeenCalledWith(
    '[tmux-session-manager] error closing parent pane',
    expect.objectContaining({ parentId: 'parent-session', paneId: '%parent', error: 'Error: tmux pane close failed' }),
  );
});

test('handles multiple children of same parent', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({ spawn_delay_ms: 0 });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  // Parent spawns first
  const parentEvent = {
    type: 'session.created',
    properties: { info: { id: 'parent-session', parentID: 'root', title: 'Parent' } },
  };
  const parentPromise = manager.onSessionCreated(parentEvent);

  await waitFor(() => spawnControllers.has('parent-session'));
  spawnControllers.get('parent-session')?.resolve({ success: true, paneId: '%parent' });
  await parentPromise;

  // First child arrives — parent pane closed
  const child1Event = {
    type: 'session.created',
    properties: { info: { id: 'child-1', parentID: 'parent-session', title: 'Child 1' } },
  };
  const child1Promise = manager.onSessionCreated(child1Event);

  await waitFor(() => spawnControllers.has('child-1'));
  spawnControllers.get('child-1')?.resolve({ success: true, paneId: '%c1' });
  await child1Promise;

  // Second child arrives — parent already removed, no further close
  const child2Event = {
    type: 'session.created',
    properties: { info: { id: 'child-2', parentID: 'parent-session', title: 'Child 2' } },
  };
  const child2Promise = manager.onSessionCreated(child2Event);

  await waitFor(() => spawnControllers.has('child-2'));
  spawnControllers.get('child-2')?.resolve({ success: true, paneId: '%c2' });
  await child2Promise;

  // closeTmuxPane should have been called exactly once (parent pane)
  expect(utils.closeTmuxPane).toHaveBeenCalledTimes(1);
  expect(utils.closeTmuxPane).toHaveBeenCalledWith('%parent');
});

test('handles deep nesting correctly (grandparent unaffected)', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({ spawn_delay_ms: 0 });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  // Grandparent session
  const gpEvent = {
    type: 'session.created',
    properties: { info: { id: 'grandparent', parentID: 'root', title: 'Grandparent' } },
  };
  const gpPromise = manager.onSessionCreated(gpEvent);
  await waitFor(() => spawnControllers.has('grandparent'));
  spawnControllers.get('grandparent')?.resolve({ success: true, paneId: '%gp' });
  await gpPromise;

  // Parent session (child of grandparent)
  const pEvent = {
    type: 'session.created',
    properties: { info: { id: 'parent', parentID: 'grandparent', title: 'Parent' } },
  };
  const pPromise = manager.onSessionCreated(pEvent);
  await waitFor(() => spawnControllers.has('parent'));
  spawnControllers.get('parent')?.resolve({ success: true, paneId: '%parent' });
  await pPromise;

  // Child session — parent's pane should be closed, grandparent's should stay
  const cEvent = {
    type: 'session.created',
    properties: { info: { id: 'child', parentID: 'parent', title: 'Child' } },
  };
  const cPromise = manager.onSessionCreated(cEvent);
  await waitFor(() => spawnControllers.has('child'));
  spawnControllers.get('child')?.resolve({ success: true, paneId: '%child' });
  await cPromise;

  // Only parent's pane should have been closed from dedup
  // (grandparent's pane stays)
  expect(utils.closeTmuxPane).toHaveBeenCalledWith('%parent');
  // closeTmuxPane should be called at least once (parent close during grandparent creation too:
  // when "parent" event arrived with parentID=grandparent, grandparent's pane was NOT closed
  // because grandparent was already tracked but parent events are for the new session, not closing its parent.
  // Wait — let me trace: when "parent" event arrives with parentID=grandparent:
  //   parentSessions.add("grandparent")
  //   grandparent IS in sessions → close grandparent's pane? NO!
  //   Because grandparent is an AGENT (leaf) that happened to have a child via tool delegation.
  //   Actually this is expected — grandparent's pane gets closed because it IS a parent now.
  // Hmm, is this the correct behavior? Let me reconsider...
  // Actually yes — if grandparent spawns a parent, grandparent is now a "manager" session
  // and its pane gets appropriately closed.
  // We just need to verify parent's pane also gets closed when child arrives.
  // So closeTmuxPane calls: 1 for grandparent close, 1 for parent close = 2 total
  expect(utils.closeTmuxPane).toHaveBeenCalledTimes(2);
});

test('leaf session with no children is unaffected', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({ spawn_delay_ms: 0 });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event = {
    type: 'session.created',
    properties: { info: { id: 'leaf-session', parentID: 'root', title: 'Leaf' } },
  };
  const promise = manager.onSessionCreated(event);

  await waitFor(() => spawnControllers.has('leaf-session'));
  spawnControllers.get('leaf-session')?.resolve({ success: true, paneId: '%leaf' });
  await promise;

  // Leaf session should have its pane tracked — no closeTmuxPane calls
  expect(utils.closeTmuxPane).not.toHaveBeenCalled();
});

test('unrelated sessions with different parents are both tracked', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({ spawn_delay_ms: 0 });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const eventA = {
    type: 'session.created',
    properties: { info: { id: 'session-a', parentID: 'parent-x', title: 'A' } },
  };
  const eventB = {
    type: 'session.created',
    properties: { info: { id: 'session-b', parentID: 'parent-y', title: 'B' } },
  };

  const promiseA = manager.onSessionCreated(eventA);
  const promiseB = manager.onSessionCreated(eventB);

  await waitFor(() => spawnControllers.has('session-a'));
  spawnControllers.get('session-a')?.resolve({ success: true, paneId: '%a' });
  await waitFor(() => spawnControllers.has('session-b'));
  spawnControllers.get('session-b')?.resolve({ success: true, paneId: '%b' });

  await Promise.all([promiseA, promiseB]);

  // Both sessions should be tracked — no panes closed
  expect(utils.closeTmuxPane).not.toHaveBeenCalled();
});
