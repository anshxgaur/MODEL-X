# Web Starter App — Comprehensive Test Suite

This test suite validates the RunAnywhere Web Starter App after the multi-package refactor
(`@runanywhere/web` core + `@runanywhere/web-llamacpp` + `@runanywhere/web-onnx`).

---

## Test Categories

### A. App Load & SDK Initialization

1. Navigate to http://localhost:5173 — verify the page loads without a blank screen
2. Verify the loading spinner appears initially ("Loading RunAnywhere SDK..." + "Initializing on-device AI engine")
3. After SDK initializes, verify the loading spinner disappears and the main UI renders
4. Verify no SDK error screen is shown (no "SDK Error" heading visible)
5. Verify console logs contain SDK initialization success indicators
6. Verify console contains backend registration logs for LlamaCpp and ONNX backends
7. Verify no critical JavaScript errors in console (exclude expected WASM/SharedArrayBuffer warnings)

### B. Header & Acceleration Badge

1. Verify the app header renders with text "RunAnywhere AI"
2. Verify the acceleration badge appears in the header (either "CPU" or "WebGPU")
3. Verify the badge persists across tab navigation (visible on all tabs)
4. Verify badge has correct styling (small badge appearance, not a full button)

### C. Tab Bar & Navigation

1. Verify 3 tabs render in the tab bar: "💬 Chat", "📷 Vision", "🎙️ Voice"
2. Verify Chat tab is active/selected by default on load
3. Click Vision tab — verify it becomes active (highlighted) and Chat becomes inactive
4. Click Voice tab — verify it becomes active and Vision becomes inactive
5. Click Chat tab — verify it returns to active state
6. Navigate rapidly between all 3 tabs (Chat → Vision → Voice → Chat → Vision) — verify no crashes or blank states
7. Verify only one tab panel is visible at a time (previous tab content is unmounted)
8. Verify tab buttons have consistent sizing and layout

### D. Chat Tab — UI Elements

1. Navigate to Chat tab — verify the tab panel renders
2. Verify the ModelBanner is shown with text about "No LLM model loaded" and a "Download & Load" button
3. Verify the empty state renders: heading "Start a conversation" and subtext "Type a message below to chat with on-device AI"
4. Verify the message input form renders at the bottom with placeholder "Message..."
5. Verify the Send button renders and is initially disabled (since input is empty)
6. Type text in the input — verify the Send button becomes enabled
7. Clear the input — verify the Send button becomes disabled again
8. Verify the input field can accept text and displays it correctly
9. Verify the message list area is scrollable (has proper layout for future messages)

### E. Chat Tab — Interaction Behavior

1. With no model loaded, type a message and press Send — verify ModelBanner triggers download/load sequence
2. Verify that the "Download & Load" button on the banner is clickable
3. Verify that typing in the input and pressing Enter submits (or attempts to submit) the message
4. Verify that the Stop button does NOT appear when no generation is in progress
5. Verify the input field is not disabled when idle (no generation in progress)

### F. Vision Tab — UI Elements

1. Navigate to Vision tab — verify the tab panel renders
2. Verify the ModelBanner shows for VLM model with "Download & Load" button (label: "VLM")
3. Verify the camera preview area renders with empty state: "📷 Camera Preview" heading and "Tap below to start the camera" subtext
4. Verify the prompt input field renders with placeholder "What do you want to know about the image?"
5. Verify the prompt field has a default value of "Describe what you see briefly."
6. Verify the "Start Camera" button renders and is visible
7. Verify the "Describe" button is NOT visible when camera is not active
8. Verify the "Live" button is NOT visible when camera is not active
9. Verify the result display area is not visible when no result exists

### G. Vision Tab — Camera Interaction

1. Click "Start Camera" — verify the button text changes (camera starts)
2. After camera starts, verify the "Describe" button appears
3. After camera starts, verify the "▶ Live" toggle button appears
4. Verify the prompt input remains editable when camera is active
5. Edit the prompt text — verify the value updates
6. Verify the empty state ("📷 Camera Preview") disappears when camera is active

### H. Vision Tab — Live Mode

1. With camera active, click "▶ Live" — verify the button changes to "⏹ Stop Live"
2. Verify the "⏹ Stop Live" button has active/pulsing styling (red background)
3. Verify the prompt input becomes disabled during live mode
4. Click "⏹ Stop Live" — verify it returns to "▶ Live" and prompt input becomes editable again

### I. Voice Tab — UI Elements

1. Navigate to Voice tab — verify the tab panel renders
2. Verify the ModelBanner shows for voice models (multiple models: VAD, STT, LLM, TTS)
3. Verify the voice orb renders (centered circular element)
4. Verify the voice orb has idle styling (no glow animation)
5. Verify the status text shows "Tap to start listening" in idle state
6. Verify the "Start Listening" button renders and is enabled
7. Verify the transcript section is NOT visible initially (no transcript yet)
8. Verify the response section is NOT visible initially (no AI response yet)

### J. Voice Tab — Interaction Behavior

1. Click "Start Listening" — verify the button changes to "Stop" (or model loading begins)
2. If models not loaded, verify the status text changes to "Loading models..." and button shows disabled state
3. Verify that after model loading, the orb styling changes to listening state (orange glow)
4. Verify the status text updates to "Listening... speak now" when active
5. Click "Stop" during listening — verify it returns to idle state

### K. ModelBanner Component — States

1. On Chat tab (no model loaded): Verify banner text "No LLM model loaded." is shown
2. On Chat tab: Verify "Download & Load" button is rendered in the banner
3. On Vision tab (no model loaded): Verify banner text mentions "VLM"
4. On Voice tab (no models loaded): Verify banner mentions voice model types
5. Verify banner disappears when model is in "ready" state
6. Verify banner shows progress bar during download (if download is triggered)
7. Verify banner shows "Loading ... model into engine..." text during model loading
8. Verify banner shows error text with "Retry" button on failure

### L. Styling & Theming

1. Verify the app has a dark theme (dark navy background, light text)
2. Verify the primary accent color is orange (#FF5500) — visible on buttons, active tab
3. Verify buttons have consistent styling (border radius, padding)
4. Verify the tab bar has proper visual separation from content area
5. Verify message bubbles would have different alignment (user right, assistant left)
6. Verify the loading spinner animation plays smoothly
7. Verify the app is centered and has max-width constraint (mobile-friendly layout, ~600px)
8. Verify responsive layout works at common viewport widths (375px, 768px, 1024px)

### M. Cross-Tab State Behavior

1. Start on Chat tab, switch to Vision tab, switch back to Chat — verify Chat tab re-renders clean (empty state or with messages if any)
2. Start on Chat tab, switch to Voice, switch back — verify no stale state
3. Verify switching tabs does not cause duplicate ModelBanners
4. Verify each tab shows its own ModelBanner independently (different model categories)

### N. Error Handling & Edge Cases

1. Verify no uncaught promise rejections in console on initial load
2. Verify switching tabs rapidly (10+ switches) causes no errors
3. Verify the app doesn't freeze or become unresponsive during tab switches
4. Verify that the app handles missing WebGPU gracefully (falls back to CPU badge)
5. Verify no CORS-related errors in the console

### O. Console Error Audit

1. After all tests, collect all console errors
2. Classify: expected (WASM fallback, SharedArrayBuffer) vs unexpected (real bugs)
3. Report any JavaScript TypeError or ReferenceError as bugs
4. Report any React rendering errors as bugs
5. Report any network/fetch failures as bugs

---

## Bug Report File

Bugs found during testing will be written to:
`tests/web-starter-app-bugs.md`
