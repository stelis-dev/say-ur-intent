// Shared PTB (Mermaid) graph renderer — the single source for turning Mermaid
// text into an SVG in the page. Both the review page (the locally stored
// transaction shape) and the public receipt page (an on-chain transaction's PTB
// graph) render through this, so the caching, no-flash refresh, and error
// handling live in one place. The surrounding chrome (name toggle, Mermaid
// source, diagnostics, boundary note) stays with each caller.
//
// An opt-in pan/zoom mode (wheel to zoom toward the cursor, drag to pan, plus
// zoom-in/out/center controls) makes a large graph legible. It is off by default
// so the review page's current behaviour is unchanged until it migrates.
import mermaid from "mermaid";
import { element, iconButton } from "./ui.js";

let initialized = false;
function ensureMermaid(): void {
  if (initialized) {
    return;
  }
  // securityLevel "strict" keeps Mermaid from emitting click handlers or inline
  // scripts, so the rendered SVG is safe to inject as innerHTML under the page CSP.
  // `curve: "basis"` draws smooth curved edges instead of straight polylines.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "default",
    flowchart: { useMaxWidth: true, curve: "basis" }
  });
  initialized = true;
}

// Module-level so an exact-same graph renders instantly from cache and a changed
// graph keeps the previous SVG visible while the new one renders (no blank flash).
// Each page loads its own bundle, so this state is per page, never cross-page.
let renderSequence = 0;
const svgCache = new Map<string, string>();
let lastRenderedSvg: string | undefined;

const ZOOM_IN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ZOOM_OUT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const CENTER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>';

export type PtbGraphView = {
  // Append this where the graph should appear.
  readonly element: HTMLElement;
  // Render (or re-render) the given Mermaid text into the element.
  render(mermaidText: string): void;
};

export function createPtbGraphView(labels?: {
  rendering?: string;
  failed?: string;
  panZoom?: boolean;
  zoomIn?: string;
  zoomOut?: string;
  center?: string;
}): PtbGraphView {
  ensureMermaid();
  const renderingLabel = labels?.rendering ?? "Rendering the transaction graph…";
  const failedLabel = labels?.failed ?? "The transaction graph could not be rendered";
  const element = document.createElement("div");
  element.className = "ui-ptb-graph";

  // Without pan/zoom the SVG is injected straight into the element (review page's
  // current behaviour). With it, the SVG lives in a transformed content layer
  // inside a clipping viewport, and a controls overlay sits on top.
  const interactive = labels?.panZoom === true;
  const content = interactive ? document.createElement("div") : element;
  let panZoom: PanZoomHandle | undefined;
  if (interactive) {
    element.classList.add("ui-ptb-graph--interactive");
    content.className = "ui-ptb-graph-content";
    element.append(content);
    panZoom = attachPanZoom(element, content);
    element.append(buildControls(panZoom, labels));
  }
  content.textContent = renderingLabel;

  const render = (text: string): void => {
    element.classList.remove("ui-ptb-graph--error");
    const cached = svgCache.get(text);
    if (cached) {
      // Already rendered this exact graph: inject synchronously, no flash.
      content.innerHTML = cached;
      lastRenderedSvg = cached;
      panZoom?.center();
      return;
    }
    // Keep the previous graph visible while the new one renders so a refresh
    // never blanks to a placeholder.
    if (lastRenderedSvg) {
      content.innerHTML = lastRenderedSvg;
    } else {
      content.textContent = renderingLabel;
    }
    renderSequence += 1;
    void mermaid
      .render(`ptb-graph-${renderSequence}`, text)
      .then((rendered) => {
        svgCache.set(text, rendered.svg);
        lastRenderedSvg = rendered.svg;
        content.innerHTML = rendered.svg;
        panZoom?.center();
      })
      .catch((error: unknown) => {
        // Name the failure rather than hiding it behind the placeholder text.
        content.textContent = `${failedLabel}: ${error instanceof Error ? error.message : String(error)}`;
        element.classList.add("ui-ptb-graph--error");
      });
  };

  return { element, render };
}

type PanZoomHandle = { center: () => void; zoomBy: (factor: number) => void };

// Wheel-to-zoom (toward the cursor) and drag-to-pan, applied as a CSS transform on
// the content layer (CSSOM transforms are not subject to the style-src CSP). The
// clipping + cursor come from the stylesheet; this only writes the transform.
function attachPanZoom(viewport: HTMLElement, content: HTMLElement): PanZoomHandle {
  const state = { scale: 1, x: 0, y: 0 };
  const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
  const apply = (): void => {
    content.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
  };
  const zoomAt = (cx: number, cy: number, factor: number): void => {
    const nextScale = clamp(state.scale * factor, 0.2, 8);
    const ratio = nextScale / state.scale;
    state.x = cx - ratio * (cx - state.x);
    state.y = cy - ratio * (cy - state.y);
    state.scale = nextScale;
    apply();
  };
  // Reset to 1:1 and center the graph in the viewport. The content's layout
  // height (offsetHeight, transform-independent) decides the vertical offset, so a
  // graph shorter than the viewport sits centered instead of pinned to the top.
  const center = (): void => {
    state.scale = 1;
    state.x = 0;
    const viewportHeight = viewport.clientHeight;
    const contentHeight = content.offsetHeight;
    state.y = contentHeight > 0 && contentHeight < viewportHeight ? (viewportHeight - contentHeight) / 2 : 0;
    apply();
  };

  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false }
  );

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  viewport.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("ui-ptb-graph--grabbing");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    state.x += event.clientX - lastX;
    state.y += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    apply();
  });
  const endDrag = (): void => {
    dragging = false;
    viewport.classList.remove("ui-ptb-graph--grabbing");
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("dblclick", center);

  return { center, zoomBy: (factor) => {
    const rect = viewport.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, factor);
  } };
}

function buildControls(handle: PanZoomHandle, labels?: { zoomIn?: string; zoomOut?: string; center?: string }): HTMLElement {
  const controls = element("div", "ui-ptb-graph-controls");
  controls.append(
    iconButton(ZOOM_IN_ICON, labels?.zoomIn ?? "Zoom in", () => handle.zoomBy(1.25)),
    iconButton(ZOOM_OUT_ICON, labels?.zoomOut ?? "Zoom out", () => handle.zoomBy(1 / 1.25)),
    iconButton(CENTER_ICON, labels?.center ?? "Center", () => handle.center())
  );
  // A click on a control must not also start a pan on the viewport beneath it.
  controls.addEventListener("pointerdown", (event) => event.stopPropagation());
  return controls;
}
