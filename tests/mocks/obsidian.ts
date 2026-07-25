// Mock for the 'obsidian' module — must export everything the plugin imports.
// Re-export vitest helpers for convenience.

export { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---- Stub Classes ----

export class App {
  vault: Vault = new Vault();
  workspace: Workspace = new Workspace();
}

export class Vault {
  adapter: any = {};
  getConfig = vi.fn();
  getAbstractFileByPath = vi.fn(() => null);
  read = vi.fn(async () => '');
  modify = vi.fn(async () => {});
  create = vi.fn(async () => {});
  delete = vi.fn(async () => {});
  rename = vi.fn(async () => {});
  createFolder = vi.fn(async () => {});
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

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.settingEl = document.createElement('div');
  }

  setName(_name: string) {
    return this;
  }
  setDesc(_desc: string) {
    return this;
  }
  setClass(_cls: string) {
    return this;
  }
  addText(cb: (text: any) => void) {
    cb(new TextComponent());
    return this;
  }
  addDropdown(cb: (dropdown: any) => void) {
    cb(new DropdownComponent());
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
    cb(new ButtonComponent());
    return this;
  }
  addColorPicker(cb: (picker: any) => void) {
    cb(new ColorPickerComponent());
    return this;
  }
  addTextArea(cb: (textarea: any) => void) {
    cb(new TextAreaComponent());
    return this;
  }
  addExtraButton(cb: (btn: any) => void) {
    cb(new ExtraButtonComponent());
    return this;
  }
}

export class TextComponent {
  setValue = vi.fn(function (this: any) {
    return this;
  });
  setPlaceholder = vi.fn(function (this: any) {
    return this;
  });
  onChange = vi.fn(function (this: any) {
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
  onClick = vi.fn(function (this: any) {
    return this;
  });
  buttonEl = document.createElement('button');
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
  onClick = vi.fn(function (this: any) {
    return this;
  });
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

  open = vi.fn();
  close = vi.fn();
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
