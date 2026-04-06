export function setupSidebarResize() {
  const SIDEBAR_BREAKPOINT = 860;
  const SIDEBAR_MAX_RATIO = 0.3;
  const root = document.documentElement;
  const body = document.body;
  const sidebar = document.querySelector('.sidebar');
  const resizer = document.getElementById('sidebarResizer');
  if (!sidebar || !resizer) return;
  let resizing = false;
  let startX = 0;
  let startWidth = 0;
  let activePointerId = null;

  function isDesktop() {
    return window.innerWidth > SIDEBAR_BREAKPOINT;
  }

  function getMinWidth() {
    const fromVar = parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-min-width'));
    return Number.isFinite(fromVar) && fromVar > 0 ? fromVar : 220;
  }

  function getMaxWidth() {
    const min = getMinWidth();
    const maxFromViewport = Math.max(min, Math.floor(window.innerWidth * SIDEBAR_MAX_RATIO));
    return maxFromViewport;
  }

  function clampWidth(width) {
    const min = getMinWidth();
    const max = getMaxWidth();
    return Math.min(Math.max(width, min), max);
  }

  function applyWidth(width) {
    const next = clampWidth(width);
    root.style.setProperty('--sidebar-width', `${next}px`);
    sidebar.style.width = `${next}px`;
  }

  function stopResize(pointerId) {
    if (!resizing) return;
    resizing = false;
    const id = pointerId != null ? pointerId : activePointerId;
    if (id != null) {
      try { resizer.releasePointerCapture(id); } catch {}
    }
    activePointerId = null;
    body.classList.remove('sidebar-resizing');
  }

  function handlePointerDown(event) {
    if (!isDesktop()) return;
    event.preventDefault();
    resizing = true;
    startX = event.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    activePointerId = event.pointerId;
    try { resizer.setPointerCapture(event.pointerId); } catch {}
    body.classList.add('sidebar-resizing');
  }

  function handlePointerMove(event) {
    if (!resizing) return;
    const delta = event.clientX - startX;
    applyWidth(startWidth + delta);
  }

  function handlePointerUp(event) {
    stopResize(event.pointerId);
  }

  function syncMode() {
    if (isDesktop()) {
      body.classList.add('desktop');
      applyWidth(sidebar.getBoundingClientRect().width || getMinWidth());
    } else {
      body.classList.remove('desktop');
      stopResize();
      root.style.removeProperty('--sidebar-width');
      sidebar.style.removeProperty('width');
    }
  }

  resizer.addEventListener('pointerdown', handlePointerDown);
  resizer.addEventListener('pointermove', handlePointerMove);
  resizer.addEventListener('pointerup', handlePointerUp);
  resizer.addEventListener('pointercancel', handlePointerUp);

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
  window.addEventListener('resize', () => { syncMode(); });

  syncMode();
}
