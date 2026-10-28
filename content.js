// mysidebar - Persistent 48px Browser Sidebar Dock
// - Renders the always-active 48px dock on every page (and New Tab homepage)
// - Offsets page content by 48px so nothing on the site is covered by the dock
// - Communicates with background.js & mysidebar-dock.exe to control the global borderless WhatsApp drawer

(function () {
  'use strict';

  if (
    window.self !== window.top ||
    window.__mysidebarActive ||
    window.location.pathname.endsWith('/drawer.html')
  ) {
    return;
  }
  window.__mysidebarActive = true;

  // Clean up any leftover DOM from a previous extension reload
  const staleHost = document.getElementById('mysidebar-root');
  if (staleHost) staleHost.remove();
  const staleStyle = document.getElementById('mysidebar-page-style');
  if (staleStyle) staleStyle.remove();

  chrome.storage.local.get(['dockPosition', 'drawerOpen', 'unreadCount'], (config) => {
    initMySidebar(config || {});
  });

  function initMySidebar(config) {
    const DOCK_WIDTH = 48;

    const host = document.createElement('div');
    host.id = 'mysidebar-root';
    const shadow = host.attachShadow({ mode: 'open' });

    let isPanelOpen = config.drawerOpen || false;
    let dockPosition = config.dockPosition || 'left'; // 'left' or 'right'
    let unreadCount = config.unreadCount || 0;

    // Track exact offset between window.screenX/Y and viewport (0, 0)
    let offsetX = 8;
    let offsetY = Math.max(72, window.outerHeight - window.innerHeight - 8);

    function updateViewportOffsets(ev) {
      if (ev && typeof ev.screenX === 'number' && typeof ev.clientX === 'number') {
        offsetX = (ev.screenX - ev.clientX) - window.screenX;
        offsetY = (ev.screenY - ev.clientY) - window.screenY;
      }
    }

    function getViewportScreenRect() {
      const dpr = window.devicePixelRatio || 1;
      const vpLeft = Math.round((window.screenX + offsetX) * dpr);
      const vpTop = Math.round((window.screenY + offsetY) * dpr);
      return {
        left: vpLeft,
        top: vpTop,
        width: Math.round(window.innerWidth * dpr),
        height: Math.round(window.innerHeight * dpr),
        cssLeft: Math.round(window.screenX + offsetX),
        cssTop: Math.round(window.screenY + offsetY),
        cssWidth: Math.round(window.innerWidth),
        cssHeight: Math.round(window.innerHeight),
        dpr: dpr
      };
    }

    window.addEventListener('mousemove', updateViewportOffsets, { passive: true, once: true });

    // ===================== PAGE PUSH LAYOUT ENGINE (48px DOCK ONLY) =====================
    const pageStyle = document.createElement('style');
    pageStyle.id = 'mysidebar-page-style';
    pageStyle.textContent = `
      :root {
        --mysidebar-left: ${dockPosition === 'left' ? DOCK_WIDTH : 0}px;
        --mysidebar-right: ${dockPosition === 'right' ? DOCK_WIDTH : 0}px;
        --mysidebar-total: ${DOCK_WIDTH}px;
      }

      html {
        position: relative !important;
        margin-left: var(--mysidebar-left, 48px) !important;
        margin-right: var(--mysidebar-right, 0px) !important;
        width: calc(100% - var(--mysidebar-total, 48px)) !important;
        max-width: calc(100vw - var(--mysidebar-total, 48px)) !important;
        box-sizing: border-box !important;
      }

      body {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      /* YouTube & Custom Element Fixed Containers */
      #masthead-container.ytd-app,
      ytd-masthead,
      #frosted-glass.ytd-app,
      yt-page-navigation-progress.ytd-app {
        left: var(--mysidebar-left, 48px) !important;
        right: var(--mysidebar-right, 0px) !important;
        width: calc(100vw - var(--mysidebar-total, 48px)) !important;
        max-width: calc(100vw - var(--mysidebar-total, 48px)) !important;
        box-sizing: border-box !important;
      }

      tp-yt-app-drawer#guide,
      ytd-mini-guide-renderer,
      ytd-settings-sidebar-renderer {
        left: var(--mysidebar-left, 48px) !important;
      }

      ytd-playlist-sidebar-renderer,
      ytd-playlist-header-renderer {
        left: calc(240px + var(--mysidebar-left, 48px)) !important;
      }

      /* Fullscreen Video Support */
      :fullscreen #mysidebar-root,
      html:has(:fullscreen) #mysidebar-root {
        display: none !important;
      }

      html:fullscreen,
      html:has(:fullscreen) {
        margin-left: 0 !important;
        margin-right: 0 !important;
        width: 100% !important;
        max-width: 100vw !important;
      }
    `;

    let resizeTimer = null;
    function notifyPageResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        adjustGenericFixedElements();
      }, 60);
    }

    function applyPagePush() {
      const leftPx = dockPosition === 'left' ? `${DOCK_WIDTH}px` : '0px';
      const rightPx = dockPosition === 'right' ? `${DOCK_WIDTH}px` : '0px';

      const root = document.documentElement;
      if (root) {
        if (!document.getElementById('mysidebar-page-style')) {
          (document.head || root).appendChild(pageStyle);
        }
        root.style.setProperty('--mysidebar-left', leftPx);
        root.style.setProperty('--mysidebar-right', rightPx);
        root.style.setProperty('--mysidebar-total', `${DOCK_WIDTH}px`);
      }

      if (dockPosition === 'left') {
        host.style.setProperty('left', '0px', 'important');
        host.style.setProperty('right', 'auto', 'important');
      } else {
        host.style.setProperty('left', 'auto', 'important');
        host.style.setProperty('right', '0px', 'important');
      }

      notifyPageResize();
    }

    function adjustGenericFixedElements() {
      if (!document.body || window.location.hostname.includes('youtube.com')) return;
      const candidates = document.querySelectorAll('header, nav, aside, [style*="fixed"], body > div, body > * > header, body > * > nav');
      for (const el of candidates) {
        if (el.id === 'mysidebar-root') continue;
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed') continue;

        const rect = el.getBoundingClientRect();
        if (rect.width >= window.innerWidth - 16) {
          el.style.setProperty('left', 'var(--mysidebar-left)', 'important');
          el.style.setProperty('right', 'var(--mysidebar-right)', 'important');
          el.style.setProperty('max-width', 'calc(100vw - var(--mysidebar-total))', 'important');
        } else if (dockPosition === 'left' && rect.left < DOCK_WIDTH && rect.left >= 0 && rect.width < window.innerWidth * 0.6) {
          el.style.setProperty('left', 'var(--mysidebar-left)', 'important');
        } else if (dockPosition === 'right' && (window.innerWidth - rect.right) < DOCK_WIDTH && rect.width < window.innerWidth * 0.6) {
          el.style.setProperty('right', 'var(--mysidebar-right)', 'important');
        }
      }
    }

    // Stylesheet inside Shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      :host {
        position: fixed !important;
        top: 0 !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        display: block !important;
      }

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        user-select: none;
      }

      .gx-overlay-container {
        display: flex;
        flex-direction: row;
        height: 100vh;
      }

      .gx-overlay-container.pos-right {
        flex-direction: row-reverse;
      }

      .gx-dock-strip {
        width: ${DOCK_WIDTH}px;
        min-width: ${DOCK_WIDTH}px;
        height: 100vh;
        background: #0e0f14;
        border-right: 1px solid #232533;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        padding: 12px 0;
        box-shadow: 2px 0 16px rgba(0, 0, 0, 0.55);
        z-index: 100;
      }

      .pos-right .gx-dock-strip {
        border-right: none;
        border-left: 1px solid #232533;
        box-shadow: -2px 0 16px rgba(0, 0, 0, 0.55);
      }

      .dock-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        width: 100%;
      }

      .dock-btn {
        position: relative;
        width: 38px;
        height: 38px;
        border-radius: 8px;
        background: transparent;
        border: none;
        color: #8b8f9e;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .dock-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }

      .dock-btn.active {
        background: rgba(250, 30, 78, 0.15);
        color: #ffffff;
      }

      .active-bar {
        position: absolute;
        left: -6px;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 20px;
        background: #fa1e4e;
        border-radius: 0 3px 3px 0;
        box-shadow: 0 0 8px #fa1e4e;
        display: none;
      }

      .pos-right .active-bar {
        left: auto;
        right: -6px;
        border-radius: 3px 0 0 3px;
      }

      .dock-btn.active .active-bar {
        display: block;
      }

      .wa-badge {
        position: absolute;
        top: 2px;
        right: 2px;
        background: #fa1e4e;
        color: #fff;
        font-size: 9px;
        font-weight: 800;
        min-width: 16px;
        height: 16px;
        border-radius: 8px;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        line-height: 1;
        box-shadow: 0 0 6px rgba(250, 30, 78, 0.6);
        z-index: 10;
      }

      .wa-badge.has-count {
        display: flex;
      }

      .gx-logo-ring {
        width: 26px;
        height: 26px;
        filter: drop-shadow(0 0 6px rgba(250, 30, 78, 0.4));
        cursor: pointer;
        transition: transform 0.2s ease, filter 0.2s ease;
      }

      .dock-btn:hover .gx-logo-ring {
        transform: scale(1.1);
        filter: drop-shadow(0 0 10px #fa1e4e);
      }

      .gx-bottom-badge {
        font-size: 11px;
        font-weight: 900;
        color: #fa1e4e;
        letter-spacing: 0.5px;
        opacity: 0.85;
      }
    `;

    const container = document.createElement('div');
    container.className = `gx-overlay-container pos-${dockPosition}`;

    container.innerHTML = `
      <div class="gx-dock-strip" id="dockStrip">
        <div class="dock-group">
          <div class="dock-btn" id="logoBtn" title="mysidebar">
            <svg viewBox="0 0 32 32" class="gx-logo-ring">
              <circle cx="16" cy="16" r="14" fill="none" stroke="#fa1e4e" stroke-width="2.5" />
              <circle cx="16" cy="16" r="6" fill="#ff2d55" />
            </svg>
          </div>

          <button class="dock-btn${isPanelOpen ? ' active' : ''}" id="waDockBtn" title="WhatsApp (Click to Open/Close)">
            <div class="active-bar"></div>
            <span class="wa-badge${unreadCount > 0 ? ' has-count' : ''}" id="waBadge">${unreadCount > 99 ? '99+' : unreadCount}</span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="#25D366">
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.34C9.37 7.34 9.11 7.4 8.89 7.64C8.67 7.88 8.06 8.45 8.06 9.61C8.06 10.77 8.9 11.89 9.02 12.05C9.14 12.21 10.64 14.53 12.94 15.52C14.85 16.34 15.24 16.18 15.66 16.14C16.08 16.1 17.02 15.58 17.21 15.04C17.41 14.5 17.41 14.04 17.35 13.94C17.29 13.84 17.13 13.78 16.89 13.66C16.65 13.54 15.47 12.96 15.25 12.88C15.03 12.8 14.87 12.76 14.71 13C14.55 13.24 14.09 13.78 13.95 13.94C13.81 14.1 13.67 14.12 13.43 14C13.19 13.88 12.42 13.63 11.51 12.82C10.8 12.19 10.32 11.41 10.18 11.17C10.04 10.93 10.16 10.8 10.28 10.68C10.39 10.57 10.53 10.39 10.65 10.25C10.77 10.11 10.81 10.01 10.89 9.85C10.97 9.69 10.93 9.55 10.87 9.43C10.81 9.31 10.35 8.19 10.16 7.72C9.97 7.27 9.77 7.33 9.63 7.32L9.53 7.34Z"/>
            </svg>
          </button>
        </div>

        <div class="dock-group">
          <button class="dock-btn" id="dockSideBtn" title="Switch Dock to Left / Right">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/>
            </svg>
          </button>

          <button class="dock-btn" id="dockSettingsBtn" title="Settings">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>

          <div class="gx-bottom-badge">MS</div>
        </div>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(container);

    host.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      display: block !important;
      pointer-events: auto !important;
      width: auto !important;
      margin: 0 !important;
      padding: 0 !important;
    `;

    applyPagePush();

    function mount() {
      if (!document.getElementById('mysidebar-root')) {
        (document.body || document.documentElement).appendChild(host);
      }
      applyPagePush();
    }

    if (document.body) {
      mount();
    } else {
      const bodyObserver = new MutationObserver(() => {
        if (document.body) {
          bodyObserver.disconnect();
          mount();
        }
      });
      bodyObserver.observe(document.documentElement, { childList: true });
    }

    window.addEventListener('DOMContentLoaded', () => applyPagePush());
    window.addEventListener('load', () => applyPagePush());

    const waDockBtn = shadow.getElementById('waDockBtn');
    const waBadge = shadow.getElementById('waBadge');
    const dockSideBtn = shadow.getElementById('dockSideBtn');
    const dockSettingsBtn = shadow.getElementById('dockSettingsBtn');

    function updateBadge(count) {
      unreadCount = count;
      if (count > 0) {
        waBadge.textContent = count > 99 ? '99+' : String(count);
        waBadge.classList.add('has-count');
      } else {
        waBadge.classList.remove('has-count');
      }
    }

    // Toggle Persistent Browser-Wide Borderless WhatsApp Drawer
    waDockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateViewportOffsets(e);
      chrome.runtime.sendMessage({
        action: 'toggle_drawer_from_dock',
        viewport: getViewportScreenRect()
      });
    });

    // Switch Left / Right
    dockSideBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateViewportOffsets(e);
      dockPosition = dockPosition === 'left' ? 'right' : 'left';
      container.className = `gx-overlay-container pos-${dockPosition}`;
      chrome.storage.local.set({ dockPosition });
      applyPagePush();
      chrome.runtime.sendMessage({
        action: 'reposition_drawer',
        dockPosition,
        viewport: getViewportScreenRect()
      });
    });

    // Settings
    dockSettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'open_settings' });
    });

    // Clicking on the webpage outside the dock hides drawer if unpinned
    document.addEventListener('mousedown', (e) => {
      updateViewportOffsets(e);
      if (!host.contains(e.target) && isPanelOpen) {
        chrome.runtime.sendMessage({ action: 'page_clicked' });
      }
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'get_viewport_rect') {
        sendResponse({ viewport: getViewportScreenRect() });
        return false;
      }
      if (msg.action === 'wa_unread_count') {
        updateBadge(msg.count || 0);
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.dockPosition) {
        dockPosition = changes.dockPosition.newValue;
        container.className = `gx-overlay-container pos-${dockPosition}`;
        applyPagePush();
      }
      if (changes.drawerOpen !== undefined) {
        isPanelOpen = changes.drawerOpen.newValue;
        waDockBtn.classList.toggle('active', isPanelOpen);
      }
      if (changes.unreadCount !== undefined) {
        updateBadge(changes.unreadCount.newValue || 0);
      }
    });
  }
})();
