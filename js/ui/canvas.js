/**
 * Stift-/Finger-Zeichenfläche mit Pointer Events.
 *
 * - funktioniert mit Stift, Finger und Maus
 * - Palm Rejection: sobald ein Stift benutzt wurde, werden Handflächen-
 *   Berührungen ignoriert; sehr breite Touch-Punkte gelten als Handfläche
 * - glatte Linien durch Zwischenpunkte und runde Linienenden
 * - Undo, Löschen, Hochauflösend (devicePixelRatio)
 */
export class DrawingPad {
  constructor(canvas, { onChange = null, ariaHint = true } = {}) {
    if (!canvas) throw new Error("DrawingPad braucht ein Canvas-Element.");
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.strokes = [];
    this.current = null;
    this.activePointerId = null;
    this.hasPen = false;
    this.lastPenAt = 0;
    this.onChange = onChange;
    this.enabled = true;
    this.dpr = 1;
    this.width = 1;
    this.height = 1;
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onResize = this._onResize.bind(this);

    if (ariaHint) {
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        "Zeichenfläche. Schreibe das englische Wort mit dem Stift oder Finger. Alternativ kannst du tippen."
      );
    }

    canvas.addEventListener("pointerdown", this._onDown);
    canvas.addEventListener("pointermove", this._onMove);
    canvas.addEventListener("pointerup", this._onUp);
    canvas.addEventListener("pointercancel", this._onUp);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("resize", this._onResize);
    this._resize();
    // Nach Layout-Änderungen (z. B. Modal) noch einmal messen.
    requestAnimationFrame(() => this._resize());
  }

  _onResize() {
    this._resize();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._redraw();
  }

  _isPalm(event) {
    // Stift hat Vorrang: Nach Stiftnutzung keine Touch-Eingabe mehr.
    if (event.pointerType === "touch") {
      if (this.hasPen && Date.now() - this.lastPenAt < 15 * 60 * 1000) return true;
      // Sehr große Berührungsfläche = Handballen.
      if ((event.width || 0) > 48 || (event.height || 0) > 48) return true;
    }
    return false;
  }

  _onDown(event) {
    if (!this.enabled) return;
    if (event.pointerType === "pen") {
      this.hasPen = true;
      this.lastPenAt = Date.now();
    }
    if (this._isPalm(event)) return;
    if (this.activePointerId !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.preventDefault();
    this.activePointerId = event.pointerId;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* nicht kritisch */
    }

    const point = this._point(event);
    this.current = {
      pointerType: event.pointerType,
      points: [point],
    };
    this.strokes.push(this.current);

    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.strokeStyle = "#2B2440";
    this.ctx.beginPath();
    this.ctx.moveTo(point.x, point.y);
    this._notify();
  }

  _onMove(event) {
    if (this.activePointerId !== event.pointerId || !this.current) return;
    if (event.pointerType === "pen") this.lastPenAt = Date.now();
    event.preventDefault();

    // Manche Browser liefern ein leeres Array, wenn keine coalesced
    // Events vorliegen. Dann das eigentliche Event verwenden.
    let events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    if (!events || !events.length) events = [event];

    for (const rawEvent of events) {
      const point = this._point(rawEvent);
      const previous = this.current.points[this.current.points.length - 1];
      if (!previous) continue;
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (distance < 0.35) continue;
      const speed = distance / Math.max(1, point.t - previous.t);
      const pressure = point.pressure || 0.5;
      const base = this.current.pointerType === "touch" ? 4.2 : 3.1;
      const width = Math.max(2.1, Math.min(6.4, base + pressure * 2.2 - Math.min(speed, 2) * 0.5));

      // Weiche Linie: Quadratische Kurve über den Mittelpunkt.
      this.ctx.lineWidth = width;
      this.ctx.beginPath();
      this.ctx.moveTo(previous.x, previous.y);
      const midX = (previous.x + point.x) / 2;
      const midY = (previous.y + point.y) / 2;
      this.ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
      this.ctx.stroke();
      this.current.points.push(point);
    }
    this._notify();
  }

  _point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      t: event.timeStamp || performance.now(),
      pressure: event.pressure || 0.5,
    };
  }

  _onUp(event) {
    if (this.activePointerId !== event.pointerId) return;
    this.activePointerId = null;
    this.current = null;
    this.ctx.lineWidth = 1;
    if (this.strokes.length && this.strokes[this.strokes.length - 1]?.points.length < 2) {
      // Einzelner Tipp: als kleinen Punkt sichtbar lassen (kein Strich).
      const last = this.strokes[this.strokes.length - 1];
      if (last.points.length === 1) {
        const p = last.points[0];
        this.ctx.beginPath();
        this.ctx.fillStyle = "#2B2440";
        this.ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
    this._notify();
  }

  _notify() {
    if (typeof this.onChange === "function") this.onChange(this.isEmpty());
  }

  _redraw() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.strokeStyle = "#2B2440";
    this.ctx.fillStyle = "#2B2440";
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    for (const stroke of this.strokes) {
      if (!stroke.points.length) continue;
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        this.ctx.fill();
        continue;
      }
      this.ctx.lineWidth = stroke.pointerType === "touch" ? 4.2 : 3.2;
      this.ctx.beginPath();
      this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const point = stroke.points[i];
        const next = stroke.points[i + 1];
        const midX = (point.x + next.x) / 2;
        const midY = (point.y + next.y) / 2;
        this.ctx.quadraticCurveTo(point.x, point.y, midX, midY);
      }
      const last = stroke.points[stroke.points.length - 1];
      this.ctx.lineTo(last.x, last.y);
      this.ctx.stroke();
    }
  }

  isEmpty() {
    return this.strokes.length === 0 || this.strokes.every((stroke) => !stroke.points.length);
  }

  getStrokes() {
    return this.strokes.map((stroke) => ({
      pointerType: stroke.pointerType,
      points: stroke.points.map((point) => ({ ...point })),
    }));
  }

  getSize() {
    return { width: this.width, height: this.height };
  }

  clear() {
    this.strokes = [];
    this.current = null;
    this.activePointerId = null;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this._notify();
  }

  undo() {
    if (!this.strokes.length) return false;
    this.strokes.pop();
    this._redraw();
    this._notify();
    return true;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  destroy() {
    this.canvas.removeEventListener("pointerdown", this._onDown);
    this.canvas.removeEventListener("pointermove", this._onMove);
    this.canvas.removeEventListener("pointerup", this._onUp);
    this.canvas.removeEventListener("pointercancel", this._onUp);
    window.removeEventListener("resize", this._onResize);
  }
}

export default DrawingPad;
