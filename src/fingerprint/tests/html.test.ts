/*
<MODULE_CONTRACT>
<purpose>RFC-0379: HTML normalizer tests — verify dynamic attribute stripping, whitespace invariance, stable hash.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0379: initial HTML normalizer tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { hashHtml } from "../normalizers/html.ts";

test("HTML: strips data-* attributes except data-testid", () => {
  const a = hashHtml('<div data-tracking="abc" data-testid="hero">Hello</div>');
  const b = hashHtml('<div data-testid="hero">Hello</div>');
  expect(a).toBe(b);
});

test("HTML: strips nonce and integrity attributes", () => {
  const a = hashHtml('<script nonce="abc123" src="app.js"></script>');
  const b = hashHtml('<script src="app.js"></script>');
  expect(a).toBe(b);
});

test("HTML: whitespace-invariant", () => {
  const a = hashHtml("<html><body><h1>Title</h1></body></html>");
  const b = hashHtml("<html>\n  <body>\n    <h1>Title</h1>\n  </body>\n</html>");
  expect(a).toBe(b);
});

test("HTML: strips comments", () => {
  const a = hashHtml("<!-- comment --><div>Content</div>");
  const b = hashHtml("<div>Content</div>");
  expect(a).toBe(b);
});

test("HTML: strips script and style blocks", () => {
  const a = hashHtml(
    "<div>Content</div><script>var x = 1;</script><style>.foo { color: red; }</style>",
  );
  const b = hashHtml("<div>Content</div>");
  expect(a).toBe(b);
});

test("HTML: produces stable hash for identical content", () => {
  const a = hashHtml("<html><body><h1>Title</h1><p>Para</p></body></html>");
  const b = hashHtml("<html><body><h1>Title</h1><p>Para</p></body></html>");
  expect(a).toBe(b);
  expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
});
