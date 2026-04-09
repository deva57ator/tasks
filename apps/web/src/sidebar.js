const MOBILE_BREAKPOINT = 860;

export function setupMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggleBtn = document.getElementById('sidebarToggle');
  const closeBtn = document.getElementById('sidebarClose');
  if (!sidebar || !overlay || !toggleBtn) return;

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function open() {
    sidebar.classList.add('is-open');
    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
    toggleBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    sidebar.classList.remove('is-open');
    overlay.classList.remove('is-visible');
    overlay.setAttribute('aria-hidden', 'true');
    toggleBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggleBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('is-open')) close(); else open();
  });

  overlay.addEventListener('click', close);
  if (closeBtn) closeBtn.addEventListener('click', close);

  // Close on nav button tap (navigate and dismiss sidebar)
  sidebar.addEventListener('click', (e) => {
    if (!isMobile()) return;
    if (e.target.closest('.nav-btn')) close();
  });

  // Swipe from left edge to open, swipe left on sidebar to close
  let touchStartX = 0;
  let touchStartY = 0;
  let tracking = false;

  document.addEventListener('touchstart', (e) => {
    if (!isMobile()) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    tracking = !sidebar.classList.contains('is-open') && touchStartX < 30;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!isMobile() || !tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    if (dx > 60 && dy < 80) open();
  }, { passive: true });

  sidebar.addEventListener('touchstart', (e) => {
    if (!isMobile()) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  sidebar.addEventListener('touchend', (e) => {
    if (!isMobile() || !tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    if (dx < -60 && dy < 80) close();
  }, { passive: true });

  // Sync on resize (close if switching to desktop)
  window.addEventListener('resize', () => {
    if (!isMobile()) close();
  });
}

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
