import alertService from '../services/alertService.js';
import alertBus from '../events/alertBus.js';
import { getDb } from '../db.js';
import { users } from '../models/index.js';
import { eq } from 'drizzle-orm';
import { hasPermission } from '../auth/permissionMatrix.js';

/**
 * WebSocket route for real-time alert updates.
 *
 * Auth flow (browser-safe — no query-string tokens):
 *   1. Client opens ws://host:port/api/alerts/ws (unauthenticated)
 *   2. Client sends JSON: { type: "auth", token: "<jwt>" }
 *   3. Server verifies JWT + permission, then subscribes the socket
 *   4. Server sends { type: "snapshot", data: <full alerts> }
 *   5. On data changes, server sends { type: "snapshot", data: <fresh alerts> }
 *
 * We chose to send a full snapshot (option b from the spec) rather than an
 * invalidate event because:
 *   - Alert data is small (dozens of items, not thousands)
 *   - A snapshot avoids an extra HTTP round-trip on the frontend
 *   - It eliminates a race between the invalidate and the subsequent fetch
 *   - It keeps the frontend store update path simpler (one code path)
 */
export default async function alertWsRoutes(fastify) {
  // Track authenticated sockets so we can broadcast to them
  const clients = new Set();

  // Debounce: after an 'alerts.changed' event, wait briefly before
  // broadcasting so that burst mutations (e.g. a sale creating multiple
  // installments + stock decrements) collapse into a single push.
  let broadcastTimer = null;
  const DEBOUNCE_MS = 500;

  function scheduleBroadcast() {
    if (broadcastTimer) return; // already scheduled
    broadcastTimer = setTimeout(async () => {
      broadcastTimer = null;
      if (clients.size === 0) return;

      try {
        const data = await alertService.getAllAlerts();
        const message = JSON.stringify({ type: 'snapshot', data });
        for (const ws of clients) {
          if (ws.readyState === 1) {
            ws.send(message);
          }
        }
      } catch (err) {
        fastify.log.error('Failed to broadcast alert snapshot:', err.message);
      }
    }, DEBOUNCE_MS);
  }

  alertBus.on('alerts.changed', scheduleBroadcast);

  // WebSocket endpoint
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    let authenticated = false;
    let authTimeout = null;

    // Give the client 10 seconds to authenticate after connecting
    authTimeout = setTimeout(() => {
      if (!authenticated) {
        socket.send(JSON.stringify({ type: 'error', message: 'Auth timeout' }));
        socket.close(4001, 'Auth timeout');
      }
    }, 10000);

    socket.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      // Handle auth message
      if (msg.type === 'auth' && typeof msg.token === 'string') {
        if (authenticated) return; // already authenticated

        try {
          // Verify JWT using the same Fastify JWT instance
          const decoded = fastify.jwt.verify(msg.token);

          // Fetch user from DB (same as auth plugin)
          const db = await getDb();
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, decoded.id))
            .limit(1);

          if (!user || !user.isActive) {
            socket.send(JSON.stringify({ type: 'auth', success: false, message: 'User inactive' }));
            socket.close(4003, 'User inactive');
            return;
          }

          // Check permission — same as GET /api/alerts
          if (!hasPermission('sales:read', user.role)) {
            socket.send(
              JSON.stringify({ type: 'auth', success: false, message: 'Permission denied' })
            );
            socket.close(4003, 'Permission denied');
            return;
          }

          // Authenticated
          authenticated = true;
          clearTimeout(authTimeout);
          clients.add(socket);

          socket.send(JSON.stringify({ type: 'auth', success: true }));

          // Send initial snapshot
          const data = await alertService.getAllAlerts();
          socket.send(JSON.stringify({ type: 'snapshot', data }));
        } catch (err) {
          socket.send(
            JSON.stringify({ type: 'auth', success: false, message: 'Invalid token' })
          );
          socket.close(4001, 'Invalid token');
        }
        return;
      }

      // Ignore any other messages from unauthenticated sockets
      if (!authenticated) {
        socket.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      clients.delete(socket);
    });

    socket.on('error', () => {
      clearTimeout(authTimeout);
      clients.delete(socket);
    });
  });
}
