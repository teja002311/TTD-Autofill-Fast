// Background service worker for TTD Fast Autofill
//
// 1. Trusted-input proxy: TTD's form only accepts real (isTrusted) keyboard/mouse events, so the
//    content script asks us to type/click through the Chrome debugger API, which produces them.
// 2. Extension keyboard commands (Ctrl+Shift+F etc.).
// 3. Re-injects the content script into open TTD tabs after install/update (no page refresh needed).

const TTD_URL = 'https://ttdevasthanams.ap.gov.in/*';
const DEBUGGER_PROTOCOL = '1.3';
const IDLE_DETACH_MS = 6000; // safety net: never stay attached longer than needed

const sessions = new Map(); // tabId -> idle timer id

function armIdleDetach(tabId) {
    clearTimeout(sessions.get(tabId));
    sessions.set(tabId, setTimeout(() => detach(tabId), IDLE_DETACH_MS));
}

async function attach(tabId) {
    if (sessions.has(tabId)) {
        armIdleDetach(tabId);
        return { newlyAttached: false };
    }
    try {
        await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL);
    } catch (e) {
        // Service worker may have restarted while still attached from a previous run.
        if (!/already attached/i.test(e.message)) throw e;
    }
    armIdleDetach(tabId);
    return { newlyAttached: true };
}

async function detach(tabId) {
    clearTimeout(sessions.get(tabId));
    sessions.delete(tabId);
    try { await chrome.debugger.detach({ tabId }); } catch (_) { /* already detached */ }
}

chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId != null) {
        clearTimeout(sessions.get(source.tabId));
        sessions.delete(source.tabId);
    }
});

const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);

const KEYS = {
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
};

async function runOp(tabId, op, args) {
    if (op === 'attach') return attach(tabId);
    if (op === 'detach') { await detach(tabId); return {}; }

    if (!sessions.has(tabId)) await attach(tabId);
    armIdleDetach(tabId);

    switch (op) {
        case 'click': {
            const { x, y } = args;
            await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
            await send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
            await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
            return {};
        }
        case 'insertText':
            await send(tabId, 'Input.insertText', { text: String(args.text ?? '') });
            return {};
        case 'selectAll': {
            const base = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 };
            await send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, commands: ['selectAll'] });
            await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
            return {};
        }
        case 'key': {
            const k = KEYS[args.key];
            if (!k) throw new Error(`Unsupported key ${args.key}`);
            await send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
            await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...k });
            return {};
        }
        default:
            throw new Error(`Unknown op ${op}`);
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'ttdaf:cdp') return;
    const tabId = sender.tab?.id;
    if (tabId == null) {
        sendResponse({ ok: false, error: 'No tab' });
        return;
    }
    runOp(tabId, message.op, message.args || {})
        .then((r) => sendResponse({ ok: true, ...r }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async response
});

// ----------------------------------------------------------------------
// Content script delivery
// ----------------------------------------------------------------------
async function injectContentScript(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function sendToTab(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
        if (!/Receiving end does not exist|Could not establish connection/i.test(e.message)) throw e;
        await injectContentScript(tabId);
        return chrome.tabs.sendMessage(tabId, message);
    }
}

chrome.runtime.onInstalled.addListener(async () => {
    // Make the new version live in already-open TTD tabs without a refresh.
    const tabs = await chrome.tabs.query({ url: TTD_URL });
    for (const tab of tabs) {
        try { await injectContentScript(tab.id); } catch (_) { /* tab may be discarded */ }
    }
});

// ----------------------------------------------------------------------
// Extension commands (chrome://extensions/shortcuts)
// ----------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    if (command === 'fill-last-used') {
        if (!tab.url?.startsWith('https://ttdevasthanams.ap.gov.in/')) return;
        try { await sendToTab(tab.id, { action: 'fillLastUsed' }); } catch (e) { console.error(e); }
        return;
    }
    if (command === 'open-master-profiles' || command === 'open-single-profiles') {
        await chrome.storage.session.set({ popupView: command === 'open-master-profiles' ? 'master' : 'single' }).catch(() => {});
        try { await chrome.action.openPopup(); } catch (_) { /* not supported in this context */ }
    }
});

// Popup -> page relay (kept for compatibility)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action !== 'fillFormFromPopup') return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) return sendResponse({ success: false, error: 'No active tab' });
        sendToTab(tabs[0].id, { action: 'fillForm', profile: message.profile })
            .then(() => sendResponse({ success: true }))
            .catch((e) => sendResponse({ success: false, error: e.message }));
    });
    return true;
});
