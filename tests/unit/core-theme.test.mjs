import assert from "node:assert/strict";
import test from "node:test";
import { loadTheme, toggleTheme } from "../../dist-ts/core/theme.js";

function createEnvironment({ stored = null, attribute = "" } = {}) {
  let value = stored;
  let currentAttribute = attribute;
  const icon = { textContent: null };
  return {
    icon,
    environment: {
      document: {
        documentElement: {
          getAttribute: () => currentAttribute,
          setAttribute: (_name, next) => { currentAttribute = next; }
        },
        querySelector: (selector) => (selector === "#theme-icon" ? icon : null)
      },
      storage: {
        getItem: () => value,
        setItem: (_key, next) => { value = next; }
      }
    },
    stored: () => value,
    attribute: () => currentAttribute
  };
}

test("loadTheme preserves the dark legacy default", () => {
  const fixture = createEnvironment();
  assert.equal(loadTheme("kiosco_theme", fixture.environment), "dark");
  assert.equal(fixture.attribute(), "");
  assert.equal(fixture.icon.textContent, "☀️");
});

test("toggleTheme persists and renders the next legacy theme", () => {
  const fixture = createEnvironment({ attribute: "light" });
  assert.equal(toggleTheme("kiosco_theme", fixture.environment), "dark");
  assert.equal(fixture.stored(), "dark");
  assert.equal(fixture.icon.textContent, "☀️");
});
