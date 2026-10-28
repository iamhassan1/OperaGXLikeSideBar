// mysidebar - Background Service Worker (Manifest V3)
// Coordinates with mysidebar-dock.exe (native Win32 helper) to provide:
// 1. Borderless, taskbar-free, browser-wide WhatsApp drawer (GWLP_HWNDPARENT + SetWindowRgn + ITaskbarList)
// 2. Startup & New Tab homepage persistence
// 3. Unread message badge synchronization across all tabs

const HELPER_URL = 'http://127.0.0.1:38492';
const DOCK_WIDTH = 48;

const DEFAULT_SETTINGS = {
  panelWidth: 430,
  dockPosition: 'left',
  isPinned: false,
  drawerOpen: false,
  unreadCount: 0
};

let drawerWinId = null;
let lastBrowserWinId = null;
let lastViewport = null;

async function ensureAllTabsHaveSidebar() {
  try {
    const tabs = await chrome.tabs.query({});
    const newtabUrl = chrome.runtime.getURL('newtab.html');
    const drawerUrl = chrome.runtime.getURL('drawer.html');

    for (const tab of tabs) {
      if (!tab.id) continue;
      const url = tab.url || tab.pendingUrl || '';

      if (url === drawerUrl) {
        drawerWinId = tab.windowId;
        continue;
      }

      if (
        url === 'chrome://newtab/' ||
        url === 'brave://newtab/' ||
        url === 'edge://newtab/'
      ) {
        chrome.tabs.update(tab.id, { url: newtabUrl }).catch(() => {});
        continue;
      }

      if (
        (url.startsWith('http://') || url.startsWith('https://')) &&
        !url.includes('whatsapp.com') &&
        !url.includes('whatsapp.net')
      ) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[mysidebar] ensureAllTabsHaveSidebar error:', e.message);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) {
      toSet[key] = value;
    }
  }
  toSet.drawerOpen = false;
  await chrome.storage.local.set(toSet);
  await ensureAllTabsHaveSidebar();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.set({ drawerOpen: false });
  await ensureAllTabsHaveSidebar();
});

ensureAllTabsHaveSidebar();

chrome.tabs.onCreated.addListener((tab) => {
  const url = tab.url || tab.pendingUrl || '';
  if (
    url === 'chrome://newtab/' ||
    url === 'brave://newtab/' ||
    url === 'edge://newtab/'
  ) {
    chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('newtab.html') }).catch(() => {});
  }
});

async function findExistingDrawerWindowId() {
  if (drawerWinId !== null) {
    try {
      const win = await chrome.windows.get(drawerWinId);
      if (win && win.id) return win.id;
    } catch (e) {
      drawerWinId = null;
    }
  }

  try {
    const drawerUrl = chrome.runtime.getURL('drawer.html');
    const tabs = await chrome.tabs.query({ url: drawerUrl });
    if (tabs.length > 0 && tabs[0].windowId) {
      drawerWinId = tabs[0].windowId;
      return drawerWinId;
    }
  } catch (e) { /* ignore */ }

  return null;
}

async function resolveViewport(viewport, browserWinId) {
  if (viewport && typeof viewport.left === 'number') {
    lastViewport = viewport;
    return viewport;
  }
  if (lastViewport) return lastViewport;

  try {
    const targetWinId = browserWinId || lastBrowserWinId || chrome.windows.WINDOW_ID_CURRENT;
    const win = await chrome.windows.get(targetWinId);
    return {
      left: (win.left || 0) + 8,
      top: (win.top || 0) + 80,
      width: (win.width || 1366) - 16,
      height: (win.height || 768) - 88,
      cssLeft: (win.left || 0) + 8,
      cssTop: (win.top || 0) + 80,
      cssWidth: (win.width || 1366) - 16,
      cssHeight: (win.height || 768) - 88,
      dpr: 1
    };
  } catch (e) {
    return { left: 8, top: 80, width: 1350, height: 680, cssLeft: 8, cssTop: 80, cssWidth: 1350, cssHeight: 680, dpr: 1 };
  }
}

