// TTD Fast Autofill — content script
//
// TTD's booking site (Next.js/React) ignores values set by scripts: its inputs only accept
// events where event.isTrusted === true. So this script works out WHAT to fill and WHERE,
// and asks the background service worker to perform real keystrokes/clicks through the
// Chrome debugger API (which produces trusted events). If that is unavailable it falls
// back to classic script-based filling, which still works on older/unguarded forms.

(() => {
    // When the extension is reloaded/updated, the old copy of this script stays in open tabs
    // ("orphaned": chrome.* APIs gone) and background.js injects a fresh copy. A DOM marker
    // (shared by all script worlds) tells each copy whether it is still the newest one.
    const INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    document.documentElement.dataset.ttdafInstance = INSTANCE;
    const isOrphaned = () => { try { return !chrome.runtime?.id; } catch (_) { return true; } };
    const isCurrent = () => document.documentElement.dataset.ttdafInstance === INSTANCE && !isOrphaned();

    const LOG = (...a) => console.log('%c[TTD Autofill]', 'color:#FF9933;font-weight:bold', ...a);

    // ------------------------------------------------------------------
    // Generic field patterns (fallback for pages that don't use TTD's names)
    // ------------------------------------------------------------------
    const FIELD_PATTERNS = {
        fullName: ['fname', 'pilgrimname', 'pilgrim_name', 'fullname', 'full_name', 'devotee_name', 'devoteename', 'personname'],
        age: ['age', 'pilgrim_age', 'devotee_age'],
        gender: ['gender', 'sex'],
        idType: ['photoidtype', 'photoidproof', 'photo_id_proof', 'idproof', 'id_proof', 'idtype', 'id_type', 'prooftype', 'documenttype'],
        idNumber: ['idproofnumber', 'photoidnumber', 'photo_id_number', 'idnumber', 'id_number', 'proofnumber', 'documentnumber', 'aadhaar', 'aadhar'],
        gothram: ['gothram', 'gotram', 'gotra'],
        email: ['emailid', 'email', 'mailid'],
        city: ['city', 'town'],
        state: ['state', 'province'],
        pincode: ['pincode', 'pin_code', 'zipcode', 'zip', 'postal']
    };

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function waitFor(fn, timeout = 1500, interval = 20) {
        const end = performance.now() + timeout;
        for (;;) {
            let v = null;
            try { v = fn(); } catch (_) { /* ignore */ }
            if (v) return v;
            if (performance.now() > end) return null;
            await sleep(interval);
        }
    }

    const isVisible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== 'hidden';

    const norm = (s) => String(s ?? '').toLowerCase().replace(/aadhar\b/g, 'aadhaar').replace(/[^a-z0-9]/g, '');

    // ------------------------------------------------------------------
    // Value cleaning — mirrors TTD's own validators so values are never rejected
    // ------------------------------------------------------------------
    const clean = {
        // TTD: /^[a-zA-Z ]*$/ on change, /^[a-zA-Z][a-zA-Z ]{1,80}$/ on blur
        name: (v) => String(v ?? '').replace(/[^a-zA-Z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80),
        age: (v) => String(v ?? '').replace(/\D/g, '').slice(0, 3),
        letters: (v) => String(v ?? '').replace(/[^a-zA-Z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50),
        digits: (v) => String(v ?? '').replace(/\D/g, ''),
        text: (v) => String(v ?? '').trim()
    };

    function normGender(g) {
        const k = String(g ?? '').trim().toLowerCase();
        return ({ m: 'Male', male: 'Male', f: 'Female', female: 'Female', t: 'Transgender', transgender: 'Transgender' })[k] || String(g ?? '').trim();
    }

    function normIdType(t) {
        const k = String(t ?? '').toLowerCase();
        if (/aadh?aa?r/.test(k)) return 'Aadhaar Card';
        if (/passport/.test(k)) return 'Passport';
        if (/voter/.test(k)) return 'Voter ID';
        return String(t ?? '').trim();
    }

    function cleanIdNumber(idType, v) {
        if (idType === 'Aadhaar Card') return clean.digits(v).slice(0, 12);
        return String(v ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
    }

    // ------------------------------------------------------------------
    // Trusted-input bridge (talks to background.js -> chrome.debugger)
    // ------------------------------------------------------------------
    const bridge = {
        available: false,
        async call(op, args = {}) {
            const res = await chrome.runtime.sendMessage({ type: 'ttdaf:cdp', op, args });
            if (!res || !res.ok) throw new Error(res?.error || 'No response from extension');
            return res;
        },
        async start() {
            try {
                const r = await this.call('attach');
                this.available = true;
                // Chrome shows a "debugging this browser" bar on first attach, which shifts the
                // page down. Give layout a moment to settle before measuring positions.
                if (r.newlyAttached) await sleep(350);
            } catch (e) {
                if (/context invalidated/i.test(e.message)) throw e;
                LOG('Real-keystroke mode unavailable, using compatibility mode:', e.message);
                this.available = false;
            }
            return this.available;
        },
        async stop() {
            if (!this.available) return;
            this.available = false;
            try { await this.call('detach'); } catch (_) { /* ignore */ }
        }
    };

    // Classic script-based value setter (works on unguarded React/Angular forms)
    function setNativeValue(el, value) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
            : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function pointHits(el, x, y) {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit));
    }

    async function realClick(el) {
        let r = el.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        if (r.top < 60 || r.bottom > vh - 10 || r.left < 0 || r.right > vw) {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            r = el.getBoundingClientRect();
        }
        // Prefer the centre; if something overlaps it, try a few other points inside the box.
        const candidates = [
            [r.left + r.width / 2, r.top + r.height / 2],
            [r.left + Math.min(12, r.width / 4), r.top + r.height / 2],
            [r.left + r.width / 2, r.top + Math.min(10, r.height / 3)],
            [r.right - Math.min(12, r.width / 4), r.top + r.height / 2]
        ];
        let hitPoint = candidates.find(([cx, cy]) => pointHits(el, cx, cy));
        if (!hitPoint) {
            // Covered (e.g. by a sticky header): bring it to the middle of the screen and retry.
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            r = el.getBoundingClientRect();
            hitPoint = [r.left + r.width / 2, r.top + r.height / 2];
        }
        const [x, y] = hitPoint;
        if (bridge.available) {
            await bridge.call('click', { x: Math.round(x), y: Math.round(y) });
        } else {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
            el.click();
        }
    }

    // ------------------------------------------------------------------
    // Field actions
    // ------------------------------------------------------------------
    const valueMatches = (el, value) => String(el.value ?? '').trim() === String(value).trim();

    async function typeValue(el, value) {
        if (value === '' || value == null) return 'skip';
        value = String(value);
        if (valueMatches(el, value)) return 'ok';
        if (el.disabled || el.readOnly) {
            await waitFor(() => !el.disabled && !el.readOnly, 1500);
            if (el.disabled || el.readOnly) return 'disabled';
        }

        if (!bridge.available) {
            el.focus();
            setNativeValue(el, value);
            return (await waitFor(() => valueMatches(el, value), 300)) ? 'ok' : 'failed';
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt === 0) {
                el.focus({ preventScroll: false });
                if (document.activeElement !== el) await realClick(el);
            } else {
                await realClick(el);
            }
            if (el.value) {
                await bridge.call('selectAll');
                if (attempt > 0) await bridge.call('key', { key: 'Backspace' });
            }
            await bridge.call('insertText', { text: value });
            if (await waitFor(() => valueMatches(el, value), 400)) return 'ok';
        }
        return 'failed';
    }

    // Options of a custom dropdown are rendered next to its input (TTD) or in a global overlay.
    function findOptions(input) {
        let node = input.parentElement;
        for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
            const opts = [...node.querySelectorAll('li, [role="option"], mat-option')].filter(isVisible);
            if (opts.length) return opts;
        }
        return [...document.querySelectorAll(
            '.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"], [role="listbox"] [role="option"]'
        )].filter(isVisible);
    }

    function matchOption(options, wanted) {
        const w = norm(wanted);
        if (!w) return null;
        const list = options.map((o) => ({ o, t: norm(o.textContent) })).filter((x) => x.t);
        return (list.find((x) => x.t === w) ||
            list.find((x) => x.t.startsWith(w)) ||
            list.find((x) => x.t.includes(w)) ||
            list.find((x) => w.includes(x.t)))?.o || null;
    }

    function fillNativeSelect(select, wanted) {
        const w = norm(wanted);
        const opt = [...select.options].find((o) => norm(o.text) === w || norm(o.value) === w) ||
            [...select.options].find((o) => w && (norm(o.text).includes(w) || w.includes(norm(o.text))) && norm(o.text));
        if (!opt) return false;
        setNativeValue(select, opt.value);
        return true;
    }

    async function chooseOption(input, wanted) {
        if (!wanted) return 'skip';
        if (input.tagName === 'SELECT') return fillNativeSelect(input, wanted) ? 'ok' : 'nomatch';
        if (norm(input.value) === norm(wanted)) return 'ok';

        for (let attempt = 0; attempt < 2; attempt++) {
            await realClick(input);
            const options = await waitFor(() => {
                const o = findOptions(input);
                return o.length ? o : null;
            }, 1500);
            if (!options) continue;

            const opt = matchOption(options, wanted);
            if (!opt) {
                LOG(`No option matching "${wanted}". Options:`, options.map((o) => o.textContent.trim()));
                await realClick(input); // close it again
                return 'nomatch';
            }
            const optText = opt.textContent.trim();
            opt.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            await realClick(opt);
            if (await waitFor(() => norm(input.value) === norm(optText), 800)) return 'ok';
        }
        return 'failed';
    }

    // ------------------------------------------------------------------
    // Locating fields
    // ------------------------------------------------------------------
    const byName = (name, idx) => {
        const els = [...document.querySelectorAll(`input[name="${name}"][id="${idx}"], select[name="${name}"][id="${idx}"]`)];
        return els.find(isVisible) || els[0] || null;
    };

    function attrsOf(el) {
        return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
            el.getAttribute('formcontrolname'), el.getAttribute('ng-reflect-name')]
            .filter(Boolean).join(' ').toLowerCase();
    }

    function nthByPattern(type, n) {
        const pats = FIELD_PATTERNS[type];
        const els = [...document.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), select, textarea'
        )].filter((el) => isVisible(el) && pats.some((p) => attrsOf(el).includes(p)));
        return els[n] || null;
    }

    function pilgrimField(type, i) {
        const ttdName = { fullName: 'fname', age: 'age', gender: 'gender', idType: 'photoIdType', idNumber: 'idProofNumber', gothram: 'gothram' }[type];
        return byName(ttdName, i) || nthByPattern(type, i);
    }

    function generalField(type) {
        const ttdName = { email: 'emailId', city: 'city', state: 'state', pincode: 'pincode' }[type];
        const el = [...document.querySelectorAll(`input[name="${ttdName}"]`)].find(isVisible);
        return el || nthByPattern(type, 0);
    }

    function countPilgrimRows() {
        const rows = [...document.querySelectorAll('input[name="fname"]')].filter(isVisible).length;
        return rows || [...document.querySelectorAll('input')].filter((el) => isVisible(el) && FIELD_PATTERNS.fullName.some((p) => attrsOf(el).includes(p))).length;
    }

    // ------------------------------------------------------------------
    // Profiles
    // ------------------------------------------------------------------
    function normalizeProfile(p) {
        if (Array.isArray(p?.pilgrims)) {
            return { name: p.name || 'Profile', general: p.generalDetails || {}, pilgrims: p.pilgrims };
        }
        const d = p?.data || p || {};
        return {
            name: p?.name || d.fullName || 'Profile',
            general: { email: d.email, city: d.city, state: d.state, pincode: d.pincode },
            pilgrims: [{ fullName: d.fullName, age: d.age, gender: d.gender, idType: d.idType, idNumber: d.idNumber, gothram: d.gothram }]
        };
    }

    // ------------------------------------------------------------------
    // Fill engine
    // ------------------------------------------------------------------
    let running = null;

    async function doStep(job, label, getEl, action) {
        if (job.cancelled) return;
        const el = getEl();
        const entry = { label, getEl, action, status: 'nofield' };
        if (el) {
            try {
                entry.status = await action(el);
            } catch (e) {
                if (/context invalidated/i.test(e.message)) throw e;
                LOG(`${label} error:`, e);
                entry.status = 'failed';
            }
        }
        job.results.push(entry);
    }

    async function fillPilgrim(job, p, i) {
        const L = (s) => `Pilgrim ${i + 1} ${s}`;
        const idType = normIdType(p.idType);
        await doStep(job, L('name'), () => pilgrimField('fullName', i), (el) => typeValue(el, clean.name(p.fullName)));
        await doStep(job, L('age'), () => pilgrimField('age', i), (el) => typeValue(el, clean.age(p.age)));
        await doStep(job, L('gender'), () => pilgrimField('gender', i), (el) => chooseOption(el, normGender(p.gender)));
        await doStep(job, L('photo ID type'), () => pilgrimField('idType', i), (el) => chooseOption(el, idType));
        // The ID number box is disabled until an ID type is picked; typeValue waits for it.
        await doStep(job, L('ID number'), () => pilgrimField('idNumber', i), (el) => typeValue(el, cleanIdNumber(idType, p.idNumber)));
        if (p.gothram) {
            await doStep(job, L('gothram'), () => byName('gothram', i) || nthByPattern('gothram', i), (el) => typeValue(el, clean.letters(p.gothram)));
        }
    }

    async function fillGeneral(job, g) {
        await doStep(job, 'Email', () => generalField('email'), (el) => typeValue(el, clean.text(g.email)));
        await doStep(job, 'City', () => generalField('city'), (el) => (el.disabled && el.value ? 'ok' : typeValue(el, clean.letters(g.city))));
        await doStep(job, 'State', () => generalField('state'), (el) => (el.disabled && el.value ? 'ok' : typeValue(el, clean.letters(g.state))));
        await doStep(job, 'Pincode', () => generalField('pincode'), (el) => typeValue(el, clean.digits(g.pincode).slice(0, 6)));
    }

    const isProblem = (s) => s === 'failed' || s === 'nomatch' || s === 'disabled';

    async function runFill(rawProfile) {
        if (running) {
            ui.show('Already filling — please wait (Esc to cancel)', 'info');
            return;
        }
        const profile = normalizeProfile(rawProfile);
        const job = { cancelled: false, results: [] };
        running = job;
        clearHighlights();
        const t0 = performance.now();

        try {
            const rows = countPilgrimRows();
            if (!rows && !generalField('email')) {
                ui.show('No pilgrim form found on this page. Open the Pilgrim Details page first.', 'error');
                return;
            }

            ui.show(`Filling "${profile.name}"…`, 'progress');
            await bridge.start();

            const total = profile.pilgrims.length;
            const fillCount = Math.min(total, rows || total);
            for (let i = 0; i < fillCount && !job.cancelled; i++) {
                ui.show(`Filling pilgrim ${i + 1} of ${fillCount}…`, 'progress');
                await fillPilgrim(job, profile.pilgrims[i], i);
            }
            if (!job.cancelled) {
                ui.show('Filling general details…', 'progress');
                await fillGeneral(job, profile.general || {});
            }

            // Verify + one retry pass for anything that didn't stick
            const retry = job.results.filter((r) => isProblem(r.status));
            for (const r of retry) {
                if (job.cancelled) break;
                const el = r.getEl();
                if (!el) continue;
                try { r.status = await r.action(el); } catch (_) { /* keep failed */ }
            }

            const secs = ((performance.now() - t0) / 1000).toFixed(1);
            const problems = job.results.filter((r) => isProblem(r.status));
            const missing = job.results.filter((r) => r.status === 'nofield' && /name|age/.test(r.label));
            const filled = job.results.filter((r) => r.status === 'ok').length;

            if (job.cancelled) {
                ui.show(`Cancelled — ${filled} fields filled`, 'info');
            } else if (problems.length) {
                problems.forEach((r) => highlight(r.getEl()));
                ui.show(`Filled ${filled} fields in ${secs}s. Please check: ${problems.map((r) => r.label).join(', ')}`, 'warn', 9000);
            } else {
                let msg = `✓ Filled ${fillCount} pilgrim${fillCount > 1 ? 's' : ''} (${filled} fields) in ${secs}s`;
                if (total > fillCount) msg += ` — page has only ${fillCount} row${fillCount > 1 ? 's' : ''}, profile has ${total}`;
                else if (missing.length) msg += ` — some fields not on this page`;
                ui.show(msg, total > fillCount ? 'warn' : 'success', 6000);
            }
            LOG('Fill results:', job.results.map((r) => `${r.label}: ${r.status}`));
        } catch (e) {
            if (/context invalidated/i.test(e.message)) {
                ui.show('Extension was updated — please refresh this page (F5) and try again.', 'error', 8000);
            } else {
                LOG('Fill error:', e);
                ui.show(`Autofill error: ${e.message}`, 'error', 8000);
            }
        } finally {
            await bridge.stop().catch(() => {});
            running = null;
        }
    }

    function highlight(el) {
        if (!el) return;
        el.dataset.ttdafHighlight = '1';
        el.style.outline = '3px solid #ef4444';
        el.style.outlineOffset = '2px';
    }

    function clearHighlights() {
        document.querySelectorAll('[data-ttdaf-highlight]').forEach((el) => {
            el.style.outline = '';
            el.style.outlineOffset = '';
            delete el.dataset.ttdafHighlight;
        });
    }

    // ------------------------------------------------------------------
    // Status toast (shadow DOM so the page's CSS can't interfere)
    // ------------------------------------------------------------------
    const ui = (() => {
        let host, box, timer;
        const colors = { success: '#10b981', error: '#ef4444', warn: '#d97706', info: '#3b82f6', progress: '#FF9933' };
        function ensure() {
            if (host?.isConnected) return;
            host = document.createElement('div');
            host.id = 'ttdaf-toast-host';
            const root = host.attachShadow({ mode: 'open' });
            root.innerHTML = `<style>
                .t{position:fixed;top:16px;right:16px;max-width:380px;z-index:2147483647;color:#fff;
                   padding:12px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25);
                   font:500 14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                   transition:opacity .2s;cursor:pointer}
                .h{font-weight:700;font-size:12px;opacity:.85;margin-bottom:2px;letter-spacing:.3px}
            </style><div class="t"><div class="h">TTD AUTOFILL</div><div class="m"></div></div>`;
            box = root.querySelector('.t');
            box.addEventListener('click', () => { host.remove(); });
            document.documentElement.appendChild(host);
        }
        return {
            show(msg, type = 'info', ms = 0) {
                ensure();
                clearTimeout(timer);
                box.style.opacity = '1';
                box.style.background = colors[type] || colors.info;
                box.querySelector('.m').textContent = msg;
                const life = ms || (type === 'progress' ? 0 : 4000);
                if (life) timer = setTimeout(() => host?.remove(), life);
            }
        };
    })();

    // ------------------------------------------------------------------
    // Booking clock — a display-only clock synced to TTD's own server time.
    // It does NOT click, navigate, retry, or submit anything. It only shows the
    // true time and a countdown so you click once, yourself, at the right second.
    // ------------------------------------------------------------------
    const bookingClock = (() => {
        let host, root, pill, enabled = false, openHHMM = '10:00';
        let skewMs = 0, synced = false, tick = null, resyncAt = 0, syncing = false;
        let audioCtx = null, soundOn = true, prevSecondsLeft = null, prevDiff = null, gestureHooked = false;
        const pad = (n) => String(n).padStart(2, '0');

        // Audio needs a prior user gesture to be allowed; unlock on the first click/keypress.
        function hookGesture() {
            if (gestureHooked) return;
            gestureHooked = true;
            const unlock = () => {
                try {
                    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
                    if (audioCtx.state === 'suspended') audioCtx.resume();
                } catch (_) { /* audio unavailable */ }
            };
            window.addEventListener('pointerdown', unlock, { capture: true });
            window.addEventListener('keydown', unlock, { capture: true });
        }

        function beep(freq, durMs, vol = 0.25) {
            if (!soundOn) return;
            try {
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (audioCtx.state === 'suspended') audioCtx.resume();
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                const t = audioCtx.currentTime;
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(t);
                osc.stop(t + durMs / 1000 + 0.02);
            } catch (_) { /* ignore */ }
        }

        // Read TTD's server clock from the Date response header (same-origin, so it's readable).
        async function sync() {
            if (syncing) return;
            syncing = true;
            try {
                const t0 = Date.now();
                const res = await fetch('/', { method: 'HEAD', cache: 'no-store' });
                const t1 = Date.now();
                const dateHeader = res.headers.get('date');
                if (dateHeader) {
                    const serverMs = new Date(dateHeader).getTime();
                    // Header has 1s resolution; assume it reflects the server mid-way through the round trip.
                    skewMs = serverMs - (t0 + (t1 - t0) / 2);
                    synced = true;
                    resyncAt = Date.now() + 60000; // re-sync once a minute
                }
            } catch (_) {
                // Keep the last known skew; the local clock still ticks.
            } finally {
                syncing = false;
            }
        }

        const serverNow = () => Date.now() + skewMs;

        // Next occurrence of the opening time, in the viewer's local timezone (IST for this user).
        function targetMs() {
            const [h, m] = openHHMM.split(':').map(Number);
            const base = new Date(serverNow());
            const t = new Date(base);
            t.setHours(h, m, 0, 0);
            return t.getTime();
        }

        function render() {
            if (!host) return;
            if (!synced && Date.now() > resyncAt) sync();
            if (Date.now() > resyncAt) sync();

            const now = serverNow();
            const d = new Date(now);
            root.querySelector('.clk-time').textContent =
                `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            root.querySelector('.clk-sync').textContent = synced ? 'TTD server time' : 'syncing…';

            const diff = targetMs() - now;
            const cd = root.querySelector('.clk-cd');
            if (!openHHMM) { cd.textContent = ''; prevDiff = diff; return; }
            if (diff > 0) {
                const s = Math.floor(diff / 1000);
                const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
                cd.textContent = `Opens in ${hh > 0 ? hh + ':' : ''}${pad(mm)}:${pad(ss)}`;
                cd.className = 'clk-cd ' + (s <= 10 ? 'soon' : '');
                pill.classList.remove('go');
            } else if (diff > -4000) {
                cd.textContent = 'GO — click now';
                pill.classList.add('go');
            } else {
                cd.textContent = 'Open — one click, then wait (don’t press Back)';
                pill.classList.remove('go');
            }

            // 3-2-1 beep, then a higher GO tone at zero. Only when we've watched it count down
            // (prev values set), so enabling the clock after open doesn't blast a beep.
            const secondsLeft = Math.ceil(diff / 1000);
            if (prevSecondsLeft != null && prevDiff != null) {
                if (diff > 0 && secondsLeft < prevSecondsLeft && secondsLeft >= 1 && secondsLeft <= 3) {
                    beep(880, 130); // tick
                    LOG(`countdown ${secondsLeft}`);
                } else if (prevDiff > 0 && diff <= 0) {
                    beep(1320, 450, 0.3); // GO
                    LOG('countdown GO');
                }
            }
            prevSecondsLeft = secondsLeft;
            prevDiff = diff;
        }

        function mount() {
            if (host?.isConnected) return;
            host = document.createElement('div');
            host.id = 'ttdaf-clock-host';
            root = host.attachShadow({ mode: 'open' });
            root.innerHTML = `<style>
                .clk{position:fixed;left:16px;bottom:16px;z-index:2147483646;min-width:150px;
                     background:#233443;color:#fff;border-radius:12px;padding:10px 14px;
                     box-shadow:0 6px 20px rgba(0,0,0,.3);font-family:-apple-system,'Segoe UI',sans-serif;
                     border:2px solid transparent;user-select:none}
                .clk.go{border-color:#10b981;animation:pulse .6s infinite alternate}
                @keyframes pulse{from{box-shadow:0 0 0 0 rgba(16,185,129,.5)}to{box-shadow:0 0 0 8px rgba(16,185,129,0)}}
                .clk-time{font-size:26px;font-weight:700;letter-spacing:1px;font-variant-numeric:tabular-nums;line-height:1}
                .clk-sync{font-size:10px;opacity:.7;margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
                .clk-cd{font-size:13px;font-weight:600;margin-top:6px;color:#FFD700}
                .clk-cd.soon{color:#FF9933;font-size:15px}
                .clk.go .clk-cd{color:#10b981;font-size:16px}
                .clk-x{position:absolute;top:4px;right:8px;cursor:pointer;opacity:.5;font-size:14px}
                .clk-x:hover{opacity:1}
                .clk-mute{position:absolute;top:4px;right:26px;cursor:pointer;opacity:.6;font-size:13px}
                .clk-mute:hover{opacity:1}
            </style>
            <div class="clk">
                <div class="clk-mute" title="Mute / unmute countdown beep">🔊</div>
                <div class="clk-x" title="Hide">&times;</div>
                <div class="clk-time">--:--:--</div>
                <div class="clk-sync">syncing…</div>
                <div class="clk-cd"></div>
            </div>`;
            pill = root.querySelector('.clk');
            root.querySelector('.clk-x').addEventListener('click', () => hide(true));
            root.querySelector('.clk-mute').addEventListener('click', (e) => {
                soundOn = !soundOn;
                e.currentTarget.textContent = soundOn ? '🔊' : '🔇';
                if (soundOn) beep(660, 90, 0.15); // confirm it's audible
            });
            document.documentElement.appendChild(host);
            hookGesture();
            prevSecondsLeft = null;
            prevDiff = null;
            sync();
            tick = setInterval(render, 200);
            render();
        }

        function hide(userDismissed) {
            if (tick) { clearInterval(tick); tick = null; }
            host?.remove();
            host = null;
            if (userDismissed) ui.show('Booking clock hidden. Turn it back on from the extension popup.', 'info');
        }

        function apply(cfg) {
            enabled = !!cfg?.enabled;
            openHHMM = cfg?.open || '10:00';
            if (enabled) { mount(); } else { hide(false); }
        }

        async function init() {
            try {
                const { bookingClock: cfg } = await chrome.storage.local.get('bookingClock');
                apply(cfg);
            } catch (_) { /* storage unavailable */ }
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes.bookingClock) apply(changes.bookingClock.newValue);
            });
        }
        return { init };
    })();

    // ------------------------------------------------------------------
    // Shortcuts & messages
    // ------------------------------------------------------------------
    async function getAllProfiles() {
        const d = await chrome.storage.local.get(['singleProfiles', 'masterProfiles', 'profiles', 'lastUsedProfile']);
        return d;
    }

    async function recordUse(profile) {
        try {
            const d = await chrome.storage.local.get(['singleProfiles', 'masterProfiles']);
            const bump = (list) => (list || []).map((p) => (p.id === profile.id
                ? { ...p, stats: { ...(p.stats || {}), useCount: (p.stats?.useCount || 0) + 1, lastUsed: Date.now() } }
                : p));
            await chrome.storage.local.set({
                singleProfiles: bump(d.singleProfiles),
                masterProfiles: bump(d.masterProfiles),
                lastUsedProfile: profile
            });
        } catch (_) { /* stats are best-effort */ }
    }

    async function fillByShortcut(shortcut) {
        try {
            const d = await getAllProfiles();
            const all = [...(d.masterProfiles || []), ...(d.singleProfiles || []), ...(d.profiles || [])];
            const match = all.find((p) => String(p.shortcut || '').toLowerCase() === shortcut);
            if (!match) {
                ui.show(`No profile assigned to ${shortcut.toUpperCase()}. Set one in the extension popup.`, 'info');
                return;
            }
            LOG(`Shortcut ${shortcut} -> "${match.name}"`);
            recordUse(match);
            await runFill(match);
        } catch (e) {
            if (/context invalidated/i.test(e.message)) {
                ui.show('Extension was updated — please refresh this page (F5) and try again.', 'error', 8000);
            } else {
                ui.show(`Autofill error: ${e.message}`, 'error');
            }
        }
    }

    window.addEventListener('keydown', function onKey(e) {
        if (!e.isTrusted) return;
        if (!isCurrent()) {
            const newerCopyPresent = document.documentElement.dataset.ttdafInstance !== INSTANCE;
            if (newerCopyPresent) {
                window.removeEventListener('keydown', onKey, true); // step aside for the new copy
            } else if (/^(?:Digit|Numpad)[1-9]$/.test(e.code) && e.ctrlKey && (e.altKey || e.shiftKey)) {
                ui.show('Extension was updated — please refresh this page (F5) and try again.', 'error', 8000);
            }
            return;
        }

        if (e.key === 'Escape' && running) {
            running.cancelled = true;
            return;
        }

        // Use e.code: with Shift held, e.key for "1" is "!" (that broke Ctrl+Shift shortcuts before)
        const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (!m || e.metaKey) return;
        let shortcut = null;
        if (e.ctrlKey && e.altKey && !e.shiftKey) shortcut = `ctrl+alt+${m[1]}`;
        else if (e.ctrlKey && e.shiftKey && !e.altKey) shortcut = `ctrl+shift+${m[1]}`;
        if (!shortcut) return;

        e.preventDefault();
        e.stopPropagation();
        fillByShortcut(shortcut);
    }, true);

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!isCurrent()) return;
        switch (message?.action) {
            case 'ping':
                sendResponse({ ok: true });
                return;
            case 'fillForm':
                if (message.profile) runFill(message.profile);
                sendResponse({ success: true, started: true });
                return;
            case 'fillMasterProfile':
                if (message.masterProfile) runFill(message.masterProfile);
                sendResponse({ success: true, started: true });
                return;
            case 'fillLastUsed':
                getAllProfiles().then((d) => {
                    if (d.lastUsedProfile) runFill(d.lastUsedProfile);
                    else ui.show('No recently used profile yet — fill once from the popup first.', 'info');
                });
                sendResponse({ success: true, started: true });
                return;
            case 'detectFields':
                sendResponse({ fields: detectAllFields() });
                return;
        }
    });

    // Debug helper: in DevTools console pick the "TTD Fast Autofill" context, then run detectTTDFields()
    function detectAllFields() {
        const info = [...document.querySelectorAll('input, select, textarea')].map((f, i) => ({
            index: i + 1, tag: f.tagName.toLowerCase(), type: f.type, name: f.name, id: f.id,
            value: f.value, disabled: f.disabled, readOnly: f.readOnly, visible: isVisible(f), className: f.className
        }));
        console.table(info);
        return info;
    }
    window.detectTTDFields = detectAllFields;

    if (isCurrent()) bookingClock.init();

    LOG('Ready. Use your Ctrl+Alt+<1-9> / Ctrl+Shift+<1-9> shortcut on the Pilgrim Details page.');
})();
