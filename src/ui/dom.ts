// Small helpers for building DOM without a framework.

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      node.className = String(value);
    } else if (key === "html") {
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
};

export const clear = (node: HTMLElement) => { while (node.firstChild) node.removeChild(node.firstChild); };

export const timeAgo = (at: number) => {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

export const formatDistance = (metres: number) =>
  metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;

/** A local key that survives reloads. */
export const stored = {
  get: (key: string, fallback = "") => {
    try { return window.localStorage.getItem(`nukhad.${key}`) ?? fallback; } catch { return fallback; }
  },
  set: (key: string, value: string) => {
    try { window.localStorage.setItem(`nukhad.${key}`, value); } catch { /* private mode */ }
  },
};

/** Only a first name, and only what is safe to show a stranger. */
export const cleanName = (raw: string) =>
  raw.trim().replace(/\s+/g, " ").split(" ")[0].replace(/[^\p{L}\p{M}'’-]/gu, "").slice(0, 20);