async function sendHelperCommand(endpoint, vp, panelWidth, dockPosition) {
  const dpr = (vp && vp.dpr) || 1;
  const physicalPanelW = Math.round(panelWidth * dpr);
  const params = new URLSearchParams({
    vpLeft: String(vp.left),
    vpTop: String(vp.top),
    vpWidth: String(vp.width),
    vpHeight: String(vp.height),
    panelWidth: String(physicalPanelW),
    side: dockPosition,
    dpr: String(dpr)
  });

  try {
    const res = await fetch(`${HELPER_URL}/${endpoint}?${params.toString()}`);
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function showDrawer(viewport, browserWinId) {
  if (browserWinId && browserWinId !== drawerWinId) {
    lastBrowserWinId = browserWinId;
  }

  const cfg = await chrome.storage.local.get(['panelWidth', 'dockPosition']);
  const panelWidth = Math.max(280, cfg.panelWidth || 430);
  const dockPosition = cfg.dockPosition || 'left';
  const vp = await resolveViewport(viewport, browserWinId);

  const existingId = await findExistingDrawerWindowId();

  if (existingId === null) {
    const cssLeft = dockPosition === 'left'
      ? Math.round(vp.cssLeft + DOCK_WIDTH)
      : Math.round(vp.cssLeft + vp.cssWidth - DOCK_WIDTH - panelWidth);

    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('drawer.html'),
      type: 'popup',
      left: cssLeft,
      top: Math.round(vp.cssTop),
      width: Math.round(panelWidth),
      height: Math.max(400, Math.round(vp.cssHeight)),
      focused: true
    });
    drawerWinId = win.id;
  }

  await sendHelperCommand('show', vp, panelWidth, dockPosition);
  await chrome.storage.local.set({ drawerOpen: true });
}

async function hideDrawer() {
  await chrome.storage.local.set({ drawerOpen: false });
  const cfg = await chrome.storage.local.get(['panelWidth', 'dockPosition']);
  const vp = await resolveViewport(null, lastBrowserWinId);
  const res = await sendHelperCommand('hide', vp, cfg.panelWidth || 430, cfg.dockPosition || 'left');

  if (!res && lastBrowserWinId) {
    try {
      await chrome.windows.update(lastBrowserWinId, { focused: true });
    } catch (e) { /* ignore */ }
  }
}

async function toggleDrawer(viewport, browserWinId) {
  const cfg = await chrome.storage.local.get(['drawerOpen']);
  const existingId = await findExistingDrawerWindowId();

  if (existingId !== null && cfg.drawerOpen) {
    await hideDrawer();
  } else {
    await showDrawer(viewport, browserWinId);
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === drawerWinId) {
    drawerWinId = null;
    chrome.storage.local.set({ drawerOpen: false });
  }
});

// Clicking extension icon in browser toolbar toggles WhatsApp drawer
chrome.action.onClicked.addListener(async (tab) => {
  let vp = null;
  if (tab && tab.id) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'get_viewport_rect' });
      if (res && res.viewport) vp = res.viewport;
    } catch (e) { /* ignore */ }
  }
  await toggleDrawer(vp, tab ? tab.windowId : null);
});

// Keyboard shortcut handler (Alt+Shift+W)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle_whatsapp') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let vp = null;
    if (tab && tab.id) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'get_viewport_rect' });
        if (res && res.viewport) vp = res.viewport;
      } catch (e) { /* ignore */ }
    }
    await toggleDrawer(vp, tab ? tab.windowId : null);
  }
});

// Handle inter-extension messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderWinId = sender && sender.tab ? sender.tab.windowId : null;

  if (message.action === 'toggle_drawer_from_dock') {
    toggleDrawer(message.viewport, senderWinId).then(() => {
      sendResponse({ ok: true });
    });
    return true;

  } else if (message.action === 'hide_drawer') {
    hideDrawer().then(() => {
      sendResponse({ ok: true });
    });
    return true;

  } else if (message.action === 'page_clicked') {
    chrome.storage.local.get(['isPinned', 'drawerOpen'], async (cfg) => {
      if (cfg.drawerOpen && !cfg.isPinned) {
        await hideDrawer();
      }
      sendResponse({ ok: true });
    });
    return true;

  } else if (message.action === 'reposition_drawer') {
    (async () => {
      const cfg = await chrome.storage.local.get(['drawerOpen', 'panelWidth', 'dockPosition']);
      const existingId = await findExistingDrawerWindowId();
      if (existingId !== null && cfg.drawerOpen) {
        const vp = await resolveViewport(message.viewport, senderWinId);
        await sendHelperCommand('reposition', vp, cfg.panelWidth || 430, message.dockPosition || cfg.dockPosition || 'left');
      }
      sendResponse({ ok: true });
    })();
    return true;

  } else if (message.action === 'open_settings') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return false;

  } else if (message.action === 'clear_cache') {
    if (chrome.browsingData && chrome.browsingData.remove) {
      chrome.browsingData.remove(
        { origins: ['https://web.whatsapp.com'] },
        { cacheStorage: true, serviceWorkers: true }
      ).then(() => {
        sendResponse({ success: true });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
    sendResponse({ success: true });
    return false;

  } else if (message.action === 'wa_unread_update') {
    const count = message.count || 0;
    if (count > 0) {
      chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#fa1e4e' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
    chrome.storage.local.set({ unreadCount: count });
    broadcastToAllTabs({ action: 'wa_unread_count', count: count });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function broadcastToAllTabs(msg) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        try {
          chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
        } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
}
