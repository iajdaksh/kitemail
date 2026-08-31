const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadThemeScript({ savedTheme = null, prefersDark = false } = {}) {
  const toggles = [{
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener() {}
  }];
  const context = {
    document: {
      documentElement: { dataset: {} },
      querySelectorAll: (selector) => selector === '.theme-toggle' ? toggles : [],
      addEventListener: () => {},
      querySelector: () => null,
      body: { appendChild: () => {} }
    },
    localStorage: {
      getItem: () => savedTheme,
      setItem: (key, value) => { context.saved = { key, value }; }
    },
    window: { matchMedia: () => ({ matches: prefersDark }) },
    setTimeout: () => {},
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/js/app.js', 'utf8'), context);
  return { context, toggles };
}

test('setTheme updates the document, storage, and accessible toggle state', () => {
  const { context, toggles } = loadThemeScript();

  context.setTheme('dark');

  assert.equal(context.document.documentElement.dataset.theme, 'dark');
  assert.deepEqual(context.saved, { key: 'kitemail-theme', value: 'dark' });
  assert.equal(toggles[0].attributes.get('aria-pressed'), 'true');
  assert.equal(toggles[0].attributes.get('aria-label'), 'Switch to light mode');
});

test('initializeTheme uses a saved preference before the system preference', () => {
  const { context } = loadThemeScript({ savedTheme: 'light', prefersDark: true });

  context.initializeTheme();

  assert.equal(context.document.documentElement.dataset.theme, 'light');
});
