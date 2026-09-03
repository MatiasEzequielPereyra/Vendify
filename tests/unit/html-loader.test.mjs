import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(resolve(process.cwd(), "html-loader.js"), "utf8");

test("HTML loader mounts every fragment before runtime scripts in declared order", async () => {
  const fetched = [];
  const events = [];
  const scriptAsyncValues = [];
  let mountedHtml = "";
  let finish;
  const ready = new Promise((resolveReady) => {
    finish = resolveReady;
  });

  const mount = {
    isConnected: true,
    replaceWith() {
      events.push("mounted");
    },
    querySelector() {
      return null;
    }
  };
  const document = {
    getElementById() {
      return mount;
    },
    createElement(tag) {
      if (tag === "template") {
        return {
          content: {},
          set innerHTML(value) {
            mountedHtml = value;
          }
        };
      }
      return { src: "", async: true, onload: null, onerror: null };
    },
    body: {
      append(script) {
        events.push(`script:${script.src}`);
        scriptAsyncValues.push(script.async);
        queueMicrotask(() => script.onload());
      },
      prepend() {
        throw new Error("error fallback should not be mounted on the success path");
      }
    }
  };
  const window = {
    VENDIFY_HTML_BOOTSTRAP: {
      fragments: ["fragment-a.html", "fragment-b.html"],
      scripts: [{ src: "runtime-a.js" }, { src: "runtime-b.js" }]
    },
    dispatchEvent(event) {
      events.push(`event:${event.type}`);
      finish();
    }
  };

  vm.runInNewContext(source, {
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    },
    console,
    document,
    fetch: async (path) => {
      fetched.push(path);
      return { ok: true, text: async () => path };
    },
    location: { reload() {} },
    queueMicrotask,
    window
  });

  await ready;
  assert.deepEqual(fetched, ["fragment-a.html", "fragment-b.html"]);
  assert.equal(mountedHtml, "fragment-a.html\nfragment-b.html");
  assert.deepEqual(events, [
    "mounted",
    "script:runtime-a.js",
    "script:runtime-b.js",
    "event:vendify:html-ready"
  ]);
  assert.deepEqual(scriptAsyncValues, [false, false]);
});
