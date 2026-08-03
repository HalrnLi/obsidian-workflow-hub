// Mock for the 'obsidian' module — must export everything the plugin imports.
// Re-export vitest helpers for convenience.

export { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---- Stub Classes ----

export class App {
  vault: Vault = new Vault();
  workspace: Workspace = new Workspace();
}

export class Vault {
  adapter: any = {
    read: vi.fn(async () => ''),
    readContent: vi.fn(async () => ''),
    exists: vi.fn(async () => false),
    write: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
  };
  getConfig = vi.fn();
  getAbstractFileByPath = vi.fn(() => null);
  read = vi.fn(async () => '');
  modify = vi.fn(async () => {});
  create = vi.fn(async () => {});
  delete = vi.fn(async () => {});
  rename = vi.fn(async () => {});
  createFolder = vi.fn(async () => {});

  // 事件注册/注销（供 registerVaultEvents 类逻辑测试）
  private _handlers: Record<string, Array<(file: unknown) => void>> = {};
  on = vi.fn((event: string, cb: (file: unknown) => void) => {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(cb);
    return { event, cb };
  });
  offref = vi.fn((ref: any) => {
    const list = this._handlers[ref?.event];
    if (list) {
      const i = list.indexOf(ref?.cb);
      if (i >= 0) list.splice(i, 1);
    }
  });
  /** 测试辅助：触发指定事件 */
  triggerEvent(event: string, file: unknown) {
    for (const cb of this._handlers[event] ?? []) cb(file);
  }
  /** 测试辅助：获取指定事件的第一个处理器 */
  getHandler(event: string): ((file: unknown) => void) | undefined {
    return this._handlers[event]?.[0];
  }
}

export class Workspace {
  getLeavesOfType = vi.fn(() => []);
  getLeftLeaf = vi.fn(() => null);
  revealLeaf = vi.fn();
  onLayoutReady = vi.fn((cb: () => void) => cb());
  trigger = vi.fn();
  unregisterViewType = vi.fn();
  on = vi.fn();
  off = vi.fn();
}

export class TFile {
  path = '';
  name = '';
  basename = '';
  extension = 'md';
  stat = { ctime: 0, mtime: 0 };
  readContent = vi.fn(async () => '');
}

export class TFolder {
  path = '';
  name = '';
  children: TFile[] = [];
}

export class Plugin {
  app: App;
  manifest: { id: string; version: string };

  loadData = vi.fn(async () => ({}));
  saveData = vi.fn(async () => {});
  addRibbonIcon = vi.fn();
  addCommand = vi.fn();
  addSettingTab = vi.fn();
  registerView = vi.fn();
  registerEvent = vi.fn();

  constructor(app: App, manifest: { id: string; version: string }) {
    this.app = app;
    this.manifest = manifest;
  }
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
  }
}

export class ItemView {
  app: App;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    this.app = new App();
    this.leaf = leaf;
    this.containerEl = document.createElement('div');
    this.containerEl.addClass('app-version-manager');
  }
}

export class WorkspaceLeaf {
  view: any = null;
}

export class Setting {
  containerEl: HTMLElement;
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    // 与真实 Obsidian 一致：构建 DOM 树，测试可查询/点击
    this.settingEl = document.createElement('div');
    this.settingEl.addClass('setting-item');
    this.nameEl = document.createElement('div');
    this.descEl = document.createElement('div');
    this.settingEl.appendChild(this.nameEl);
    this.settingEl.appendChild(this.descEl);
    containerEl.appendChild(this.settingEl);
  }

  setName(name: string) {
    this.nameEl.setText(name);
    return this;
  }
  setDesc(desc: string) {
    this.descEl.setText(desc);
    return this;
  }
  setClass(cls: string) {
    this.settingEl.addClass(cls);
    return this;
  }
  addText(cb: (text: any) => void) {
    const c = new TextComponent();
    this.settingEl.appendChild(c.inputEl);
    cb(c);
    return this;
  }
  addDropdown(cb: (dropdown: any) => void) {
    const c = new DropdownComponent();
    this.settingEl.appendChild(c.selectEl);
    cb(c);
    return this;
  }
  addSlider(cb: (slider: any) => void) {
    cb(new SliderComponent());
    return this;
  }
  addToggle(cb: (toggle: any) => void) {
    cb(new ToggleComponent());
    return this;
  }
  addButton(cb: (btn: any) => void) {
    const c = new ButtonComponent();
    this.settingEl.appendChild(c.buttonEl);
    cb(c);
    return this;
  }
  addColorPicker(cb: (picker: any) => void) {
    cb(new ColorPickerComponent());
    return this;
  }
  addTextArea(cb: (textarea: any) => void) {
    const c = new TextAreaComponent();
    this.settingEl.appendChild(c.inputEl);
    cb(c);
    return this;
  }
  addExtraButton(cb: (btn: any) => void) {
    const c = new ExtraButtonComponent();
    this.settingEl.appendChild(c.buttonEl);
    cb(c);
    return this;
  }
}

