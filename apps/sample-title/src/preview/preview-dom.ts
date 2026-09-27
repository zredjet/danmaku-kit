// Preview（Phase 2B-9）の panel と overlay の DOM の部品。`preview-mode.ts` だけが使う。

export function isFormField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

export function element(tag: string, className: string, text?: string): HTMLElement {
  const created = document.createElement(tag);
  created.className = className;
  if (text !== undefined) {
    created.textContent = text;
  }
  return created;
}

export function select(values: readonly string[], selected: string, className: string): HTMLSelectElement {
  const created = element("select", className) as HTMLSelectElement;
  created.append(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    return option;
  }));
  return created;
}

/** 選び終えたら focus を外し、矢印 key や Space が select や input ではなく game に届くようにする。 */
export function onChange(control: HTMLInputElement | HTMLSelectElement, handle: () => void): void {
  control.addEventListener("change", () => {
    control.blur();
    handle();
  });
}

export function setOrDelete(parameters: URLSearchParams, name: string, value: string | null): void {
  if (value === null) {
    parameters.delete(name);
  } else {
    parameters.set(name, value);
  }
}

export function field(text: string, control: HTMLElement): HTMLElement {
  const label = element("label", "preview-field", text);
  label.append(control);
  return label;
}

export function buttons(children: readonly HTMLElement[]): HTMLElement {
  const row = element("div", "preview-buttons");
  row.append(...children);
  return row;
}

/** button は click で focus を取らず、Space や Enter が button を押し直さずに game の confirm に届くようにする。 */
export function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const created = element("button", className, text) as HTMLButtonElement;
  created.type = "button";
  created.addEventListener("mousedown", (event) => event.preventDefault());
  created.addEventListener("click", onClick);
  return created;
}

/** playfield の座標に置く印。transform root の中なので、表示の倍率と letterbox は root の transform が当てる。 */
export function positioned(className: string, text: string, position: Readonly<{ x: number; y: number }>): HTMLElement {
  const created = element("span", className, text);
  created.style.transform = `translate(${position.x}px, ${position.y}px)`;
  return created;
}

/** Preview の style。production build に入らないよう、index.html ではなくこの module が足す。 */
export function previewStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    .preview-panel {
      position: fixed; top: 8px; right: 8px; z-index: 3; display: grid; gap: 4px; width: 300px; padding: 8px;
      font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #e2e8f0; background: rgb(15 23 42 / 88%);
    }
    .preview-field { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 4px; }
    .preview-field > select, .preview-field > input { min-width: 0; font: inherit; }
    .preview-field > input[type="checkbox"] { justify-self: start; margin: 0; }
    .preview-field:has(> input[type="checkbox"]) { justify-self: start; }
    .preview-buttons { display: flex; gap: 4px; }
    .preview-buttons > button { flex: 1; font: inherit; }
    .preview-overlay { position: absolute; inset: 0; z-index: 1; overflow: hidden; pointer-events: none; }
    .preview-entity-id, .preview-spawn {
      position: absolute; top: 0; left: 0; margin: 6px 0 0 6px; white-space: nowrap;
      font: 8px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .preview-entity-id { color: #fde68a; }
    .preview-spawn { color: #c4b5fd; }
    .preview-info { margin: 0; font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cbd5e1; white-space: pre-wrap; }
  `;
  return style;
}
