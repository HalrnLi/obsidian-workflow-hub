// Polyfill Obsidian's HTMLElement extensions for jsdom
export {};

(HTMLElement.prototype as any).createDiv = function (opts?: {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}) {
  const div = document.createElement('div');
  if (opts?.cls) {
    opts.cls.split(' ').forEach((c) => div.classList.add(c));
  }
  if (opts?.text) div.textContent = opts.text;
  if (opts?.attr) {
    Object.entries(opts.attr).forEach(([k, v]) => div.setAttribute(k, v));
  }
  this.appendChild(div);
  return div;
};

(HTMLElement.prototype as any).createEl = function (
  tag: string,
  opts?: { cls?: string; text?: string; attr?: Record<string, string> },
) {
  const el = document.createElement(tag);
  if (opts?.cls) {
    opts.cls.split(' ').forEach((c) => el.classList.add(c));
  }
  if (opts?.text) el.textContent = opts.text;
  if (opts?.attr) {
    Object.entries(opts.attr).forEach(([k, v]) => el.setAttribute(k, v));
  }
  this.appendChild(el);
  return el;
};

(HTMLElement.prototype as any).createSpan = function (opts?: {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}) {
  const span = document.createElement('span');
  if (opts?.cls) {
    opts.cls.split(' ').forEach((c) => span.classList.add(c));
  }
  if (opts?.text) span.textContent = opts.text;
  if (opts?.attr) {
    Object.entries(opts.attr).forEach(([k, v]) => span.setAttribute(k, v));
  }
  this.appendChild(span);
  return span;
};

(HTMLElement.prototype as any).addClass = function (cls: string) {
  this.classList.add(cls);
};

(HTMLElement.prototype as any).removeClass = function (cls: string) {
  this.classList.remove(cls);
};

(HTMLElement.prototype as any).setText = function (text: string) {
  this.textContent = text;
};

(HTMLElement.prototype as any).empty = function () {
  while (this.firstChild) {
    this.removeChild(this.firstChild);
  }
};
