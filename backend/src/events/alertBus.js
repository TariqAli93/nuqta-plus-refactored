import { EventEmitter } from 'events';

/**
 * Centralized event bus for alert-related data changes.
 *
 * Services emit 'alerts.changed' after mutations that affect alert data
 * (stock changes, installment updates, sale completion/cancellation).
 * The WebSocket layer listens and pushes updates to subscribed clients.
 *
 * Using a single event type with a reason string keeps the contract simple
 * and avoids event storms — the WS handler debounces before broadcasting.
 */
const alertBus = new EventEmitter();

// Prevent memory leak warnings when many WS clients subscribe
alertBus.setMaxListeners(200);

export default alertBus;
