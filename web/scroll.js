// Auto Scroll Down module for ByteFlusher SPA
// Sends scroll commands to the device via BLE SCROLL_CHAR.
// Exported API: init(mainContainer, sidebarExtra), destroy()

import { t, applyDom } from './i18n.js';
import * as ble from './ble.js';

const LS_SCROLL_INTERVAL = 'byteflusher.scrollIntervalMs';
const DEFAULT_INTERVAL = 100;
const MIN_INTERVAL = 30;
const MAX_INTERVAL = 500;

// Scroll command bytes
const CMD_STOP  = 0x00;
const CMD_START = 0x01;

let scrolling = false;
let els = {};
let disconnectHandler = null;
let connectHandler = null;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function loadInterval() {
  const raw = localStorage.getItem(LS_SCROLL_INTERVAL);
  const v = parseInt(raw, 10);
  if (!isNaN(v) && v >= MIN_INTERVAL && v <= MAX_INTERVAL) return v;
  return DEFAULT_INTERVAL;
}

function saveInterval(v) {
  localStorage.setItem(LS_SCROLL_INTERVAL, String(v));
}

// ---------------------------------------------------------------------------
// Slider <-> interval mapping
// slider 0 = fast (MIN_INTERVAL ms), slider 100 = slow (MAX_INTERVAL ms)
// ---------------------------------------------------------------------------

function sliderToInterval(value) {
  const t = Number(value) / 100;
  return Math.round(MIN_INTERVAL + t * (MAX_INTERVAL - MIN_INTERVAL));
}

function intervalToSlider(interval) {
  const clamped = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, interval));
  return Math.round((clamped - MIN_INTERVAL) / (MAX_INTERVAL - MIN_INTERVAL) * 100);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function updateSpeedLabel() {
  if (!els.speedValue) return;
  const intervalMs = sliderToInterval(els.slider ? els.slider.value : intervalToSlider(loadInterval()));
  els.speedValue.textContent = intervalMs + ' ms';
}

function setScrollingUi(isScrolling) {
  scrolling = isScrolling;

  const connected = ble.isConnected();

  if (els.btnStart) {
    els.btnStart.disabled = isScrolling || !connected;
  }
  if (els.btnStop) {
    els.btnStop.disabled = !isScrolling;
  }
  if (els.slider) {
    els.slider.disabled = isScrolling;
  }
  if (els.statusDisplay) {
    els.statusDisplay.textContent = isScrolling
      ? t('scroll.statusScrolling')
      : t('scroll.statusStopped');
  }
}

// ---------------------------------------------------------------------------
// BLE command
// ---------------------------------------------------------------------------

