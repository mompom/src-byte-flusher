# Auto Scroll Down + SPA 전환 구현 계획 (v2)

> **에이전트 작업자용:** 필수 하위 스킬: superpowers:subagent-driven-development (권장) 또는 superpowers:executing-plans를 사용하여 이 계획을 태스크 단위로 구현하세요. 각 단계는 체크박스(`- [ ]`) 문법으로 추적합니다.

**목표:** BLE 연결을 유지하면서 탭으로 전환하는 SPA 구조로 변경하고, Auto Scroll Down 기능을 추가한다.

**아키텍처:** index.html을 SPA 쉘로 변환하여 hash 라우팅(#text, #files, #scroll)으로 기능 전환. BLE 연결 로직을 ble.js로 추출하여 공유. 각 기능 모듈은 init()/destroy() 패턴으로 탭 전환 시 활성화/비활성화. 펌웨어에 scroll BLE characteristic 추가.

**기술 스택:** Web Bluetooth API, ES Modules, nRF52840 (Adafruit_TinyUSB_Arduino), PlatformIO

---

## 컨텍스트 오염 방지 전략

### 문제
- text.js (~1476줄), files.js (~2420줄)의 대규모 리팩터링에서 컨텍스트 윈도우 압축 시 정합성 손실 위험

### 대응

1. **BLE API 레퍼런스 파일** (`docs/superpowers/plans/ble-api-reference.md`)
   - ble.js의 전체 export 목록, 시그니처, 사용 예시를 한 파일에 정리
   - 모든 에이전트가 리팩터링 작업 시작 시 이 파일을 먼저 읽음
   - 컨텍스트가 압축되더라도 파일에서 재확인 가능

2. **로컬 앨리어스 패턴** — 비즈니스 로직 최소 변경
   - 기존: `flushChar.writeValue(...)` (모듈 변수)
   - 변경: init() 상단에서 `const flushChar = () => ble.getChar(ble.FLUSH_TEXT_CHAR_UUID);`
   - 사용부: `flushChar().writeValue(...)` (괄호 하나만 추가)
   - 이 패턴으로 1000줄+ 비즈니스 로직 코드의 변경량을 최소화

3. **마이크로 스텝 분해** — 각 스텝은 하나의 관심사만 변경
   - 기존 Task 8 (text.js 전체 리팩터링) → 6개 서브 태스크로 분해
   - 각 서브 태스크는 커밋 포인트

4. **검증 게이트** — 리팩터링 완료 후 코드 리뷰 에이전트가 정합성 검증
   - ble.js API 호출과 실제 export의 일치
   - init()/destroy() lifecycle에서 이벤트 누수 없음
   - DOM ID 충돌 없음

---

## 파일 구조

### 새로 생성
- `docs/superpowers/plans/ble-api-reference.md` — BLE API 레퍼런스 (에이전트 컨텍스트 앵커)
- `web/ble.js` — BLE 연결 공유 모듈
- `web/app.js` — SPA 쉘, 탭 라우팅
- `web/scroll.js` — Auto Scroll Down 기능 모듈

### 수정
- `index.html` — SPA 쉘로 변환
- `web/text.js` — BLE 코드 제거, init()/destroy() 패턴
- `web/files.js` — BLE 코드 제거, init()/destroy() 패턴
- `web/style.css` — 탭 스타일 추가
- `lang/en.json` — scroll 키 추가
- `lang/ko.json` — scroll 키 추가
- `src/main.cpp` — scroll characteristic 추가

### 삭제
- `web/text.html` — text.js의 init()으로 이동
- `web/files.html` — files.js의 init()으로 이동

---

## Phase 1: 독립 모듈 (subagent 병렬 가능)

### Task 1: 펌웨어 — Auto Scroll BLE Characteristic 추가

**파일:** `src/main.cpp`

- [ ] **Step 1: UUID 추가** — `kNicknameCharUuid` 뒤에 `kScrollCharUuid = "f3641407-..."` 추가
- [ ] **Step 2: 상태 변수 추가** — Mouse Jiggler 뒤에 `g_scroll_active`, `g_scroll_interval_ms`, `g_scroll_last_ms`
- [ ] **Step 3: BLECharacteristic 선언** — `BLECharacteristic scroll_char(kScrollCharUuid);`
- [ ] **Step 4: scroll_write_cb 콜백** — 3바이트 프로토콜 파싱 (cmd + interval_ms LE)
- [ ] **Step 5: try_auto_scroll() 함수** — loop()에서 호출, mouseScroll(-1, 0)
- [ ] **Step 6: BLE disconnect 시 정지** — `ble_disconnect_cb`에 `g_scroll_active = false`
- [ ] **Step 7: setup() 등록** — scroll_char 초기화 + 로그
- [ ] **Step 8: loop() 호출** — `try_jiggle_mouse()` 뒤에 `try_auto_scroll()`
- [ ] **Step 9: 빌드** — `pio run`
- [ ] **Step 10: 커밋**

### Task 2: i18n — scroll 번역 키 추가

**파일:** `lang/en.json`, `lang/ko.json`

- [ ] **Step 1: en.json** — `home.autoScroll`, `home.autoScrollDesc`, `scroll.*` 섹션 추가
- [ ] **Step 2: ko.json** — 동일 키 한국어 번역 추가
- [ ] **Step 3: 커밋**

### Task 3: BLE API 레퍼런스 파일 작성

**파일:** `docs/superpowers/plans/ble-api-reference.md`

- [ ] **Step 1: 레퍼런스 작성** — ble.js의 전체 API를 문서화:

```markdown
# ble.js API Reference

## UUID 상수
- `SERVICE_UUID`, `FLUSH_TEXT_CHAR_UUID`, `CONFIG_CHAR_UUID`, `STATUS_CHAR_UUID`
- `MACRO_CHAR_UUID`, `BOOTLOADER_CHAR_UUID`, `NICKNAME_CHAR_UUID`, `SCROLL_CHAR_UUID`

## 연결 상태
- `isConnected()` → boolean — `device?.gatt?.connected` 대체
- `getDevice()` → BluetoothDevice | null
- `getDeviceName()` → string — `device.name` 대체
- `getChar(uuid)` → BLECharacteristic | null — `flushChar`, `configChar` 등 대체

## 버퍼 상태 (Flow Control)
- `getDeviceBufCapacity()` → number | null
- `getDeviceBufFree()` → number | null
- `getDeviceBufUpdatedAt()` → number
- `readStatusOnce()` → Promise
- `addStatusWaiter(fn)` — statusWaiters.push(fn) 대체

## 닉네임
- `sanitizeNickname(raw)` → string
- `loadSavedNickname()` → string
- `saveNicknameToLocalStorage(v)`
- `readDeviceNicknameOnce()` → Promise<string>
- `writeDeviceNickname(nickname)` → Promise<string>

## 연결/해제
- `connect()` → Promise<{cancelled: boolean, device?}>
- `reconnect()` → Promise — 전송 중 끊김 시 재연결
- `disconnect()` — 연결 해제
- `requestBootloader()` → Promise

## 이벤트
- `on(event, fn)` — event: 'connect' | 'disconnect' | 'status'
- `off(event, fn)`

## 리팩터링 치환 규칙
| 기존 코드 | 새 코드 |
|-----------|---------|
| `device?.gatt?.connected` | `ble.isConnected()` |
| `device.name` | `ble.getDeviceName()` |
| `flushChar` | `ble.getChar(ble.FLUSH_TEXT_CHAR_UUID)` |
| `configChar` | `ble.getChar(ble.CONFIG_CHAR_UUID)` |
| `statusChar` | `ble.getChar(ble.STATUS_CHAR_UUID)` |
| `macroChar` | `ble.getChar(ble.MACRO_CHAR_UUID)` |
| `bootloaderChar` | `ble.getChar(ble.BOOTLOADER_CHAR_UUID)` |
| `nicknameChar` | `ble.getChar(ble.NICKNAME_CHAR_UUID)` |
| `deviceBufCapacity` | `ble.getDeviceBufCapacity()` |
| `deviceBufFree` | `ble.getDeviceBufFree()` |
| `deviceBufUpdatedAt` | `ble.getDeviceBufUpdatedAt()` |
| `readStatusOnce()` | `ble.readStatusOnce()` |
| `statusWaiters.push(fn)` | `ble.addStatusWaiter(fn)` |
```

- [ ] **Step 2: 커밋**

### Task 4: ble.js — 공유 BLE 연결 모듈 작성

**파일:** `web/ble.js`

에이전트 지시: `docs/superpowers/plans/ble-api-reference.md`를 먼저 읽고, 거기에 정의된 API를 정확히 구현하라.

- [ ] **Step 1: ble.js 전체 작성** — UUID 상수, 연결 상태, 이벤트 시스템, connect/disconnect/reconnect, 닉네임, 부트로더, status 관리
- [ ] **Step 2: 커밋**

### Task 5: style.css — 탭 스타일 추가

**파일:** `web/style.css`

- [ ] **Step 1: 파일 끝에 `.tabLink`, `.tabLink.tabActive` 스타일 추가**
- [ ] **Step 2: 커밋**

---

## Phase 2: SPA 쉘 (Phase 1 완료 후)

### Task 6: app.js — SPA 쉘 및 탭 라우팅

**파일:** `web/app.js`

에이전트 지시: `docs/superpowers/plans/ble-api-reference.md`를 먼저 읽어라.

- [ ] **Step 1: app.js 작성** — 라우팅, 공통 Device UI, BLE 이벤트 바인딩, 모듈 lazy import + init/destroy 호출
- [ ] **Step 2: 커밋**

### Task 7: index.html — SPA 쉘로 변환

**파일:** `index.html`

- [ ] **Step 1: 전체 교체** — 탭 네비게이션(#, #text, #files, #scroll), homeSection, featureLayout(공통 Device sidebar + sidebarExtra + mainContainer)
- [ ] **Step 2: 커밋**

---

## Phase 3: scroll.js (Phase 2 완료 후)

### Task 8: scroll.js — Auto Scroll 기능 모듈

**파일:** `web/scroll.js`

에이전트 지시: `docs/superpowers/plans/ble-api-reference.md`를 먼저 읽어라. DOM 생성은 DOM API(createElement/appendChild)를 사용하라.

- [ ] **Step 1: scroll.js 작성** — Speed 슬라이더, Start/Stop, BLE 명령 전송, init/destroy
- [ ] **Step 2: 커밋**

---

## Phase 4: text.js 리팩터링 (마이크로 스텝)

**공통 원칙:**
- 에이전트는 각 스텝 시작 시 `docs/superpowers/plans/ble-api-reference.md`를 읽어라
- 비즈니스 로직(flushText, preprocessing, metrics, 한글 매핑 등)은 건드리지 않는다
- 변경량을 최소화한다 — 삭제와 치환만 수행

### Task 9: text.js — BLE import 추가 및 변수 선언 제거

**파일:** `web/text.js`

- [ ] **Step 1:** 파일 상단 변경
  - `import { initI18n, t, getLocale } from './i18n.js';` → `import { t, getLocale } from './i18n.js';` (initI18n 제거, app.js가 호출)
  - `import * as ble from './ble.js';` 추가
  - UUID 상수 6개 (SERVICE_UUID ~ NICKNAME_CHAR_UUID) 삭제
  - `LS_DEVICE_NICKNAME` 삭제 (ble.js가 관리)
  - BLE 상태 변수 삭제: `device`, `server`, `flushChar`, `configChar`, `statusChar`, `bootloaderChar`, `nicknameChar`, `deviceBufCapacity`, `deviceBufFree`, `deviceBufUpdatedAt`, `statusWaiters`
- [ ] **Step 2: 커밋** — `refactor(text): replace BLE vars with ble.js imports`

### Task 10: text.js — BLE 함수 삭제 및 치환

**파일:** `web/text.js`

에이전트 지시: `docs/superpowers/plans/ble-api-reference.md`의 치환 규칙 표를 참조하라.

- [ ] **Step 1:** 다음 함수들을 삭제 (ble.js에 이미 존재):
  - `resolveStatusWaiters()`, `handleStatusValue()`, `readStatusOnce()`, `waitForStatusUpdate()`
  - `sanitizeNickname()`, `loadSavedNickname()`, `saveNicknameToLocalStorage()`, `setNicknameUiValue()`, `readDeviceNicknameOnce()`, `writeDeviceNickname()`
  - `getConnectFailureHelpText()`
  - `connect()`, `reconnectLoop()`, `requestBootloader()`, `disconnect()`

- [ ] **Step 2:** 남은 코드에서 BLE 변수 참조 치환:
  - `device?.gatt?.connected` → `ble.isConnected()`
  - `device.name` / `device?.name` → `ble.getDeviceName()`
  - `flushChar` → `ble.getChar(ble.FLUSH_TEXT_CHAR_UUID)`
  - `configChar` → `ble.getChar(ble.CONFIG_CHAR_UUID)`
  - `statusChar` → `ble.getChar(ble.STATUS_CHAR_UUID)`
  - `bootloaderChar` → `ble.getChar(ble.BOOTLOADER_CHAR_UUID)`
  - `nicknameChar` → `ble.getChar(ble.NICKNAME_CHAR_UUID)`
  - `deviceBufCapacity` → `ble.getDeviceBufCapacity()`
  - `deviceBufFree` → `ble.getDeviceBufFree()`
  - `deviceBufUpdatedAt` → `ble.getDeviceBufUpdatedAt()`
  - `readStatusOnce()` → `ble.readStatusOnce()`
  - `statusWaiters.push(fn)` → `ble.addStatusWaiter(fn)`

- [ ] **Step 3:** `waitForStatusUpdate()`를 로컬 재정의 (ble.addStatusWaiter 기반):
  ```javascript
  function waitForStatusUpdate(timeoutMs) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      ble.addStatusWaiter(() => { clearTimeout(t); resolve(); });
    });
  }
  ```

- [ ] **Step 4:** `reconnectLoop()`을 ble.reconnect() 기반으로 재작성:
  ```javascript
  async function reconnectLoop() {
    let attempt = 0;
    while (!stopRequested) {
      attempt += 1;
      try {
        setStatus(t('status.reconnecting'), t('status.attempt', { n: attempt }));
        await ble.reconnect();
        setStatus(t('status.reconnectSuccess'), ble.getDeviceName() || 'BLE Device');
        return;
      } catch (err) {
        const msg = err?.message ?? String(err);
        setStatus(t('status.reconnectFailed'), `${t('status.attempt', { n: attempt })}: ${msg}`);
        const backoffMs = Math.min(5000, 250 + attempt * 250);
        await sleep(backoffMs);
      }
    }
  }
  ```

- [ ] **Step 5: 커밋** — `refactor(text): remove BLE functions, apply ble.js substitutions`

### Task 11: text.js — DOM 생성 함수 작성

**파일:** `web/text.js`

에이전트 지시: `web/text.html`의 내용을 읽어서 사이드바와 메인 영역 HTML을 DOM API로 생성하는 함수를 작성하라. 기존 text.html의 Device 섹션은 제외 (app.js가 관리). data-i18n 속성은 그대로 유지.

- [ ] **Step 1:** 두 함수 작성 (파일 끝에 추가):
  - `function createTextSidebar()` — Cautions + Transfer Settings + Notes 섹션을 DOM API로 생성하여 DocumentFragment 반환
  - `function createTextMain()` — textarea + 버튼 + metrics 영역을 DOM API로 생성하여 DocumentFragment 반환

- [ ] **Step 2: 커밋** — `feat(text): add DOM creation functions for SPA`

### Task 12: text.js — init()/destroy() 래퍼 및 이벤트 정리

**파일:** `web/text.js`

에이전트 지시: 기존 모듈 최하단의 DOMContentLoaded/자동실행 코드를 init() 함수로 이동하라. destroy()에서는 이벤트 리스너와 타이머를 정리하라.

- [ ] **Step 1:** `export function init(mainContainer, sidebarExtra)` 작성:
  - `sidebarExtra.appendChild(createTextSidebar())`
  - `mainContainer.appendChild(createTextMain())`
  - `applyDom(sidebarExtra)`, `applyDom(mainContainer)`
  - `els` 객체 바인딩 (getElementById)
  - 기존 DOMContentLoaded 코드 이동: localStorage 로드, 이벤트 리스너 등록, 초기 UI 상태
  - **connect/disconnect/bootloader/nickname 이벤트는 등록하지 않음** (app.js가 관리)
  - BLE connect/disconnect 이벤트 구독: `ble.on('connect', onBleConnect)`, `ble.on('disconnect', onBleDisconnect)`

- [ ] **Step 2:** `export function destroy()` 작성:
  - `ble.off('connect', onBleConnect)`, `ble.off('disconnect', onBleDisconnect)`
  - job interval 정리: `if (job?.intervalId) clearInterval(job.intervalId)`
  - textSettingsToastTimerId 정리
  - els 초기화: `els = {}`

- [ ] **Step 3:** 기존 모듈 하단의 자동실행 코드 삭제 (initI18n 호출, DOMContentLoaded 등)
  - `els` 전역 선언을 `let els = {};`로 변경 (init에서 바인딩)

- [ ] **Step 4:** `setStatus()` / `setUiConnected()` 참조 정리:
  - `setStatus()`는 모듈 내 로컬로 유지 (metrics stageText 업데이트 용도)
  - `setUiConnected()`는 connect/disconnect 버튼 제거 후 Start 버튼 활성화만 관리하도록 수정

- [ ] **Step 5: 커밋** — `refactor(text): add init/destroy lifecycle, remove auto-execution`

### Task 13: text.js 정합성 검증 (코드 리뷰)

에이전트 지시: code-reviewer 에이전트로 실행. 다음 항목을 검증하라.

- [ ] **Step 1:** `web/text.js`에서 ble.js API 호출이 `docs/superpowers/plans/ble-api-reference.md`의 export 목록과 일치하는지 확인
- [ ] **Step 2:** 삭제된 함수가 여전히 호출되고 있지 않은지 확인 (undefined reference 검색)
- [ ] **Step 3:** init()에서 등록한 이벤트가 destroy()에서 모두 해제되는지 확인
- [ ] **Step 4:** DOM ID가 text.html과 일치하는지, 다른 모듈과 충돌하지 않는지 확인
- [ ] **Step 5:** 발견된 문제 수정 및 커밋

---

## Phase 5: files.js 리팩터링 (마이크로 스텝)

Phase 4와 동일한 패턴을 적용한다.

### Task 14: files.js — BLE import 추가 및 변수 선언 제거

**파일:** `web/files.js`

- [ ] **Step 1:** 파일 상단 변경 (Task 9과 동일 패턴):
  - `import { initI18n, t, getLocale } from './i18n.js';` → `import { t, getLocale } from './i18n.js';`
  - `import * as ble from './ble.js';` 추가
  - UUID 상수 7개 삭제 (SERVICE_UUID ~ NICKNAME_CHAR_UUID, MACRO 포함)
  - `LS_DEVICE_NICKNAME` 삭제
  - BLE 상태 변수 삭제: `device`, `server`, `flushChar`, `configChar`, `statusChar`, `macroChar`, `bootloaderChar`, `nicknameChar`, `deviceBufCapacity`, `deviceBufFree`, `deviceBufUpdatedAt`, `statusWaiters`
- [ ] **Step 2: 커밋** — `refactor(files): replace BLE vars with ble.js imports`

### Task 15: files.js — BLE 함수 삭제 및 치환

**파일:** `web/files.js`

에이전트 지시: `docs/superpowers/plans/ble-api-reference.md`의 치환 규칙 표를 참조하라.

- [ ] **Step 1:** 다음 함수들을 삭제:
  - `resolveStatusWaiters()`, `handleStatusValue()`, `readStatusOnce()`, `waitForStatusUpdate()`
  - `sanitizeNickname()`, `loadSavedNickname()`, `saveNicknameToLocalStorage()`, `setNicknameUiValue()`, `readDeviceNicknameOnce()`, `writeDeviceNickname()`
  - `getConnectFailureHelpText()`, `connect()`, `handleDisconnected()`, `requestBootloader()`, `disconnect()`

- [ ] **Step 2:** 남은 코드에서 BLE 변수 참조 치환 (Task 10과 동일 규칙 + macroChar 추가):
  - `macroChar` → `ble.getChar(ble.MACRO_CHAR_UUID)`

- [ ] **Step 3:** `waitForStatusUpdate()` 로컬 재정의 (Task 10 Step 3과 동일)

- [ ] **Step 4: 커밋** — `refactor(files): remove BLE functions, apply ble.js substitutions`

### Task 16: files.js — DOM 생성 함수 작성

**파일:** `web/files.js`

에이전트 지시: `web/files.html`의 내용을 읽어서 사이드바와 메인 영역 HTML을 DOM API로 생성하는 함수를 작성하라. Device 섹션 제외.

- [ ] **Step 1:** 두 함수 작성:
  - `function createFilesSidebar()` — Cautions + Transfer Settings + Notes 섹션
  - `function createFilesMain()` — 파일 선택 + 버튼 + metrics 영역

- [ ] **Step 2: 커밋** — `feat(files): add DOM creation functions for SPA`

### Task 17: files.js — init()/destroy() 래퍼 및 이벤트 정리

**파일:** `web/files.js`

- [ ] **Step 1:** `export function init(mainContainer, sidebarExtra)` 작성 (Task 12와 동일 패턴)
- [ ] **Step 2:** `export function destroy()` 작성
- [ ] **Step 3:** 기존 `boot()` / `init()` 자동실행 코드 삭제
- [ ] **Step 4:** `wireEvents()`에서 connect/disconnect/bootloader/nickname 이벤트 제거
- [ ] **Step 5: 커밋** — `refactor(files): add init/destroy lifecycle, remove auto-execution`

### Task 18: files.js 정합성 검증 (코드 리뷰)

Task 13과 동일한 검증을 files.js에 대해 수행.

- [ ] **Step 1~5:** ble.js API 일치, undefined reference, 이벤트 해제, DOM ID 충돌, 문제 수정

---

## Phase 6: 마무리

### Task 19: 기존 HTML 파일 삭제

- [ ] **Step 1:** `git rm web/text.html web/files.html`
- [ ] **Step 2: 커밋** — `chore: remove old HTML files`

### Task 20: 통합 정합성 검증 (코드 리뷰)

에이전트 지시: code-reviewer 에이전트로 실행. 전체 SPA를 검증하라.

- [ ] **Step 1:** app.js의 모듈 import 경로 확인
- [ ] **Step 2:** 모든 모듈의 init/destroy 시그니처 일치 확인
- [ ] **Step 3:** ble.js 이벤트 등록/해제 쌍 확인 (전체 모듈)
- [ ] **Step 4:** i18n 키가 lang/*.json에 모두 존재하는지 확인
- [ ] **Step 5:** 펌웨어 빌드 — `pio run`
- [ ] **Step 6:** 발견된 문제 수정 및 최종 커밋

---

## 실행 가이드

### 병렬 가능한 태스크
- Task 1, 2, 3, 5는 서로 독립적 → 병렬 실행 가능
- Task 4는 Task 3 (API 레퍼런스) 완료 후

### 순차 실행이 필요한 태스크
- Task 6, 7 → Task 4 완료 후
- Task 8 → Task 6, 7 완료 후
- Task 9~13 → Task 8 완료 후 (순차)
- Task 14~18 → Task 13 완료 후 (순차)
- Task 19, 20 → Task 18 완료 후

### 검증 게이트 (반드시 통과해야 다음 Phase 진행)
- Phase 1 완료 → `pio run` 성공
- Phase 4 완료 → Task 13 코드 리뷰 통과
- Phase 5 완료 → Task 18 코드 리뷰 통과
- Phase 6 완료 → Task 20 통합 검증 통과
