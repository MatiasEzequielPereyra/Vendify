import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLineEndings } from "../../scripts/text-normalization.mjs";

test("line-ending normalization makes Windows and Unix CSS equivalent", () => {
  const unix = ".a { color: red; }\n.b { color: blue; }\n";
  const windows = unix.replace(/\n/g, "\r\n");

  assert.equal(normalizeLineEndings(windows), unix);
  assert.equal(normalizeLineEndings(unix), unix);
});
