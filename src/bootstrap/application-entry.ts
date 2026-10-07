import {
  scheduleApplicationStart
} from "./application-bootstrap.js";
import {
  createBrowserApplicationComposition,
  type BrowserApplicationComposition
} from "./application-composition.js";

declare global {
  interface Window {
    VendifyApplicationV232?: BrowserApplicationComposition;
  }
}

const composition =
  window.VendifyApplicationV232
  ?? createBrowserApplicationComposition();

window.VendifyApplicationV232 = composition;

scheduleApplicationStart(document, () => {
  composition.bootstrap.start();
});

console.info("[Vendify] typed application entry loaded");
