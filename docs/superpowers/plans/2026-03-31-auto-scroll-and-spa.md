# Auto Scroll Down + SPA 전환 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬: superpowers:subagent-driven-development (권장) 또는 superpowers:executing-plans를 사용하여 이 계획을 태스크 단위로 구현하세요. 각 단계는 체크박스(`- [ ]`) 문법으로 추적합니다.

**목표:** BLE 연결을 유지하면서 탭으로 전환하는 SPA 구조로 변경하고, Auto Scroll Down 기능을 추가한다.

**아키텍처:** index.html을 SPA 쉘로 변환하여 hash 라우팅(#text, #files, #scroll)으로 기능 전환. BLE 연결 로직을 ble.js로 추출하여 공유. 각 기능 모듈은 init()/destroy() 패턴으로 탭 전환 시 활성화/비활성화. 펌웨어에 scroll BLE characteristic 추가.

**기술 스택:** Web Bluetooth API, ES Modules, nRF52840 (Adafruit_TinyUSB_Arduino), PlatformIO

**보안 참고:** 이 프로젝트의 웹 UI는 로컬 파일 또는 HTTPS를 통해 제공되며, 모든 HTML 콘텐츠는 개발자가 작성한 하드코딩된 문자열이다. 사용자 입력이나 외부 데이터가 innerHTML에 삽입되지 않으므로 XSS 위험은 없다. 기존 text.html/files.html의 인라인 HTML을 JS로 옮기는 것이며, data-i18n-html 속성도 기존 패턴을 따른다.

---

## 파일 구조

### 새로 생성
- `web/ble.js` — BLE 연결 공유 모듈 (connect/disconnect/characteristics/Device UI)
- `web/app.js` — SPA 쉘, 탭 라우팅, 공통 레이아웃 관리
- `web/scroll.js` — Auto Scroll Down 기능 모듈

### 수정
- `index.html` — SPA 쉘로 변환 (탭 네비게이션 + 컨테이너)
- `web/text.js` — BLE 코드 제거, init()/destroy() 패턴으로 리팩터링
- `web/files.js` — BLE 코드 제거, init()/destroy() 패턴으로 리팩터링
- `web/style.css` — 탭 네비게이션 스타일 추가
- `web/i18n.js` — basePath 기본값 변경 (SPA에서는 '.' 사용)
- `lang/en.json` — scroll 관련 키 추가, home 카드 추가
- `lang/ko.json` — scroll 관련 키 추가, home 카드 추가
- `src/main.cpp` — scroll characteristic, callback, loop 로직 추가

### 삭제
- `web/text.html` — text.js의 init()으로 이동
- `web/files.html` — files.js의 init()으로 이동

---

## Task 1: 펌웨어 — Auto Scroll BLE Characteristic 추가

**파일:**
- 수정: `src/main.cpp`

- [ ] **Step 1: UUID 및 상태 변수 추가**

`src/main.cpp`의 UUID 섹션(기존 `kNicknameCharUuid` 뒤)에 scroll UUID를 추가한다:

```cpp
static const char* kScrollCharUuid = "f3641407-00b0-4240-ba50-05ca45bf8abc";
```

Mouse Jiggler 상태 변수 뒤(기존 `g_last_flush_activity_ms` 뒤)에 scroll 상태 변수를 추가한다:

```cpp
// -----------------------------
// Auto Scroll (BLE 제어)
// -----------------------------
static volatile bool g_scroll_active = false;
static volatile uint16_t g_scroll_interval_ms = 100;
static uint32_t g_scroll_last_ms = 0;
```

- [ ] **Step 2: BLECharacteristic 선언 추가**

기존 `BLECharacteristic bootloader_char` 뒤에 추가:

```cpp
BLECharacteristic scroll_char(kScrollCharUuid);
```

- [ ] **Step 3: scroll_write_cb 콜백 작성**

`bootloader_write_cb` 뒤에 추가:

```cpp
static void scroll_write_cb(uint16_t /*conn_hdl*/, BLECharacteristic* /*chr*/, uint8_t* data, uint16_t len) {
  // 포맷: [command(u8)][interval_ms(u16 LE)]
  // command: 0x00=stop, 0x01=start
  if (len < 1) return;

  const uint8_t cmd = data[0];
  if (cmd == 0x01 && len >= 3) {
    const uint16_t interval = static_cast<uint16_t>(data[1]) | (static_cast<uint16_t>(data[2]) << 8);
    g_scroll_interval_ms = clamp_u16(interval, 10, 2000);
    g_scroll_active = true;
    g_scroll_last_ms = millis();
  } else {
    g_scroll_active = false;
  }
}
```

- [ ] **Step 4: try_auto_scroll 함수 작성**

`try_jiggle_mouse()` 뒤에 추가:

```cpp
static void try_auto_scroll() {
  if (!g_scroll_active || !hid_ready()) return;

  // Flush 동작 중에는 스크롤 정지
  if (!is_flush_idle()) return;

  const uint32_t now = millis();
  if (now - g_scroll_last_ms < g_scroll_interval_ms) return;

  usb_hid.mouseScroll(kReportIdMouse, -1, 0);
  g_scroll_last_ms = now;
}
```

- [ ] **Step 5: BLE disconnect 시 스크롤 정지**

`ble_disconnect_cb` 함수 내 `log_line("BLE 연결 해제됨");` 줄 바로 앞에 추가:

```cpp
    g_scroll_active = false;
```

- [ ] **Step 6: setup()에서 scroll characteristic 등록**

`bootloader_char.begin();` 뒤에 추가:

```cpp
  // Auto Scroll (BLE 제어)
  scroll_char.setProperties(CHR_PROPS_WRITE);
  scroll_char.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  scroll_char.setWriteCallback(scroll_write_cb);
  scroll_char.begin();
```

그리고 로그 출력 섹션에도 추가:

```cpp
  log_kv("Scroll UUID", kScrollCharUuid);
```

- [ ] **Step 7: loop()에서 try_auto_scroll 호출**

`try_jiggle_mouse();` 호출 뒤에 추가:

```cpp
  try_auto_scroll();
```

- [ ] **Step 8: 빌드 확인**

실행: `cd /home/aidan/projects/src-byte-flusher && pio run`
기대 결과: 컴파일 성공

- [ ] **Step 9: 커밋**

```bash
git add src/main.cpp
git commit -m "feat: add auto scroll BLE characteristic (f3641407)"
```

---

## Task 2: i18n — scroll 관련 번역 키 추가

**파일:**
- 수정: `lang/en.json`
- 수정: `lang/ko.json`

- [ ] **Step 1: lang/en.json에 scroll 섹션 추가**

`"home"` 객체에 2개의 키를 추가:

```json
"autoScroll": "🔽 Auto Scroll",
"autoScrollDesc": "Auto scroll down on Target PC"
```

최상위에 `"scroll"` 섹션 추가:

```json
"scroll": {
  "title": "Auto Scroll Down",
  "speed": "Scroll Speed",
  "speedSlow": "Slow",
  "speedFast": "Fast",
  "start": "Start",
  "stop": "Stop",
  "statusScrolling": "Scrolling...",
  "statusStopped": "Stopped",
  "connectFirst": "Connect a device first.",
  "noteScroll": "Scroll speed is set before starting and cannot be changed during scrolling."
}
```

- [ ] **Step 2: lang/ko.json에 scroll 섹션 추가**

`"home"` 객체에 2개의 키를 추가:

```json
"autoScroll": "🔽 자동 스크롤",
"autoScrollDesc": "Target PC에서 자동으로 아래로 스크롤"
```

최상위에 `"scroll"` 섹션 추가:

```json
"scroll": {
  "title": "자동 스크롤 다운",
  "speed": "스크롤 속도",
  "speedSlow": "느림",
  "speedFast": "빠름",
  "start": "시작",
  "stop": "정지",
  "statusScrolling": "스크롤 중...",
  "statusStopped": "정지됨",
  "connectFirst": "장치를 먼저 연결하세요.",
  "noteScroll": "스크롤 속도는 시작 전에 설정하며, 스크롤 중에는 변경할 수 없습니다."
}
```

- [ ] **Step 3: 커밋**

```bash
git add lang/en.json lang/ko.json
git commit -m "feat: add i18n keys for auto scroll"
```

---

## Task 3: ble.js — 공유 BLE 연결 모듈 작성

**파일:**
- 생성: `web/ble.js`

- [ ] **Step 1: ble.js 작성**

text.js와 files.js에서 공통으로 사용하는 BLE 연결/해제 로직을 추출한다. 기존 text.js의 connect/disconnect/reconnectLoop 패턴을 기반으로 한다.

```javascript
// Shared BLE connection manager for ByteFlusher SPA
// - Single source of truth for BLE UUIDs, connection state, and device management
// - Used by all feature modules (text, files, scroll)

import { t } from './i18n.js';

// BLE UUIDs (firmware src/main.cpp와 일치)
export const SERVICE_UUID = 'f3641400-00b0-4240-ba50-05ca45bf8abc';
export const FLUSH_TEXT_CHAR_UUID = 'f3641401-00b0-4240-ba50-05ca45bf8abc';
export const CONFIG_CHAR_UUID = 'f3641402-00b0-4240-ba50-05ca45bf8abc';
export const STATUS_CHAR_UUID = 'f3641403-00b0-4240-ba50-05ca45bf8abc';
export const MACRO_CHAR_UUID = 'f3641404-00b0-4240-ba50-05ca45bf8abc';
export const BOOTLOADER_CHAR_UUID = 'f3641405-00b0-4240-ba50-05ca45bf8abc';
export const NICKNAME_CHAR_UUID = 'f3641406-00b0-4240-ba50-05ca45bf8abc';
export const SCROLL_CHAR_UUID = 'f3641407-00b0-4240-ba50-05ca45bf8abc';

const LS_DEVICE_NICKNAME = 'byteflusher.deviceNickname';

// --- 연결 상태 ---
let device = null;
let server = null;
const chars = {};  // uuid -> BLECharacteristic

let deviceBufCapacity = null;
let deviceBufFree = null;
let deviceBufUpdatedAt = 0;
let statusWaiters = [];

// 연결/해제 이벤트 리스너
const listeners = { connect: [], disconnect: [], status: [] };

export function on(event, fn) {
  if (listeners[event]) listeners[event].push(fn);
}

export function off(event, fn) {
  if (listeners[event]) {
    listeners[event] = listeners[event].filter(f => f !== fn);
  }
}

function emit(event, ...args) {
  for (const fn of (listeners[event] || [])) {
    try { fn(...args); } catch { /* ignore */ }
  }
}

export function isConnected() {
  return Boolean(device?.gatt?.connected);
}

export function getDevice() {
  return device;
}

export function getChar(uuid) {
  return chars[uuid] || null;
}

export function getDeviceBufCapacity() { return deviceBufCapacity; }
export function getDeviceBufFree() { return deviceBufFree; }
export function getDeviceBufUpdatedAt() { return deviceBufUpdatedAt; }

export function addStatusWaiter(fn) {
  statusWaiters.push(fn);
}

function resolveStatusWaiters() {
  const waiters = statusWaiters;
  statusWaiters = [];
  for (const fn of waiters) {
    try { fn(); } catch { /* ignore */ }
  }
}

function handleStatusValue(dataView) {
  if (!dataView || dataView.byteLength < 4) return;
  const cap = dataView.getUint16(0, true);
  const free = dataView.getUint16(2, true);
  if (Number.isFinite(cap) && cap > 0) deviceBufCapacity = cap;
  if (Number.isFinite(free) && free >= 0) deviceBufFree = free;
  deviceBufUpdatedAt = performance.now();
  resolveStatusWaiters();
  emit('status', { capacity: deviceBufCapacity, free: deviceBufFree });
}

export async function readStatusOnce() {
  const sc = chars[STATUS_CHAR_UUID];
  if (!sc) return;
  try {
    const v = await sc.readValue();
    handleStatusValue(v);
  } catch { /* ignore */ }
}

// --- 닉네임 ---
export function sanitizeNickname(raw) {
  return String(raw ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
}

export function loadSavedNickname() {
  return sanitizeNickname(localStorage.getItem(LS_DEVICE_NICKNAME) || '');
}

export function saveNicknameToLocalStorage(v) {
  const s = sanitizeNickname(v);
  if (s) localStorage.setItem(LS_DEVICE_NICKNAME, s);
  else localStorage.removeItem(LS_DEVICE_NICKNAME);
}

export async function readDeviceNicknameOnce() {
  const nc = chars[NICKNAME_CHAR_UUID];
  if (!nc) return '';
  try {
    const v = await nc.readValue();
    const u8 = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    return sanitizeNickname(new TextDecoder().decode(u8));
  } catch { return ''; }
}

export async function writeDeviceNickname(nickname) {
  const nc = chars[NICKNAME_CHAR_UUID];
  if (!nc) throw new Error(t('error.noNicknameChar'));
  const s = sanitizeNickname(nickname);
  const raw = String(nickname ?? '').trim();
  if (raw && !s) throw new Error(t('error.nicknameInvalid'));
  if (!s) {
    await nc.writeValue(Uint8Array.of(0));
  } else {
    await nc.writeValue(new TextEncoder().encode(s));
  }
  saveNicknameToLocalStorage(s);
  return s;
}

// --- 부트로더 ---
export async function requestBootloader() {
  const bc = chars[BOOTLOADER_CHAR_UUID];
  if (!bc) throw new Error(t('error.noBootloaderChar'));
  await bc.writeValue(Uint8Array.of(1));
}

// --- 연결 실패 도움말 ---
function getConnectFailureHelpText(err) {
  const name = (err?.name ?? '').toString();
  const msg = (err?.message ?? String(err ?? '')).toString();
  if (/No\s+Characteristics\s+matching\s+UUID/i.test(msg) || /No\s+Services\s+matching\s+UUID/i.test(msg)) {
    return t('error.gattNotFound');
  }
  if (name === 'NotSupportedError') return t('error.notSupported');
  if (name === 'NotAllowedError') return t('error.notAllowed');
  return t('error.connectFailed', { msg });
}

// --- 내부: characteristic 획득 ---
async function acquireCharacteristics(service) {
  // 필수
  chars[FLUSH_TEXT_CHAR_UUID] = await service.getCharacteristic(FLUSH_TEXT_CHAR_UUID);

  // 선택적 characteristic들
  const optionalUuids = [
    CONFIG_CHAR_UUID,
    STATUS_CHAR_UUID,
    MACRO_CHAR_UUID,
    BOOTLOADER_CHAR_UUID,
    NICKNAME_CHAR_UUID,
    SCROLL_CHAR_UUID,
  ];
  for (const uuid of optionalUuids) {
    try { chars[uuid] = await service.getCharacteristic(uuid); }
    catch { chars[uuid] = null; }
  }

  // Status notification 구독
  const sc = chars[STATUS_CHAR_UUID];
  if (sc) {
    sc.addEventListener('characteristicvaluechanged', (ev) => {
      handleStatusValue(ev?.target?.value);
    });
    await sc.startNotifications();
    await readStatusOnce();
  }
}

function clearState() {
  server = null;
  for (const k of Object.keys(chars)) chars[k] = null;
  deviceBufCapacity = null;
  deviceBufFree = null;
  deviceBufUpdatedAt = 0;
  resolveStatusWaiters();
}

// --- 연결 ---
export async function connect() {
  if (!navigator.bluetooth) throw new Error(t('error.noWebBluetooth'));

  const requestOptions = {
    filters: [{ services: [SERVICE_UUID] }, { namePrefix: 'ByteFlusher' }],
    optionalServices: [SERVICE_UUID],
  };

  try {
    device = await navigator.bluetooth.requestDevice(requestOptions);
  } catch (err) {
    if ((err?.name ?? '') === 'NotFoundError') {
      return { cancelled: true };
    }
    throw err;
  }

  device.addEventListener('gattserverdisconnected', () => {
    clearState();
    emit('disconnect');
  });

  try {
    server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    await acquireCharacteristics(service);
  } catch (err) {
    clearState();
    throw new Error(getConnectFailureHelpText(err));
  }

  emit('connect', device);
  return { cancelled: false, device };
}

// --- 재연결 (전송 중 끊김 시) ---
export async function reconnect() {
  if (!device) throw new Error(t('error.noDevice'));

  if (!device.gatt.connected) {
    server = await device.gatt.connect();
  } else {
    server = device.gatt;
  }

  const service = await server.getPrimaryService(SERVICE_UUID);
  await acquireCharacteristics(service);

  emit('connect', device);
}

// --- 해제 ---
export function disconnect() {
  if (device?.gatt?.connected) {
    device.gatt.disconnect();
  }
}

// --- 유틸리티 ---
export function getDeviceName() {
  return device?.name ?? '';
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/ble.js
git commit -m "feat: add shared BLE connection module (ble.js)"
```

---

## Task 4: app.js — SPA 쉘 및 탭 라우팅 작성

**파일:**
- 생성: `web/app.js`

- [ ] **Step 1: app.js 작성**

```javascript
// SPA shell: tab routing, common sidebar (Device), module lifecycle
import { initI18n, t, applyDom } from './i18n.js';
import * as ble from './ble.js';

// 모듈은 lazy import
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

// --- Device UI (공통 사이드바) ---
function setStatus(text, details = '') {
  if (els.statusText) els.statusText.textContent = text;
  if (els.detailsText) els.detailsText.textContent = details;
}

function setUiConnected(connected) {
  if (els.btnConnect) els.btnConnect.disabled = connected;
  if (els.btnDisconnect) els.btnDisconnect.disabled = !connected;
  if (els.btnBootloader) els.btnBootloader.disabled = !connected || !ble.getChar(ble.BOOTLOADER_CHAR_UUID);
  if (els.btnApplyNickname) els.btnApplyNickname.disabled = !connected || !ble.getChar(ble.NICKNAME_CHAR_UUID);
}

async function handleConnect() {
  try {
    setStatus(t('status.selectingDevice'), t('status.selectDevicePopup'));
    const result = await ble.connect();
    if (result.cancelled) {
      setStatus(t('status.disconnected'), '');
      setUiConnected(false);
      return;
    }
    // 닉네임 로드
    if (els.deviceNickname) {
      const deviceNick = await ble.readDeviceNicknameOnce();
      const fallback = ble.loadSavedNickname();
      els.deviceNickname.value = ble.sanitizeNickname(deviceNick || fallback);
    }
    setStatus(t('status.connected'), `${ble.getDeviceName() || 'ByteFlusher'} / ${ble.SERVICE_UUID}`);
    setUiConnected(true);
  } catch (err) {
    setStatus(t('status.connectionFailed'), err?.message ?? String(err));
    setUiConnected(false);
  }
}

function handleDisconnect() {
  ble.disconnect();
}

async function handleBootloader() {
  if (!ble.isConnected()) return;
  const ok = confirm(t('confirm.bootloader'));
  if (!ok) return;
  setStatus(t('status.rebootRequesting'), t('status.rebootEntering'));
  try {
    await ble.requestBootloader();
  } catch (err) {
    setStatus(t('status.failed'), t('error.bootloaderRequestFailed', { msg: String(err?.message ?? err ?? '') }));
  }
}

async function handleSaveNickname() {
  if (!ble.isConnected()) return;
  const raw = els.deviceNickname?.value ?? '';
  try {
    const saved = await ble.writeDeviceNickname(raw);
    if (els.deviceNickname) els.deviceNickname.value = saved;
    setStatus(t('status.connected'), t('status.nicknameSaved', { name: saved || '-' }));
  } catch (err) {
    setStatus(t('status.error'), err?.message ?? String(err));
  }
}

// --- 라우팅 ---
async function switchRoute(route) {
  // 현재 모듈 파괴
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

  // 탭 활성 상태 업데이트
  document.querySelectorAll('.tabLink').forEach(a => {
    const linkRoute = ROUTES[a.getAttribute('href')] || 'home';
    a.classList.toggle('tabActive', linkRoute === route);
  });

  currentRoute = route;
}

// --- BLE 이벤트 ---
function onBleConnect() {
  setStatus(t('status.connected'), `${ble.getDeviceName() || 'ByteFlusher'} / ${ble.SERVICE_UUID}`);
  setUiConnected(true);
}

function onBleDisconnect() {
  setStatus(t('status.disconnected'), '');
  setUiConnected(false);
}

// --- 초기화 ---
export async function main() {
  await initI18n({ basePath: '.' });

  els = {
    btnConnect: document.getElementById('btnConnect'),
    btnDisconnect: document.getElementById('btnDisconnect'),
    btnBootloader: document.getElementById('btnBootloader'),
    btnApplyNickname: document.getElementById('btnApplyNickname'),
    deviceNickname: document.getElementById('deviceNickname'),
    statusText: document.getElementById('statusText'),
    detailsText: document.getElementById('detailsText'),
  };

  // 이벤트 바인딩
  els.btnConnect?.addEventListener('click', handleConnect);
  els.btnDisconnect?.addEventListener('click', handleDisconnect);
  els.btnBootloader?.addEventListener('click', handleBootloader);
  els.btnApplyNickname?.addEventListener('click', handleSaveNickname);

  // BLE 이벤트
  ble.on('connect', onBleConnect);
  ble.on('disconnect', onBleDisconnect);

  // 초기 라우팅
  const route = getRoute();
  await switchRoute(route);

  // hash 변경 시 라우팅
  window.addEventListener('hashchange', async () => {
    const route = getRoute();
    await switchRoute(route);
  });
}

// app 전역: 모듈에서 사용할 상태/도구
export { setStatus, setUiConnected };
```

- [ ] **Step 2: 커밋**

```bash
git add web/app.js
git commit -m "feat: add SPA shell with tab routing (app.js)"
```

---

## Task 5: index.html — SPA 쉘로 변환

**파일:**
- 수정: `index.html`

- [ ] **Step 1: index.html을 SPA 쉘로 변환**

기존 index.html 전체를 교체한다. 구조:
- 헤더: 탭 네비게이션 (Home, Text Flush, File Flush, Auto Scroll)
- 공통 사이드바: Device 섹션 (Connect/Disconnect/Bootloader/Nickname)
- homeSection: 기존 홈 콘텐츠 (카드 3개 포함 Auto Scroll 추가)
- featureLayout: sidebar + mainContainer (기능 모듈이 렌더링)

핵심 변경:
1. 기존 nav 링크를 hash 기반 `.tabLink`로 변경
2. homeSection과 featureLayout을 조건부 hidden으로 전환
3. featureLayout 내에 공통 Device 섹션 + sidebarExtra 컨테이너 + mainContainer
4. 홈 카드 그리드를 2열에서 3열로 변경(Auto Scroll 카드 추가)
5. script를 `import { main } from './web/app.js'; main();`으로 변경

index.html의 전체 내용은 이 Task의 Step 1 설명 그대로 구현하면 된다.
기존 text.html/files.html의 Device 섹션 HTML을 featureLayout 내 공통 사이드바로 한 번만 작성한다.

- [ ] **Step 2: 커밋**

```bash
git add index.html
git commit -m "feat: convert index.html to SPA shell with tab routing"
```

---

## Task 6: style.css — 탭 네비게이션 스타일 추가

**파일:**
- 수정: `web/style.css`

- [ ] **Step 1: 탭 활성 상태 스타일 추가**

파일 끝에 추가:

```css
/* SPA tab active state */
.tabLink {
  text-decoration: none;
}

.tabLink.tabActive {
  color: var(--accent) !important;
  font-weight: 700;
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/style.css
git commit -m "feat: add tab active state styles"
```

---

## Task 7: scroll.js — Auto Scroll 기능 모듈 작성

**파일:**
- 생성: `web/scroll.js`

- [ ] **Step 1: scroll.js 작성**

```javascript
// Auto Scroll Down feature module
// - Speed slider (30ms ~ 500ms interval)
// - Start / Stop buttons
// - BLE command: [cmd(u8)][interval_ms(u16 LE)]
import { t, applyDom } from './i18n.js';
import * as ble from './ble.js';

const LS_SCROLL_INTERVAL = 'byteflusher.scrollIntervalMs';
const DEFAULT_INTERVAL = 100;
const MIN_INTERVAL = 30;
const MAX_INTERVAL = 500;

let scrolling = false;
let els = {};
let disconnectHandler = null;

function loadInterval() {
  const raw = localStorage.getItem(LS_SCROLL_INTERVAL);
  if (raw == null) return DEFAULT_INTERVAL;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL;
  return Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, n));
}

function saveInterval(v) {
  localStorage.setItem(LS_SCROLL_INTERVAL, String(v));
}

function sliderToInterval(sliderValue) {
  // 슬라이더 0(빠름) ~ 100(느림) -> interval 30ms ~ 500ms
  return Math.round(MIN_INTERVAL + (MAX_INTERVAL - MIN_INTERVAL) * (sliderValue / 100));
}

function intervalToSlider(interval) {
  return Math.round(((interval - MIN_INTERVAL) / (MAX_INTERVAL - MIN_INTERVAL)) * 100);
}

function updateSpeedLabel() {
  if (!els.speedValue) return;
  const interval = sliderToInterval(Number(els.speedSlider?.value ?? 50));
  els.speedValue.textContent = `${interval}ms`;
}

function setScrollingUi(isScrolling) {
  scrolling = isScrolling;
  if (els.btnStart) els.btnStart.disabled = isScrolling || !ble.isConnected();
  if (els.btnStop) els.btnStop.disabled = !isScrolling;
  if (els.speedSlider) els.speedSlider.disabled = isScrolling;
  if (els.scrollStatus) {
    els.scrollStatus.textContent = isScrolling ? t('scroll.statusScrolling') : t('scroll.statusStopped');
  }
}

async function sendScrollCommand(cmd, intervalMs) {
  const sc = ble.getChar(ble.SCROLL_CHAR_UUID);
  if (!sc) return;
  const buf = new Uint8Array(3);
  buf[0] = cmd;
  buf[1] = intervalMs & 0xff;
  buf[2] = (intervalMs >> 8) & 0xff;
  await sc.writeValue(buf);
}

async function handleStart() {
  if (!ble.isConnected()) return;
  const interval = sliderToInterval(Number(els.speedSlider?.value ?? 50));
  saveInterval(interval);
  try {
    await sendScrollCommand(0x01, interval);
    setScrollingUi(true);
  } catch (err) {
    // 오류 시 상태 유지
  }
}

async function handleStop() {
  try {
    await sendScrollCommand(0x00, 0);
  } catch {
    // BLE 끊김 등 무시
  }
  setScrollingUi(false);
}

function onDisconnect() {
  setScrollingUi(false);
}

function onConnect() {
  setScrollingUi(false);
}

// --- DOM 생성 헬퍼 ---
function createSidebarContent(savedInterval) {
  const sliderVal = intervalToSlider(savedInterval);
  const section = document.createElement('section');
  section.className = 'card';

  const title = document.createElement('h2');
  title.className = 'sidebarTitle';
  title.setAttribute('data-i18n', 'scroll.speed');
  title.textContent = 'Scroll Speed';
  section.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'grid2';

  // 슬라이더 행
  const sliderRow = document.createElement('div');
  sliderRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const fastLabel = document.createElement('span');
  fastLabel.className = 'muted small';
  fastLabel.setAttribute('data-i18n', 'scroll.speedFast');
  fastLabel.textContent = 'Fast';

  const slider = document.createElement('input');
  slider.id = 'scrollSpeedSlider';
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(sliderVal);
  slider.style.flex = '1';

  const slowLabel = document.createElement('span');
  slowLabel.className = 'muted small';
  slowLabel.setAttribute('data-i18n', 'scroll.speedSlow');
  slowLabel.textContent = 'Slow';

  sliderRow.append(fastLabel, slider, slowLabel);
  grid.appendChild(sliderRow);

  // 값 표시
  const valueDiv = document.createElement('div');
  valueDiv.className = 'muted small';
  valueDiv.style.textAlign = 'center';
  const valueSpan = document.createElement('span');
  valueSpan.id = 'scrollSpeedValue';
  valueSpan.textContent = `${savedInterval}ms`;
  valueDiv.appendChild(valueSpan);
  grid.appendChild(valueDiv);

  section.appendChild(grid);

  // 참고 문구
  const note = document.createElement('p');
  note.className = 'muted small';
  note.style.marginTop = '8px';
  note.setAttribute('data-i18n', 'scroll.noteScroll');
  note.textContent = 'Scroll speed is set before starting and cannot be changed during scrolling.';
  section.appendChild(note);

  return section;
}

function createMainContent() {
  const fragment = document.createDocumentFragment();

  const title = document.createElement('h2');
  title.className = 'settingsTitle';
  title.style.marginTop = '0';
  title.setAttribute('data-i18n', 'scroll.title');
  title.textContent = 'Auto Scroll Down';
  fragment.appendChild(title);

  // 버튼 행
  const row = document.createElement('div');
  row.className = 'row';
  row.style.marginTop = '24px';

  const btnStart = document.createElement('button');
  btnStart.id = 'scrollBtnStart';
  btnStart.className = 'primary controlButton';
  btnStart.disabled = true;
  btnStart.setAttribute('data-i18n', 'scroll.start');
  btnStart.textContent = 'Start';

  const btnStop = document.createElement('button');
  btnStop.id = 'scrollBtnStop';
  btnStop.className = 'danger controlButton';
  btnStop.disabled = true;
  btnStop.setAttribute('data-i18n', 'scroll.stop');
  btnStop.textContent = 'Stop';

  row.append(btnStart, btnStop);
  fragment.appendChild(row);

  // 힌트
  const hint = document.createElement('div');
  hint.className = 'muted small';
  hint.id = 'scrollHint';
  hint.style.marginTop = '8px';
  fragment.appendChild(hint);

  // 상태
  const statusDiv = document.createElement('div');
  statusDiv.style.marginTop = '16px';
  const statusLabel = document.createElement('span');
  statusLabel.className = 'label';
  statusLabel.setAttribute('data-i18n', 'common.status');
  statusLabel.textContent = 'Status';
  const statusValue = document.createElement('span');
  statusValue.id = 'scrollStatus';
  statusValue.className = 'muted small';
  statusValue.setAttribute('data-i18n', 'scroll.statusStopped');
  statusValue.textContent = ' Stopped';
  statusDiv.append(statusLabel, document.createTextNode(' '), statusValue);
  fragment.appendChild(statusDiv);

  return fragment;
}

// --- init / destroy ---
export function init(mainContainer, sidebarExtra) {
  const savedInterval = loadInterval();

  // 사이드바: Speed 설정 (DOM API 사용)
  sidebarExtra.appendChild(createSidebarContent(savedInterval));

  // 메인: Start/Stop + Status (DOM API 사용)
  mainContainer.appendChild(createMainContent());

  // DOM 참조
  els = {
    speedSlider: document.getElementById('scrollSpeedSlider'),
    speedValue: document.getElementById('scrollSpeedValue'),
    btnStart: document.getElementById('scrollBtnStart'),
    btnStop: document.getElementById('scrollBtnStop'),
    scrollStatus: document.getElementById('scrollStatus'),
    scrollHint: document.getElementById('scrollHint'),
  };

  // 이벤트 바인딩
  els.speedSlider?.addEventListener('input', () => {
    updateSpeedLabel();
  });

  els.btnStart?.addEventListener('click', handleStart);
  els.btnStop?.addEventListener('click', handleStop);

  // BLE 이벤트
  disconnectHandler = onDisconnect;
  ble.on('disconnect', disconnectHandler);
  ble.on('connect', onConnect);

  // 초기 상태
  setScrollingUi(false);

  // 연결 상태에 따라 Start 활성화
  if (ble.isConnected()) {
    els.btnStart.disabled = false;
  } else {
    if (els.scrollHint) els.scrollHint.textContent = t('scroll.connectFirst');
  }

  // i18n 적용
  applyDom(sidebarExtra);
  applyDom(mainContainer);
}

export function destroy() {
  // 스크롤 중이면 정지
  if (scrolling) {
    sendScrollCommand(0x00, 0).catch(() => {});
    scrolling = false;
  }

  // 이벤트 해제
  if (disconnectHandler) {
    ble.off('disconnect', disconnectHandler);
    ble.off('connect', onConnect);
    disconnectHandler = null;
  }

  els = {};
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/scroll.js
git commit -m "feat: add auto scroll down module (scroll.js)"
```

---

## Task 8: text.js — init()/destroy() 패턴으로 리팩터링

**파일:**
- 수정: `web/text.js`

이 태스크는 가장 큰 리팩터링이다. text.js의 핵심 변경:

1. BLE UUID 상수, 연결 상태 변수, connect/disconnect/reconnect 함수를 **삭제**하고 `ble.js`에서 import
2. `els` 객체를 전역이 아니라 `init()` 내에서 DOM 생성 후 바인딩
3. 기존 text.html의 사이드바(Cautions, Transfer Settings, Notes) HTML을 `init()`에서 sidebarExtra에 DOM API로 삽입
4. 기존 text.html의 메인 영역(textarea, 버튼, metrics) HTML을 `init()`에서 mainContainer에 DOM API로 삽입
5. `init(mainContainer, sidebarExtra)` / `destroy()` export
6. 기존 DOMContentLoaded 이벤트 초기화 로직을 init()으로 이동

- [ ] **Step 1: text.js 리팩터링**

파일 전체를 다음과 같이 변경한다:

1. 파일 상단의 UUID 상수들(SERVICE_UUID ~ NICKNAME_CHAR_UUID) 삭제, `import * as ble from './ble.js';` 로 대체
2. BLE 연결 상태 변수(device, server, flushChar, configChar, statusChar, bootloaderChar, nicknameChar, deviceBufCapacity, deviceBufFree, deviceBufUpdatedAt, statusWaiters) 삭제, `ble.getChar()`, `ble.getDeviceBufFree()` 등으로 대체
3. connect(), disconnect(), reconnectLoop(), requestBootloader(), 닉네임 관련 함수(sanitizeNickname, loadSavedNickname, saveNicknameToLocalStorage, setNicknameUiValue, readDeviceNicknameOnce, writeDeviceNickname) 삭제, ble.js 사용
4. handleStatusValue, readStatusOnce, resolveStatusWaiters 삭제, ble.js 사용
5. 모든 코드를 모듈 스코프 변수 + `init()`/`destroy()` 패턴으로 감싸기
6. 기존 text.html의 사이드바 HTML을 `init()`에서 sidebarExtra에 DOM API로 삽입
7. 기존 text.html의 메인 영역 HTML을 `init()`에서 mainContainer에 DOM API로 삽입
8. 기존 DOMContentLoaded 이벤트 초기화 로직을 init()으로 이동
9. `destroy()`에서: 이벤트 리스너 해제, 타이머(interval) 정리, BLE 이벤트 해제

**치환 규칙:**
- `flushChar` -> `ble.getChar(ble.FLUSH_TEXT_CHAR_UUID)`
- `configChar` -> `ble.getChar(ble.CONFIG_CHAR_UUID)`
- `statusChar` -> `ble.getChar(ble.STATUS_CHAR_UUID)`
- `device?.gatt?.connected` -> `ble.isConnected()`
- `device.name` -> `ble.getDeviceName()`
- `deviceBufFree` -> `ble.getDeviceBufFree()`
- `deviceBufCapacity` -> `ble.getDeviceBufCapacity()`
- `deviceBufUpdatedAt` -> `ble.getDeviceBufUpdatedAt()`
- `readStatusOnce()` -> `ble.readStatusOnce()`
- `statusWaiters.push(fn)` -> `ble.addStatusWaiter(fn)`
- reconnectLoop 내부의 characteristic 재획득은 `ble.reconnect()` 한 줄로 대체
- connect/disconnect 버튼 이벤트는 제거 (app.js가 관리)

**참고사항:**
- 기존의 비즈니스 로직(flushText, preprocessTextForFirmware, 한글 매핑, metrics 등)은 그대로 유지
- 기존 코드가 크므로(약 1100 lines), 구조만 변경하고 비즈니스 로직은 건드리지 않는다
- DOM 생성은 DOM API (createElement/appendChild)를 사용하여 XSS 위험을 제거한다

- [ ] **Step 2: 빌드/동작 확인**

브라우저에서 index.html을 열어 #text 탭에서 기존 Text Flush 기능이 정상 동작하는지 확인. 빌드 툴이 없으므로 수동 확인.

- [ ] **Step 3: 커밋**

```bash
git add web/text.js
git commit -m "refactor: convert text.js to init/destroy pattern using ble.js"
```

---

## Task 9: files.js — init()/destroy() 패턴으로 리팩터링

**파일:**
- 수정: `web/files.js`

Task 8과 동일한 패턴을 files.js에 적용한다.

- [ ] **Step 1: files.js 리팩터링**

text.js와 동일한 변경:
1. UUID 상수 삭제, `import * as ble from './ble.js';`
2. BLE 연결 상태 변수 삭제, ble.js API 사용
3. connect/disconnect/reconnect 함수 삭제, ble.js 사용
4. 닉네임, 부트로더, status 관련 함수 삭제, ble.js 사용
5. `init(mainContainer, sidebarExtra)` / `destroy()` export
6. 기존 files.html의 사이드바/메인 HTML을 JS에서 DOM API로 생성

**추가 참고:**
- files.js에는 `macroChar`도 있으므로 `ble.getChar(ble.MACRO_CHAR_UUID)`로 치환
- 기존 files.js의 비즈니스 로직(PowerShell 자동화, Base64 처리, SHA-256 검증 등)은 모두 그대로 유지
- DOM 생성은 DOM API (createElement/appendChild)를 사용

- [ ] **Step 2: 커밋**

```bash
git add web/files.js
git commit -m "refactor: convert files.js to init/destroy pattern using ble.js"
```

---

## Task 10: 기존 HTML 파일 삭제 및 i18n basePath 정리

**파일:**
- 삭제: `web/text.html`
- 삭제: `web/files.html`
- 확인: `web/i18n.js`

- [ ] **Step 1: text.html, files.html 삭제**

```bash
git rm web/text.html web/files.html
```

- [ ] **Step 2: i18n.js 확인**

현재 i18n.js의 `initI18n({ basePath })` 기본값은 `'..'`이다. SPA에서는 `'.'`으로 호출하므로 변경 불필요 (app.js에서 `initI18n({ basePath: '.' })` 호출).

text.js/files.js 상단에서 `initI18n()`을 호출하던 부분이 있다면 삭제 확인 (app.js에서 한 번만 호출).

- [ ] **Step 3: 커밋**

```bash
git add -A
git commit -m "chore: remove old HTML files, finalize SPA structure"
```

---

## Task 11: 통합 테스트 및 최종 확인

- [ ] **Step 1: 펌웨어 빌드 확인**

```bash
cd /home/aidan/projects/src-byte-flusher && pio run
```

기대: 컴파일 성공

- [ ] **Step 2: 웹 UI 확인 (브라우저)**

각 탭의 동작을 확인:
1. Home (#) — 카드 3개 표시 (Text Flush, File Flush, Auto Scroll)
2. Text Flush (#text) — 사이드바(Settings/Cautions/Notes) + 메인(textarea/버튼/metrics)
3. File Flush (#files) — 사이드바(Settings/Cautions/Notes) + 메인(파일선택/버튼/metrics)
4. Auto Scroll (#scroll) — 사이드바(Speed) + 메인(Start/Stop/Status)
5. 탭 전환 시 BLE 연결 유지 확인
6. BLE 연결/해제가 모든 탭에서 공통으로 동작

- [ ] **Step 3: 최종 커밋 (필요 시)**

모든 확인 후 필요한 수정 사항 반영.
