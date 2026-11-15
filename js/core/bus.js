/**
 * Kleiner Event-Bus: Module kommunizieren ohne harte Abhängigkeiten.
 * Beispiel: bus.on('library:change', render); bus.emit('library:change');
 */
const listeners = new Map();

export const bus = {
  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => this.off(event, handler);
  },
  off(event, handler) {
    listeners.get(event)?.delete(handler);
  },
  emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[bus] Fehler in Handler für "${event}"`, err);
      }
    }
  },
};

export default bus;
