// Opera GX Sidebar - Options Controller

document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const btnPosLeft = document.getElementById('btnPosLeft');
  const btnPosRight = document.getElementById('btnPosRight');
  const checkOnPageDock = document.getElementById('checkOnPageDock');
  const rangeWidth = document.getElementById('rangeWidth');
  const widthValue = document.getElementById('widthValue');
  const statusToast = document.getElementById('statusToast');
  const btnOpenChromeAppearance = document.getElementById('btnOpenChromeAppearance');
  const btnClearCache = document.getElementById('btnClearCache');

  // Load current values
  const current = await chrome.storage.local.get(['dockPosition', 'onPageDockEnabled', 'panelWidth']);

  let dockPosition = current.dockPosition || 'left';
  updatePositionUI(dockPosition);

  if (current.onPageDockEnabled !== undefined) {
    checkOnPageDock.checked = current.onPageDockEnabled;
  }

  if (current.panelWidth) {
    rangeWidth.value = current.panelWidth;
    widthValue.textContent = `${current.panelWidth}px`;
  }

  function updatePositionUI(pos) {
    btnPosLeft.classList.toggle('active', pos === 'left');
    btnPosRight.classList.toggle('active', pos === 'right');
  }

  function showToast(msg) {
    statusToast.textContent = msg;
    statusToast.style.display = 'block';
    setTimeout(() => {
      statusToast.style.display = 'none';
    }, 2500);
  }

  btnPosLeft.addEventListener('click', () => {
    dockPosition = 'left';
    updatePositionUI('left');
    chrome.storage.local.set({ dockPosition: 'left' });
    showToast('Sidebar position set to LEFT!');
  });

  btnPosRight.addEventListener('click', () => {
    dockPosition = 'right';
    updatePositionUI('right');
    chrome.storage.local.set({ dockPosition: 'right' });
    showToast('Sidebar position set to RIGHT!');
  });

  checkOnPageDock.addEventListener('change', () => {
    chrome.storage.local.set({ onPageDockEnabled: checkOnPageDock.checked });
    showToast('On-page dock preference updated!');
  });

  rangeWidth.addEventListener('input', () => {
    widthValue.textContent = `${rangeWidth.value}px`;
  });

  rangeWidth.addEventListener('change', () => {
    chrome.storage.local.set({ panelWidth: parseInt(rangeWidth.value, 10) });
    showToast('Panel width saved!');
  });

  btnOpenChromeAppearance.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://settings/appearance' });
  });

  btnClearCache.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear_cache' }, (response) => {
      showToast('Cache cleared. Please reload WhatsApp in the sidebar.');
    });
  });
});
