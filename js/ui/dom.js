/** Kleine DOM-/UI-Helfer, die in allen Ansichten gebraucht werden. */

let modalCounter = 0;
const modalStack = [];

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ALLOWED_RICH_TAGS = new Set(["i", "em", "b", "strong", "u", "br", "sub", "sup", "mark"]);

/**
 * Erlaubt einfache Formatierungs-Tags aus Vokabeldaten (z. B. <i>...</i>)
 * und escaped alles andere sicher.
 */
export function sanitizeRichText(value) {
  const text = String(value ?? "");
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "<") {
      const close = text.indexOf(">", i + 1);
      if (close !== -1) {
        const raw = text.slice(i + 1, close).trim();
        const m = raw.match(/^\/?\s*([a-z0-9]+)\s*\/?$/i);
        if (m) {
          const tag = m[1].toLowerCase();
          if (ALLOWED_RICH_TAGS.has(tag)) {
            const isClosing = /^\s*\//.test(raw);
            const isVoid = tag === "br";
            out += isClosing ? `</${tag}>` : (isVoid ? "<br>" : `<${tag}>`);
            i = close + 1;
            continue;
          }
        }
      }
    }
    out += esc(ch);
    i += 1;
  }
  return out;
}

export function stripRichText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?([a-z0-9]+)[^>]*>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function icon(name, className = "") {
  return `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function plural(count, singular, pluralForm = `${singular}en`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function formatDate(timestamp) {
  if (!timestamp) return "–";
  try {
    return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(timestamp));
  } catch {
    return "–";
  }
}

export function formatDuration(ms) {
  if (!ms || ms < 1000) return "unter 1 Sekunde";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  if (!minutes) return `${seconds} Sekunden`;
  return `${minutes} Min. ${seconds} Sek.`;
}

export function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ---------- Toasts ---------- */
export function showToast(message, { type = "", duration = 3400, iconName = "" } = {}) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`.trim();
  if (iconName) toast.insertAdjacentHTML("afterbegin", icon(iconName));
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(text);
  root.append(toast);
  while (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => {
    toast.classList.add("is-out");
    setTimeout(() => toast.remove(), 260);
  }, duration);
}

/* ---------- Modale ---------- */
function focusables(container) {
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
  )].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

/**
 * Öffnet ein Modal und gibt {root, dialog, close} zurück.
 * content darf ein HTML-String oder ein DOM-Knoten sein.
 */
export function openModal({
  title,
  subtitle = "",
  content = "",
  actions = [],
  size = "",
  dismissible = true,
  className = "",
  onClose = null,
  initialFocus = null,
  closeOnBackdrop = true,
} = {}) {
  const id = `modal-title-${++modalCounter}`;
  const previouslyFocused = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const dialog = document.createElement("div");
  dialog.className = `modal ${size}`.trim();
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", id);
  if (className) dialog.classList.add(...className.split(" ").filter(Boolean));

  const head = document.createElement("div");
  head.className = "modal-head";
  const headText = document.createElement("div");
  const heading = document.createElement("h2");
  heading.id = id;
  heading.textContent = title || "Hinweis";
  headText.append(heading);
  if (subtitle) {
    const sub = document.createElement("p");
    sub.textContent = subtitle;
    headText.append(sub);
  }
  head.append(headText);

  if (dismissible) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "icon-btn modal-close";
    closeBtn.setAttribute("aria-label", "Schließen");
    closeBtn.innerHTML = icon("close");
    closeBtn.addEventListener("click", () => close(false));
    head.append(closeBtn);
  }
  dialog.append(head);

  const body = document.createElement("div");
  body.className = "modal-body";
  if (content instanceof Node) body.append(content);
  else body.innerHTML = content;
  dialog.append(body);

  let resolved = false;
  const close = (result = true) => {
    if (resolved) return;
    resolved = true;
    document.removeEventListener("keydown", onKeyDown, true);
    backdrop.remove();
    const index = modalStack.indexOf(entry);
    if (index >= 0) modalStack.splice(index, 1);
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      setTimeout(() => previouslyFocused.focus({ preventScroll: true }), 0);
    }
    if (typeof onClose === "function") onClose(result);
  };

  const entry = { root: backdrop, dialog, close };

  if (actions.length) {
    const actionBar = document.createElement("div");
    actionBar.className = "modal-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn ${action.variant || "btn-soft"}`;
      if (action.grow) button.classList.add("grow");
      if (action.id) button.id = action.id;
      button.innerHTML = action.iconName ? icon(action.iconName) : "";
      button.insertAdjacentText("beforeend", action.label);
      button.addEventListener("click", async () => {
        if (action.disabled) return;
        if (typeof action.onClick === "function") {
          const outcome = await action.onClick({ close, dialog, body });
          if (outcome === false) return;
        }
        if (action.close !== false) close(action.value ?? true);
      });
      actionBar.append(button);
    }
    dialog.append(actionBar);
  }

  const onKeyDown = (event) => {
    if (!modalStack.length || modalStack[modalStack.length - 1].root !== backdrop) return;
    if (event.key === "Escape" && dismissible) {
      event.preventDefault();
      close(false);
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusables(dialog);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (closeOnBackdrop) {
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop && dismissible) close(false);
    });
  }
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());

  document.addEventListener("keydown", onKeyDown, true);
  modalStack.push(entry);
  backdrop.append(dialog);
  document.getElementById("modal-root").append(backdrop);

  requestAnimationFrame(() => {
    const target = (initialFocus && dialog.querySelector(initialFocus)) || focusables(dialog)[0] || dialog;
    if (target === dialog) dialog.tabIndex = -1;
    target.focus({ preventScroll: true });
  });

  return entry;
}

export function closeAllModals() {
  while (modalStack.length) modalStack[modalStack.length - 1].close(false);
}

export function confirmDialog({
  title = "Bist du sicher?",
  message = "",
  confirmLabel = "Ja, weiter",
  cancelLabel = "Abbrechen",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let answer = false;
    openModal({
      title,
      content: `<p class="mb-0">${esc(message)}</p>`,
      size: "modal-sm",
      actions: [
        { label: cancelLabel, variant: "btn-ghost", value: false },
        {
          label: confirmLabel,
          variant: danger ? "btn-danger" : "btn-primary",
          value: true,
          onClick: () => {
            answer = true;
          },
        },
      ],
      onClose: () => resolve(answer),
    });
  });
}

/* ---------- Diverses ---------- */
export function focusMain() {
  const main = document.getElementById("main");
  if (main) main.focus({ preventScroll: true });
}

export function setButtonBusy(button, busy, busyLabel = "Bitte warten …") {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

export function downloadFile(filename, content, mime = "application/octet-stream") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function readTextFile(file, maxBytes = 5 * 1024 * 1024) {
  if (!file) throw new Error("Es wurde keine Datei ausgewählt.");
  if (file.size > maxBytes) throw new Error("Die Datei ist zu groß (maximal 5 MB).");
  return file.text();
}

export function errorMessage(error) {
  if (!error) return "Unbekannter Fehler.";
  return error.message || String(error);
}

export function starSvg(className = "") {
  return `<svg class="result-star ${className}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>`;
}

export function shake(element) {
  if (!element) return;
  element.classList.remove("shake");
  void element.offsetWidth;
  element.classList.add("shake");
  setTimeout(() => element.classList.remove("shake"), 400);
}
