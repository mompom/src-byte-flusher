// SPA shell: tab routing, common sidebar (Device), module lifecycle
import { initI18n, t, applyDom } from './i18n.js';
import * as ble from './ble.js';

// Modules are lazy-imported
let textModule = null;
let filesModule = null;
let scrollModule = null;

const ROUTES = {
  '': 'home',
  '#': 'home',
  '#text': 'text',
  '#files': 'files',
  '#scroll': 'scroll',
};

let currentRoute = null;
let els = {};

function getRoute() {
  const hash = location.hash || '';
  return ROUTES[hash] || 'home';
}

// ---------------------------------------------------------------------------
// Device UI functions (common sidebar)
// ---------------------------------------------------------------------------

export function setStatus(text, details) {
  if (els.statusText) els.statusText.textContent = text ?? '';
  if (els.detailsText) els.detailsText.textContent = details ?? '';
}

export function setUiConnected(connected) {
  if (els.btnConnect)      els.btnConnect.disabled      = connected;
  if (els.btnDisconnect)   els.btnDisconnect.disabled   = !connected;
  if (els.btnBootloader)   els.btnBootloader.disabled   = !connected;
  if (els.btnApplyNickname) els.btnApplyNickname.disabled = !connected;
}

async function handleConnect() {
  setStatus(t('status.connecting'), '');
  try {
    const result = await ble.connect();
    if (result.cancelled) {
      setStatus(t('status.cancelled'), '');
      return;
    }
    // onBleConnect will be called via the 'connect' event
    // Load and display nickname after successful connection
    try {
      const nickname = await ble.readDeviceNicknameOnce();
      if (nickname && els.deviceNickname) {
        els.deviceNickname.value = nickname;
      }
    } catch {
      // Nickname read is best-effort; ignore errors
    }
  } catch (err) {
    const msg = err?.message ?? String(err);
    setStatus(t('status.connectFailed'), msg);
    setUiConnected(false);
  }
}

function handleDisconnect() {
  ble.disconnect();
}

async function handleBootloader() {
  const confirmed = window.confirm(t('confirm.bootloader'));
  if (!confirmed) return;
  try {
    await ble.requestBootloader();
  } catch (err) {
    const msg = err?.message ?? String(err);
    setStatus(t('status.bootloaderFailed'), msg);
  }
}

async function handleSaveNickname() {
  const nickname = els.deviceNickname?.value ?? '';
  try {
    const saved = await ble.writeDeviceNickname(nickname);
    if (els.deviceNickname) els.deviceNickname.value = saved;
  } catch (err) {
    const msg = err?.message ?? String(err);
    setStatus(t('status.nicknameFailed'), msg);
  }
}

// ---------------------------------------------------------------------------
// BLE event handlers
// ---------------------------------------------------------------------------

function onBleConnect() {
  const scrollAvail = ble.getChar(ble.SCROLL_CHAR_UUID) ? 'scroll:OK' : 'scroll:N/A';
  setStatus(t('status.connected'), `${ble.getDeviceName() || 'BLE Device'} (${scrollAvail})`);
  setUiConnected(true);
}

function onBleDisconnect() {
  setStatus(t('status.disconnected'), '');
  setUiConnected(false);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function switchRoute(route) {
  // Destroy current module
  if (currentRoute === 'text' && textModule) textModule.destroy();
  if (currentRoute === 'files' && filesModule) filesModule.destroy();
  if (currentRoute === 'scroll' && scrollModule) scrollModule.destroy();

  const mainContainer = document.getElementById('mainContainer');
  const sidebarExtra = document.getElementById('sidebarExtra');
  const homeSection = document.getElementById('homeSection');
  const featureLayout = document.getElementById('featureLayout');

  if (route === 'home') {
    homeSection.hidden = false;
    featureLayout.hidden = true;
    mainContainer.textContent = '';
    sidebarExtra.textContent = '';
  } else {
    homeSection.hidden = true;
    featureLayout.hidden = false;
    mainContainer.textContent = '';
    sidebarExtra.textContent = '';

    if (route === 'text') {
      if (!textModule) textModule = await import('./text.js');
      textModule.init(mainContainer, sidebarExtra);
    } else if (route === 'files') {
      if (!filesModule) filesModule = await import('./files.js');
      filesModule.init(mainContainer, sidebarExtra);
    } else if (route === 'scroll') {
      if (!scrollModule) scrollModule = await import('./scroll.js');
      scrollModule.init(mainContainer, sidebarExtra);
    }
  }

  // Update active tab
  document.querySelectorAll('.tabLink').forEach(a => {
    const linkRoute = ROUTES[a.getAttribute('href')] || 'home';
    a.classList.toggle('tabActive', linkRoute === route);
  });

  currentRoute = route;
}

// ---------------------------------------------------------------------------
// main() — exported, called from index.html
// ---------------------------------------------------------------------------

export async function main() {
  await initI18n({ basePath: '.' });

  els = {
    btnConnect:       document.getElementById('btnConnect'),
    btnDisconnect:    document.getElementById('btnDisconnect'),
    btnBootloader:    document.getElementById('btnBootloader'),
    btnApplyNickname: document.getElementById('btnApplyNickname'),
    deviceNickname:   document.getElementById('deviceNickname'),
    statusText:       document.getElementById('statusText'),
    detailsText:      document.getElementById('detailsText'),
  };

  els.btnConnect?.addEventListener('click', handleConnect);
  els.btnDisconnect?.addEventListener('click', handleDisconnect);
  els.btnBootloader?.addEventListener('click', handleBootloader);
  els.btnApplyNickname?.addEventListener('click', handleSaveNickname);

  ble.on('connect', onBleConnect);
  ble.on('disconnect', onBleDisconnect);

  setUiConnected(false);

  const route = getRoute();
  await switchRoute(route);

  window.addEventListener('hashchange', async () => {
    await switchRoute(getRoute());
  });
}
