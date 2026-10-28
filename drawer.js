// mysidebar - Borderless Docked Drawer Controller
// Works with mysidebar-dock.exe to provide a borderless, taskbar-free, browser-wide WhatsApp drawer

(function () {
  'use strict';

  const HELPER_URL = 'http://127.0.0.1:38492';
  const waFrame = document.getElementById('waFrame');
  const loadingLayer = document.getElementById('loadingLayer');
  const headerSideBtn = document.getElementById('headerSideBtn');
  const headerRefreshBtn = document.getElementById('headerRefreshBtn');
  const headerPinBtn = document.getElementById('headerPinBtn');
  const headerCloseBtn = document.getElementById('headerCloseBtn');
  const drawerResizer = document.getElementById('drawerResizer');

  let isPinned = false;
  let dockPosition = 'left';

  function reportMetricsToHelper() {
    const dpr = window.devicePixelRatio || 1;
    const innerW = Math.round(window.innerWidth * dpr);
    const innerH = Math.round(window.innerHeight * dpr);
    const outerW = Math.round(window.outerWidth * dpr);
    const outerH = Math.round(window.outerHeight * dpr);
    fetch(`${HELPER_URL}/metrics?innerW=${innerW}&innerH=${innerH}&outerW=${outerW}&outerH=${outerH}&dpr=${dpr}&side=${dockPosition}`, {
      mode: 'no-cors'
    }).catch(() => {});
  }

  chrome.storage.local.get(['isPinned', 'dockPosition'], (cfg) => {
    if (cfg.isPinned) {
      isPinned = true;
      headerPinBtn.classList.add('active');
    }
    if (cfg.dockPosition) {
      dockPosition = cfg.dockPosition;
      document.body.classList.toggle('pos-right', dockPosition === 'right');
    }
    reportMetricsToHelper();
  });

  window.addEventListener('load', reportMetricsToHelper);
  setInterval(reportMetricsToHelper, 1000);

  waFrame.addEventListener('load', () => {
    loadingLayer.classList.add('hidden');
  });

  setTimeout(() => {
    loadingLayer.classList.add('hidden');
  }, 4000);

  // Switch Dock + Drawer between Left and Right
  headerSideBtn.addEventListener('click', () => {
    dockPosition = dockPosition === 'left' ? 'right' : 'left';
    document.body.classList.toggle('pos-right', dockPosition === 'right');
    chrome.storage.local.set({ dockPosition });
    chrome.runtime.sendMessage({ action: 'reposition_drawer', dockPosition });
  });

  // Refresh WhatsApp explicitly when clicked
  headerRefreshBtn.addEventListener('click', () => {
    const icon = headerRefreshBtn.querySelector('.refresh-icon');
    if (icon) icon.classList.add('spin');
    loadingLayer.classList.remove('hidden');
    waFrame.src = 'https://web.whatsapp.com/';
    setTimeout(() => {
      if (icon) icon.classList.remove('spin');
      loadingLayer.classList.add('hidden');
    }, 1800);
  });

  // Pin Toggle
  headerPinBtn.addEventListener('click', () => {
    isPinned = !isPinned;
    headerPinBtn.classList.toggle('active', isPinned);
    chrome.storage.local.set({ isPinned });
  });

  // Hide Drawer (keeps WhatsApp alive in background without unloading)
  headerCloseBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'hide_drawer' });
  });

  // Custom Drag-Resizer Handle (triggers native 120Hz Win32 resize in mysidebar-dock.exe)
  drawerResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('is-dragging');
    fetch(`${HELPER_URL}/start-resize?side=${dockPosition}`, { mode: 'no-cors' }).catch(() => {});

    const startScreenX = e.screenX;
    const startW = window.innerWidth;

    const onMouseMove = (ev) => {
      const delta = ev.screenX - startScreenX;
      const newW = Math.max(280, dockPosition === 'left' ? startW + delta : startW - delta);
      chrome.storage.local.set({ panelWidth: newW });
    };

    const onMouseUp = () => {
      document.body.classList.remove('is-dragging');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (window.innerWidth > 260) {
        chrome.storage.local.set({ panelWidth: window.innerWidth });
      }
      reportMetricsToHelper();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 260) {
      chrome.storage.local.set({ panelWidth: window.innerWidth });
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.isPinned !== undefined) {
      isPinned = changes.isPinned.newValue;
      headerPinBtn.classList.toggle('active', isPinned);
    }
    if (changes.dockPosition !== undefined) {
      dockPosition = changes.dockPosition.newValue;
      document.body.classList.toggle('pos-right', dockPosition === 'right');
      reportMetricsToHelper();
    }
  });
})();