async function sendScrollCommand(cmd, intervalMs) {
  const char = ble.getChar(ble.SCROLL_CHAR_UUID);
  if (!char) return;
  const buf = new ArrayBuffer(3);
  const view = new DataView(buf);
  view.setUint8(0, cmd);
  view.setUint16(1, intervalMs, true); // little-endian
  try {
    await char.writeValue(buf);
  } catch {
    // Best-effort; ignore errors (e.g. during disconnect)
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handleStart() {
  if (!ble.isConnected()) return;
  const intervalMs = sliderToInterval(els.slider ? els.slider.value : intervalToSlider(loadInterval()));
  saveInterval(intervalMs);
  sendScrollCommand(CMD_START, intervalMs);
  setScrollingUi(true);
}

function handleStop() {
  sendScrollCommand(CMD_STOP, 0);
  setScrollingUi(false);
}

// ---------------------------------------------------------------------------
// init / destroy
// ---------------------------------------------------------------------------

export function init(mainContainer, sidebarExtra) {
  // ---- Build sidebar DOM ----
  const sidebarCard = document.createElement('div');
  sidebarCard.className = 'card';

  const cardTitle = document.createElement('div');
  cardTitle.className = 'cardHeaderRow';
  const cardTitleText = document.createElement('span');
  cardTitleText.className = 'label';
  cardTitleText.setAttribute('data-i18n', 'scroll.speed');
  cardTitleText.textContent = t('scroll.speed');
  cardTitle.appendChild(cardTitleText);
  sidebarCard.appendChild(cardTitle);

  // Slider row: Fast — [slider] — Slow
  const sliderRow = document.createElement('div');
  sliderRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;';

  const fastLabel = document.createElement('span');
  fastLabel.setAttribute('data-i18n', 'scroll.speedFast');
  fastLabel.textContent = t('scroll.speedFast');
  fastLabel.style.fontSize = '12px';
  fastLabel.style.color = 'var(--muted)';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.style.flex = '1';

  const slowLabel = document.createElement('span');
  slowLabel.setAttribute('data-i18n', 'scroll.speedSlow');
  slowLabel.textContent = t('scroll.speedSlow');
  slowLabel.style.fontSize = '12px';
  slowLabel.style.color = 'var(--muted)';

  sliderRow.appendChild(fastLabel);
  sliderRow.appendChild(slider);
  sliderRow.appendChild(slowLabel);
  sidebarCard.appendChild(sliderRow);

  // Speed value display
  const speedValue = document.createElement('div');
  speedValue.style.cssText = 'margin-top:6px;font-size:12px;color:var(--muted);text-align:center;';
  sidebarCard.appendChild(speedValue);

  // Note text
  const noteText = document.createElement('p');
  noteText.setAttribute('data-i18n', 'scroll.noteScroll');
  noteText.textContent = t('scroll.noteScroll');
  noteText.style.cssText = 'margin-top:10px;font-size:11px;color:var(--muted);';
  sidebarCard.appendChild(noteText);

  sidebarExtra.appendChild(sidebarCard);

  // ---- Build main DOM ----
  const title = document.createElement('h2');
  title.setAttribute('data-i18n', 'scroll.title');
  title.textContent = t('scroll.title');
  title.style.marginBottom = '18px';
  mainContainer.appendChild(title);

  const btnStart = document.createElement('button');
  btnStart.className = 'controlButton primary';
  btnStart.setAttribute('data-i18n', 'scroll.start');
  btnStart.textContent = t('scroll.start');
  btnStart.style.marginRight = '10px';
  mainContainer.appendChild(btnStart);

  const btnStop = document.createElement('button');
  btnStop.className = 'controlButton danger';
  btnStop.setAttribute('data-i18n', 'scroll.stop');
  btnStop.textContent = t('scroll.stop');
  mainContainer.appendChild(btnStop);

  const hintText = document.createElement('div');
  hintText.style.cssText = 'margin-top:12px;font-size:13px;color:var(--muted);';
  mainContainer.appendChild(hintText);

  const statusDisplay = document.createElement('div');
  statusDisplay.style.cssText = 'margin-top:10px;font-size:14px;font-weight:600;';
  mainContainer.appendChild(statusDisplay);

  // ---- Cache element references ----
  els = { slider, speedValue, btnStart, btnStop, hintText, statusDisplay };

  // ---- Restore saved interval ----
  const savedInterval = loadInterval();
  slider.value = String(intervalToSlider(savedInterval));

  // ---- Wire events ----
  slider.addEventListener('input', updateSpeedLabel);
  btnStart.addEventListener('click', handleStart);
  btnStop.addEventListener('click', handleStop);

  // ---- BLE event subscriptions ----
  connectHandler = function () {
    if (els.hintText) els.hintText.textContent = '';
    setScrollingUi(scrolling);
  };
  disconnectHandler = function () {
    if (scrolling) {
      scrolling = false;
    }
    if (els.hintText) els.hintText.setAttribute('data-i18n', 'scroll.connectFirst');
    if (els.hintText) els.hintText.textContent = t('scroll.connectFirst');
    setScrollingUi(false);
  };

  ble.on('connect', connectHandler);
  ble.on('disconnect', disconnectHandler);

  // ---- Initial UI state ----
  scrolling = false;
  if (!ble.isConnected()) {
    hintText.setAttribute('data-i18n', 'scroll.connectFirst');
    hintText.textContent = t('scroll.connectFirst');
  }
  setScrollingUi(false);

  // ---- Apply i18n ----
  applyDom(sidebarExtra);
  applyDom(mainContainer);

  // ---- Update speed label after DOM is ready ----
  updateSpeedLabel();
}

export function destroy() {
  if (scrolling) {
    // Fire-and-forget stop command
    sendScrollCommand(CMD_STOP, 0).catch(() => {});
    scrolling = false;
  }

  if (disconnectHandler) {
    ble.off('disconnect', disconnectHandler);
    disconnectHandler = null;
  }
  if (connectHandler) {
    ble.off('connect', connectHandler);
    connectHandler = null;
  }

  els = {};
}