export class TextComponent {
  setValue = vi.fn(function (this: any, v: string) {
    this._value = v;
    this.inputEl.value = v;
    return this;
  });
  setPlaceholder = vi.fn(function (this: any) {
    return this;
  });
  onChange = vi.fn(function (this: any, cb: (v: string) => void) {
    this._onChange = cb;
    // 与真实 Obsidian 一致：onChange 监听 input 事件并读取当前值
    this.inputEl.addEventListener('input', () => cb(this.inputEl.value));
    return this;
  });
  inputEl = document.createElement('input');
}

export class DropdownComponent {
  addOption = vi.fn(function (this: any) {
    return this;
  });
  setValue = vi.fn(function (this: any) {
    return this;
  });
  onChange = vi.fn(function (this: any) {
    return this;
  });
  selectEl = document.createElement('select');
}

export class SliderComponent {
  setLimits = vi.fn(function (this: any) {
    return this;
  });
  setValue = vi.fn(function (this: any) {
    return this;
  });
  setDynamicTooltip = vi.fn(function (this: any) {
    return this;
  });
  onChange = vi.fn(function (this: any) {
    return this;
  });
}

export class ToggleComponent {
  setValue = vi.fn(function (this: any) {
    return this;
  });
  onChange = vi.fn(function (this: any) {
    return this;
  });
}

export class ButtonComponent {
  setIcon = vi.fn(function (this: any) {
    return this;
  });
  setTooltip = vi.fn(function (this: any) {
    return this;
  });
  setDisabled = vi.fn(function (this: any) {
    return this;
  });
  setButtonText = vi.fn(function (this: any) {
    return this;
  });
  setWarning = vi.fn(function (this: any) {
    return this;
  });
  setClass = vi.fn(function (this: any) {
    return this;
  });
  setCta = vi.fn(function (this: any) {
    return this;
  });
  onClick = vi.fn(function (this: any, cb: () => void) {
    // 与真实 Obsidian 一致：点击回调挂到按钮元素上，测试可用 click() 触发
    this.buttonEl.addEventListener('click', cb);
    return this;
  });
  buttonEl = document.createElement('button');
  // 与真实 Obsidian 一致：构造时把按钮挂到容器 DOM 上
  constructor(containerEl?: HTMLElement) {
    if (containerEl) containerEl.appendChild(this.buttonEl);
  }
}

export class ColorPickerComponent {
  setValue = vi.fn(function (this: any) {
    return this;
  });
  onChange = vi.fn(function (this: any) {
    return this;
  });
}

export class TextAreaComponent {
  setValue = vi.fn(function (this: any) {
    return this;
  });
  setPlaceholder = vi.fn(function (this: any) {
    return this;
  });
  onChange = vi.fn(function (this: any) {
    return this;
  });
  inputEl = document.createElement('textarea');
}

export class ExtraButtonComponent {
  setIcon = vi.fn(function (this: any) {
    return this;
  });
  setTooltip = vi.fn(function (this: any) {
    return this;
  });
  onClick = vi.fn(function (this: any, cb: () => void) {
    // 与真实 Obsidian 一致：点击回调挂到按钮元素上，测试可用 click() 触发
    this.buttonEl.addEventListener('click', cb);
    return this;
  });
  buttonEl = document.createElement('button');
}

export class Menu {
  addItem = vi.fn(function (this: Menu, cb: (item: any) => void) {
    cb(new MenuItem());
    return this;
  });
  addSeparator = vi.fn(function (this: any) {
    return this;
  });
  showAtMouseEvent = vi.fn();
  showAtPosition = vi.fn();
}

export class MenuItem {
  setTitle = vi.fn(function (this: any) {
    return this;
  });
  setIcon = vi.fn(function (this: any) {
    return this;
  });
  onClick = vi.fn(function (this: any) {
    return this;
  });
}

export class Modal {
  app: App;
  contentEl: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.contentEl = document.createElement('div');
  }

  open = vi.fn(function (this: Modal) {
    // 与真实 Obsidian 一致：open 时调用 onOpen 渲染内容
    this.onOpen();
  });
  close = vi.fn(function (this: Modal) {
    this.onClose();
  });
  onOpen() {}
  onClose() {}
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

// Utility functions
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

// YAML helpers (Obsidian runtime provides these; tests use js-yaml)
import * as yaml from 'js-yaml';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseYaml(text: string): any {
  return yaml.load(text);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stringifyYaml(obj: any): string {
  return yaml.dump(obj, { lineWidth: -1 });
}
