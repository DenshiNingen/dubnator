/* global React, ReactDOM */
const { useEffect, useRef, useState } = React;

// Drag + resize state shared by every floating tool window.
function useFloatingBox(initial, minW = 300, minH = 200) {
  const [box, setBox] = useState(() => {
    const w = (initial && initial.w) || 440;
    const h = (initial && initial.h) || 520;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    return {
      x: (initial && initial.x != null) ? initial.x : Math.max(8, (vw - w) / 2),
      y: (initial && initial.y != null) ? initial.y : 70,
      w,
      h,
    };
  });
  const activeCleanup = useRef(null);

  const dragWith = (event, compute) => {
    event.preventDefault();
    if (activeCleanup.current) activeCleanup.current();
    const move = (nextEvent) => setBox((current) => compute(current, nextEvent));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      activeCleanup.current = null;
    };
    activeCleanup.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  useEffect(() => () => {
    if (activeCleanup.current) activeCleanup.current();
  }, []);

  const startDrag = (event) => {
    if (event.target.closest("button, .dot, .pl-deck-tab, input, select")) return;
    const start = {
      mx: event.clientX,
      my: event.clientY,
      x: box.x,
      y: box.y,
    };
    dragWith(event, (current, nextEvent) => ({
      ...current,
      x: Math.max(0, Math.min(window.innerWidth - 60, start.x + (nextEvent.clientX - start.mx))),
      y: Math.max(0, Math.min(window.innerHeight - 36, start.y + (nextEvent.clientY - start.my))),
    }));
  };

  const startResize = (event) => {
    event.stopPropagation();
    const start = {
      mx: event.clientX,
      my: event.clientY,
      w: box.w,
      h: box.h,
    };
    dragWith(event, (current, nextEvent) => ({
      ...current,
      w: Math.max(minW, start.w + (nextEvent.clientX - start.mx)),
      h: Math.max(minH, start.h + (nextEvent.clientY - start.my)),
    }));
  };

  useEffect(() => {
    const onResize = () => setBox((current) => ({
      ...current,
      x: Math.max(0, Math.min(window.innerWidth - 60, current.x)),
      y: Math.max(0, Math.min(window.innerHeight - 36, current.y)),
      w: Math.min(current.w, window.innerWidth),
      h: Math.min(current.h, window.innerHeight),
    }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const style = {
    position: "fixed",
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    zIndex: 1200,
  };
  return { box, style, startDrag, startResize };
}

function FloatingWindow({
  title,
  onClose,
  initial,
  minW = 300,
  minH = 200,
  className = "",
  children,
}) {
  const floating = useFloatingBox(initial, minW, minH);
  const node = (
    <div className={`floating-window panel with-screws ${className}`} role="dialog"
      aria-label={title} style={floating.style}>
      <div className="screw-bl"></div>
      <div className="screw-br"></div>
      <div
        className="modal-titlebar floating-titlebar"
        style={{ cursor: "move", touchAction: "none" }}
        onPointerDown={floating.startDrag}
      >
        <span className="modal-traffic">
          <button type="button" className="dot red" aria-label={`Close ${title}`} onClick={onClose}></button>
          <span className="dot yellow" aria-hidden="true"></span>
          <span className="dot green" aria-hidden="true"></span>
        </span>
        <span className="panel-title" style={{ flex: 1, textAlign: "center" }}>{title}</span>
        <button className="btn-xs btn" onClick={onClose}>✕</button>
      </div>
      <div className="floating-body">{children}</div>
      <div
        className="floating-resize"
        onPointerDown={floating.startResize}
        title="Drag to resize"
      ></div>
    </div>
  );
  return ReactDOM.createPortal(node, document.body);
}

window.DubnatorFloating = { FloatingWindow, useFloatingBox };
