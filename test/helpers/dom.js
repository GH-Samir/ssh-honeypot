import { JSDOM } from 'jsdom';

/**
 * Give the render module a DOM to build into.
 *
 * render.js deliberately uses the global `document` rather than taking one as
 * an argument — that is what the browser gives it, and mirroring that here
 * means the tests exercise the same code path the page does.
 */
export function setupDom(html = '<!doctype html><html><body></body></html>') {
  const dom = new JSDOM(html, { url: 'https://example.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  return dom;
}
