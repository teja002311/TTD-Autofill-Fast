// TTD Fast Autofill - Professional Edition
// Complete UX features: Favorites, Search, Import/Export, Templates, Shortcuts

// ===== STATE MANAGEMENT =====
let currentView = 'master';
let editingProfile = null;
let editingType = null;
let masterProfiles = [];
let singleProfiles = [];
let lastUsedProfile = null;
let settings = {
    autoFillLastUsed: false
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', init);

async function init() {
    await loadAllData();
    setupEventListeners();
    setupKeyboardShortcuts();
    renderProfiles();

    // Auto-fill with last used if enabled
    if (settings.autoFillLastUsed && lastUsedProfile) {
        showToast('Press Ctrl+Shift+F to fill with last used profile', 'info');
    }
}

// ===== DATA MANAGEMENT =====
async function loadAllData() {
    const data = await chrome.storage.local.get(['masterProfiles', 'singleProfiles', 'lastUsedProfile', 'settings', 'profileStats']);

    masterProfiles = data.masterProfiles || [];
    singleProfiles = data.singleProfiles || [];
    lastUsedProfile = data.lastUsedProfile || null;
    settings = data.settings || { autoFillLastUsed: false };

    // Ensure all profiles have stats
    masterProfiles = masterProfiles.map(p => ({
        ...p,
        stats: p.stats || { useCount: 0, lastUsed: null, createdAt: Date.now(), favorite: false }
    }));

    singleProfiles = singleProfiles.map(p => ({
        ...p,
        stats: p.stats || { useCount: 0, lastUsed: null, createdAt: Date.now(), favorite: false }
    }));
}

async function saveData() {
    await chrome.storage.local.set({
        masterProfiles,
        singleProfiles,
        lastUsedProfile,
        settings
    });
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // New profile buttons
    document.getElementById('newMasterBtn').addEventListener('click', () => openEditor('master'));
    document.getElementById('newSingleBtn').addEventListener('click', () => openEditor('single'));

    // Quick actions
    document.getElementById('importBtn').addEventListener('click', importProfiles);
    document.getElementById('exportBtn').addEventListener('click', exportProfiles);
    document.getElementById('helpBtn').addEventListener('click', () => openModal('helpModal'));

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('closeSettings').addEventListener('click', () => closeModal('settingsModal'));
    document.getElementById('autoFillLastUsed').addEventListener('change', async (e) => {
        settings.autoFillLastUsed = e.target.checked;
        await saveData();
    });
    document.getElementById('clearAllData').addEventListener('click', clearAllData);

    // Help modal
    document.getElementById('closeHelp').addEventListener('click', () => closeModal('helpModal'));

    // Editor modal
    document.getElementById('closeEditor').addEventListener('click', closeEditor);

    // Search
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => filterProfiles(e.target.value));
    document.getElementById('clearSearch').addEventListener('click', () => {
        searchInput.value = '';
        filterProfiles('');
    });

    // Templates
    document.querySelectorAll('.template-card').forEach(card => {
        card.addEventListener('click', () => createFromTemplate(card.dataset.template));
    });
}

// ===== KEYBOARD SHORTCUTS =====
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', async (e) => {
        // Ctrl+Shift+F - Fill with last used
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            if (lastUsedProfile) {
                await fillProfile(lastUsedProfile);
            } else {
                showToast('No recently used profile', 'error');
            }
        }

        // Ctrl+Shift+M - Open Master Profiles
        if (e.ctrlKey && e.shiftKey && e.key === 'M') {
            e.preventDefault();
            switchView('master');
        }

        // Ctrl+Shift+S - Open Single Profiles
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            switchView('single');
        }

        // Custom Profile Shortcuts (Ctrl+Alt+1-9, Ctrl+Shift+1-9)
        if (e.key >= '1' && e.key <= '9') {
            let shortcut = '';

            if (e.ctrlKey && e.altKey && !e.shiftKey) {
                shortcut = `ctrl+alt+${e.key}`;
                e.preventDefault();
            } else if (e.ctrlKey && e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
                shortcut = `ctrl+shift+${e.key}`;
                e.preventDefault();
            }

            if (shortcut) {
                const profile = findProfileByShortcut(shortcut);
                if (profile) {
                    await fillProfile(profile);
                } else {
                    showToast(`No profile assigned to ${shortcut.toUpperCase().replace(/\+/g, '+')}`, 'info');
                }
            }
        }

        // Escape - Close modals
        if (e.key === 'Escape') {
            closeEditor();
            closeModal('settingsModal');
            closeModal('helpModal');
        }
    });
}

// Find profile by custom shortcut
function findProfileByShortcut(shortcut) {
    const allProfiles = [...masterProfiles, ...singleProfiles];
    return allProfiles.find(p => p.shortcut === shortcut);
}

// ===== VIEW MANAGEMENT =====
function switchView(view) {
    currentView = view;

    // Update tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Update views
    document.querySelectorAll('.profile-view').forEach(v => {
        v.classList.toggle('active', v.id === `${view}View`);
    });
}

// ===== PROFILE RENDERING =====
function renderProfiles() {
    renderMasterProfiles();
    renderSingleProfiles();
}

function renderMasterProfiles() {
    const container = document.getElementById('masterProfileList');
    const filtered = getFilteredProfiles(masterProfiles);

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-text">No master profiles yet</div>
                <button class="btn-primary btn-sm" onclick="document.getElementById('newMasterBtn').click()">Create Your First Profile</button>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(profile => createProfileCard(profile, 'master')).join('');
    attachProfileListeners();
}

function renderSingleProfiles() {
    const container = document.getElementById('singleProfileList');
    const filtered = getFilteredProfiles(singleProfiles);

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👤</div>
                <div class="empty-state-text">No single profiles yet</div>
                <button class="btn-primary btn-sm" onclick="document.getElementById('newSingleBtn').click()">Create Your First Profile</button>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(profile => createProfileCard(profile, 'single')).join('');
    attachProfileListeners();
}

function createProfileCard(profile, type) {
    const stats = profile.stats || {};
    const isFavorite = stats.favorite || false;
    const lastUsed = stats.lastUsed ? formatRelativeTime(stats.lastUsed) : 'Never';
    const useCount = stats.useCount || 0;
    const shortcut = profile.shortcut || '';

    let metaInfo = '';
    if (type === 'master') {
        metaInfo = `<span class="pilgrim-count">${profile.pilgrims.length} pilgrims</span>`;
    } else {
        metaInfo = `${profile.data.fullName} • ${profile.data.age}y`;
    }

    return `
        <div class="profile-card" data-id="${profile.id}" data-type="${type}">
            <div class="profile-card-header">
                <div class="profile-info">
                    <div class="profile-name">
                        ${isFavorite ? '<span class="favorite-star">⭐</span>' : ''}
                        ${escapeHtml(profile.name)}
                        ${shortcut ? `<kbd class="shortcut-badge">${shortcut.toUpperCase()}</kbd>` : ''}
                    </div>
                    <div class="profile-meta">
                        <span class="meta-item">${metaInfo}</span>
                    </div>
                    <div class="profile-stats">
                        Last used: ${lastUsed} • Used ${useCount} times
                    </div>
                </div>
            </div>
            <div class="profile-actions">
                <button class="btn btn-primary btn-sm fill-btn" data-id="${profile.id}" data-type="${type}">
                    ⚡ Fill
                </button>
                <button class="btn-icon favorite-btn" data-id="${profile.id}" data-type="${type}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorite ? '#FFD700' : 'none'}" stroke="currentColor">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                </button>
                <button class="btn-icon edit-btn" data-id="${profile.id}" data-type="${type}" title="Edit">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-icon duplicate-btn" data-id="${profile.id}" data-type="${type}" title="Duplicate">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                </button>
                <button class="btn-icon delete-btn" data-id="${profile.id}" data-type="${type}" title="Delete">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

function attachProfileListeners() {
    // Fill buttons
    document.querySelectorAll('.fill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const profile = getProfile(btn.dataset.id, btn.dataset.type);
            fillProfile(profile);
        });
    });

    // Favorite buttons
    document.querySelectorAll('.favorite-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleFavorite(btn.dataset.id, btn.dataset.type));
    });

    // Edit buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const profile = getProfile(btn.dataset.id, btn.dataset.type);
            openEditor(btn.dataset.type, profile);
        });
    });

    // Duplicate buttons
    document.querySelectorAll('.duplicate-btn').forEach(btn => {
        btn.addEventListener('click', () => duplicateProfile(btn.dataset.id, btn.dataset.type));
    });

    // Delete buttons
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteProfile(btn.dataset.id, btn.dataset.type));
    });
}

// ===== PROFILE OPERATIONS =====
function getProfile(id, type) {
    const profiles = type === 'master' ? masterProfiles : singleProfiles;
    return profiles.find(p => p.id === id);
}

async function toggleFavorite(id, type) {
    const profile = getProfile(id, type);
    if (!profile) return;

    profile.stats = profile.stats || {};
    profile.stats.favorite = !profile.stats.favorite;

    await saveData();
    renderProfiles();
    showToast(profile.stats.favorite ? '⭐ Added to favorites' : 'Removed from favorites', 'success');
}

async function duplicateProfile(id, type) {
    const profile = getProfile(id, type);
    if (!profile) return;

    const duplicate = {
        ...JSON.parse(JSON.stringify(profile)),
        id: `${type}-${Date.now()}`,
        name: `${profile.name} (Copy)`,
        stats: {
            useCount: 0,
            lastUsed: null,
            createdAt: Date.now(),
            favorite: false
        }
    };

    if (type === 'master') {
        masterProfiles.push(duplicate);
    } else {
        singleProfiles.push(duplicate);
    }

    await saveData();
    renderProfiles();
    showToast('✅ Profile duplicated', 'success');
}

async function deleteProfile(id, type) {
    if (!confirm('Are you sure you want to delete this profile?')) return;

    if (type === 'master') {
        masterProfiles = masterProfiles.filter(p => p.id !== id);
    } else {
        singleProfiles = singleProfiles.filter(p => p.id !== id);
    }

    await saveData();
    renderProfiles();
    showToast('🗑️ Profile deleted', 'success');
}

// ===== PROFILE FILLING =====
async function fillProfile(profile) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.id) {
            showToast('No active tab found', 'error');
            return;
        }

        if (!tab.url?.includes('ttdevasthanams.ap.gov.in')) {
            showToast('Please navigate to TTD website first', 'error');
            return;
        }

        // Determine message based on profile type
        const message = profile.pilgrims
            ? { action: 'fillMasterProfile', masterProfile: profile }
            : { action: 'fillForm', profile: profile };

        await chrome.tabs.sendMessage(tab.id, message);

        // Update stats
        profile.stats = profile.stats || {};
        profile.stats.useCount = (profile.stats.useCount || 0) + 1;
        profile.stats.lastUsed = Date.now();
        lastUsedProfile = profile;

        await saveData();

        showToast(`✓ Filling ${profile.pilgrims ? profile.pilgrims.length + ' pilgrims' : 'form'}...`, 'success');
        setTimeout(() => window.close(), 1500);

    } catch (error) {
        console.error('Fill error:', error);
        if (error.message.includes('Receiving end does not exist')) {
            showToast('Please refresh the TTD page (F5) and try again', 'error');
        } else {
            showToast('Error: ' + error.message, 'error');
        }
    }
}

// ===== PROFILE EDITOR =====
function openEditor(type, profile = null) {
    editingType = type;
    editingProfile = profile;

    const title = document.getElementById('editorTitle');
    const body = document.getElementById('editorBody');

    title.textContent = profile ? `Edit ${type === 'master' ? 'Master' : 'Single'} Profile` : `New ${type === 'master' ? 'Master' : 'Single'} Profile`;

    body.innerHTML = type === 'master' ? createMasterForm(profile) : createSingleForm(profile);

    // Attach form listeners
    const form = body.querySelector('form');
    form.addEventListener('submit', handleFormSubmit);

    if (type === 'master') {
        document.getElementById('pilgrimCount').addEventListener('change', (e) => {
            generatePilgrimFields(parseInt(e.target.value));
        });

        // FIX: Generate pilgrim fields immediately if editing existing profile
        if (profile && profile.pilgrims && profile.pilgrims.length > 0) {
            setTimeout(() => {
                generatePilgrimFields(profile.pilgrims.length);
            }, 0);
        }
    }

    openModal('editorModal');
}

function generateShortcutOptions(modifier, currentShortcut) {
    const allProfiles = [...masterProfiles, ...singleProfiles];
    const usedShortcuts = new Set(
        allProfiles
            .filter(p => p.shortcut && (!editingProfile || p.id !== editingProfile.id))
            .map(p => p.shortcut.toLowerCase())
    );

    let options = '';
    for (let i = 1; i <= 9; i++) {
        const shortcutKey = `${modifier}+${i}`;
        const isUsed = usedShortcuts.has(shortcutKey);
        const isSelected = currentShortcut?.toLowerCase() === shortcutKey;
        const label = modifier === 'ctrl' ? `Ctrl+${i}` : `Alt+${i}`;

        if (isUsed && !isSelected) {
            options += `<option value="${shortcutKey}" disabled>${label} (Used)</option>`;
        } else {
            options += `<option value="${shortcutKey}" ${isSelected ? 'selected' : ''}>${label}</option>`;
        }
    }
    return options;
}

function createMasterForm(profile) {
    const pilgrimCount = profile ? profile.pilgrims.length : '';

    return `
        <form id="profileForm" class="profile-form">
            <div class="form-group">
                <label class="form-label">Profile Name *</label>
                <input type="text" class="form-input" id="profileName" value="${profile ? escapeHtml(profile.name) : ''}" required>
            </div>
            
            <div class="form-group">
                <label class="form-label">Keyboard Shortcut (Optional)</label>
                <select class="form-select" id="profileShortcut">
                    <option value="">None</option>
                    <optgroup label="Ctrl+Alt Shortcuts">
                        ${generateShortcutOptions('ctrl+alt', profile?.shortcut)}
                    </optgroup>
                    <optgroup label="Ctrl+Shift Shortcuts">
                        ${generateShortcutOptions('ctrl+shift', profile?.shortcut)}
                    </optgroup>
                </select>
                <small class="form-hint">Avoid browser conflicts - Use Ctrl+Alt or Ctrl+Shift combos</small>
            </div>
            
            <div class="form-group">
                <label class="form-label">Number of Pilgrims *</label>
                <select class="form-select" id="pilgrimCount" required>
                    <option value="">Select...</option>
                    ${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === pilgrimCount ? 'selected' : ''}>${n} ${n === 1 ? 'Person' : 'People'}</option>`).join('')}
                </select>
            </div>
            
            <h3 class="form-section-title">General Details (Shared)</h3>
            
            <div class="form-group">
                <label class="form-label">Email Address *</label>
                <input type="email" class="form-input" id="general_email" value="${profile ? escapeHtml(profile.generalDetails.email) : ''}" required>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">City *</label>
                    <input type="text" class="form-input" id="general_city" value="${profile ? escapeHtml(profile.generalDetails.city) : ''}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">State *</label>
                    <input type="text" class="form-input" id="general_state" value="${profile ? escapeHtml(profile.generalDetails.state) : ''}" required>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Country *</label>
                    <input type="text" class="form-input" id="general_country" value="${profile ? escapeHtml(profile.generalDetails.country) : ''}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Pincode *</label>
                    <input type="text" class="form-input" id="general_pincode" value="${profile ? escapeHtml(profile.generalDetails.pincode) : ''}" pattern="[0-9]{6}" required>
                </div>
            </div>
            
            <h3 class="form-section-title">Pilgrim Details</h3>
            <div id="pilgrimFields"></div>
            
            <div class="form-actions">
                <button type="submit" class="btn btn-primary btn-block">Save Profile</button>
            </div>
        </form>
    `;
}

function createSingleForm(profile) {
    const data = profile ? profile.data : {};

    return `
        <form id="profileForm" class="profile-form">
            <div class="form-group">
                <label class="form-label">Profile Name *</label>
                <input type="text" class="form-input" id="profileName" value="${profile ? escapeHtml(profile.name) : ''}" required>
            </div>
            
            <div class="form-group">
                <label class="form-label">Keyboard Shortcut (Optional)</label>
                <select class="form-select" id="profileShortcut">
                    <option value="">None</option>
                    <optgroup label="Ctrl+Alt Shortcuts">
                        ${generateShortcutOptions('ctrl+alt', profile?.shortcut)}
                    </optgroup>
                    <optgroup label="Ctrl+Shift Shortcuts">
                        ${generateShortcutOptions('ctrl+shift', profile?.shortcut)}
                    </optgroup>
                </select>
                <small class="form-hint">Avoid browser conflicts - Use Ctrl+Alt or Ctrl+Shift combos</small>
            </div>
            
            <h3 class="form-section-title">General Details</h3>
            
            <div class="form-group">
                <label class="form-label">Email Address *</label>
                <input type="email" class="form-input" id="email" value="${escapeHtml(data.email || '')}" required>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">City *</label>
                    <input type="text" class="form-input" id="city" value="${escapeHtml(data.city || '')}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">State *</label>
                    <input type="text" class="form-input" id="state" value="${escapeHtml(data.state || '')}" required>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Country *</label>
                    <input type="text" class="form-input" id="country" value="${escapeHtml(data.country || '')}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Pincode *</label>
                    <input type="text" class="form-input" id="pincode" value="${escapeHtml(data.pincode || '')}" pattern="[0-9]{6}" required>
                </div>
            </div>
            
            <h3 class="form-section-title">Pilgrim Details</h3>
            
            <div class="form-group">
                <label class="form-label">Full Name *</label>
                <input type="text" class="form-input" id="fullName" value="${escapeHtml(data.fullName || '')}" required>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Age *</label>
                    <input type="number" class="form-input" id="age" value="${data.age || ''}" min="1" max="120" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Gender *</label>
                    <select class="form-select" id="gender" required>
                        <option value="">Select...</option>
                        <option value="Male" ${data.gender === 'Male' ? 'selected' : ''}>Male</option>
                        <option value="Female" ${data.gender === 'Female' ? 'selected' : ''}>Female</option>
                        <option value="Transgender" ${data.gender === 'Transgender' ? 'selected' : ''}>Transgender</option>
                    </select>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Photo ID Proof *</label>
                    <select class="form-select" id="idType" required>
                        <option value="">Select...</option>
                        <option value="Aadhaar Card" ${data.idType === 'Aadhaar Card' ? 'selected' : ''}>Aadhaar Card</option>
                        <option value="Passport" ${data.idType === 'Passport' ? 'selected' : ''}>Passport</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">ID Number *</label>
                    <input type="text" class="form-input" id="idNumber" value="${escapeHtml(data.idNumber || '')}" required>
                </div>
            </div>
            
            <div class="form-actions">
                <button type="submit" class="btn btn-primary btn-block">Save Profile</button>
            </div>
        </form>
    `;
}

function generatePilgrimFields(count) {
    const container = document.getElementById('pilgrimFields');
    if (!container) return;

    container.innerHTML = '';

    for (let i = 0; i < count; i++) {
        const pilgrim = editingProfile?.pilgrims?.[i] || {};

        container.innerHTML += `
            <div class="pilgrim-section">
                <h4>Pilgrim ${i + 1}</h4>
                
                <div class="form-group">
                    <label class="form-label">Full Name *</label>
                    <input type="text" class="form-input pilgrim-name" data-index="${i}" value="${escapeHtml(pilgrim.fullName || '')}" required>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Age *</label>
                        <input type="number" class="form-input pilgrim-age" data-index="${i}" value="${pilgrim.age || ''}" min="1" max="120" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Gender *</label>
                        <select class="form-select pilgrim-gender" data-index="${i}" required>
                            <option value="">Select...</option>
                            <option value="Male" ${pilgrim.gender === 'Male' ? 'selected' : ''}>Male</option>
                            <option value="Female" ${pilgrim.gender === 'Female' ? 'selected' : ''}>Female</option>
                            <option value="Transgender" ${pilgrim.gender === 'Transgender' ? 'selected' : ''}>Transgender</option>
                        </select>
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Photo ID Proof *</label>
                        <select class="form-select pilgrim-idtype" data-index="${i}" required>
                            <option value="">Select...</option>
                            <option value="Aadhaar Card" ${pilgrim.idType === 'Aadhaar Card' ? 'selected' : ''}>Aadhaar Card</option>
                            <option value="Passport" ${pilgrim.idType === 'Passport' ? 'selected' : ''}>Passport</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">ID Number *</label>
                        <input type="text" class="form-input pilgrim-idnumber" data-index="${i}" value="${escapeHtml(pilgrim.idNumber || '')}" required>
                    </div>
                </div>
            </div>
        `;
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();

    if (editingType === 'master') {
        await saveMasterProfile();
    } else {
        await saveSingleProfile();
    }

    closeEditor();
    await saveData();
    renderProfiles();
    showToast('✅ Profile saved successfully', 'success');
}

async function saveMasterProfile() {
    const shortcut = document.getElementById('profileShortcut').value;

    // Validate shortcut isn't already used by another profile
    if (shortcut) {
        const allProfiles = [...masterProfiles, ...singleProfiles];
        const duplicate = allProfiles.find(p =>
            p.shortcut?.toLowerCase() === shortcut.toLowerCase() &&
            (!editingProfile || p.id !== editingProfile.id)
        );

        if (duplicate) {
            showToast(`⚠️ Shortcut "${shortcut.toUpperCase()}" is already used by "${duplicate.name}"`, 'error');
            return;
        }
    }

    const profile = {
        id: editingProfile?.id || `master-${Date.now()}`,
        name: document.getElementById('profileName').value,
        shortcut: shortcut,
        generalDetails: {
            email: document.getElementById('general_email').value,
            city: document.getElementById('general_city').value,
            state: document.getElementById('general_state').value,
            country: document.getElementById('general_country').value,
            pincode: document.getElementById('general_pincode').value
        },
        pilgrims: [],
        stats: editingProfile?.stats || {
            useCount: 0,
            lastUsed: null,
            createdAt: Date.now(),
            favorite: false
        }
    };

    const count = parseInt(document.getElementById('pilgrimCount').value);
    for (let i = 0; i < count; i++) {
        profile.pilgrims.push({
            fullName: document.querySelector(`.pilgrim-name[data-index="${i}"]`).value,
            age: document.querySelector(`.pilgrim-age[data-index="${i}"]`).value,
            gender: document.querySelector(`.pilgrim-gender[data-index="${i}"]`).value,
            idType: document.querySelector(`.pilgrim-idtype[data-index="${i}"]`).value,
            idNumber: document.querySelector(`.pilgrim-idnumber[data-index="${i}"]`).value
        });
    }

    if (editingProfile) {
        const index = masterProfiles.findIndex(p => p.id === editingProfile.id);
        masterProfiles[index] = profile;
    } else {
        masterProfiles.push(profile);
    }
}

async function saveSingleProfile() {
    const shortcut = document.getElementById('profileShortcut').value;

    // Validate shortcut isn't already used by another profile
    if (shortcut) {
        const allProfiles = [...masterProfiles, ...singleProfiles];
        const duplicate = allProfiles.find(p =>
            p.shortcut?.toLowerCase() === shortcut.toLowerCase() &&
            (!editingProfile || p.id !== editingProfile.id)
        );

        if (duplicate) {
            showToast(`⚠️ Shortcut "${shortcut.toUpperCase()}" is already used by "${duplicate.name}"`, 'error');
            return;
        }
    }

    const profile = {
        id: editingProfile?.id || `single-${Date.now()}`,
        name: document.getElementById('profileName').value,
        shortcut: shortcut,
        data: {
            email: document.getElementById('email').value,
            city: document.getElementById('city').value,
            state: document.getElementById('state').value,
            country: document.getElementById('country').value,
            pincode: document.getElementById('pincode').value,
            fullName: document.getElementById('fullName').value,
            age: document.getElementById('age').value,
            gender: document.getElementById('gender').value,
            idType: document.getElementById('idType').value,
            idNumber: document.getElementById('idNumber').value
        },
        stats: editingProfile?.stats || {
            useCount: 0,
            lastUsed: null,
            createdAt: Date.now(),
            favorite: false
        }
    };

    if (editingProfile) {
        const index = singleProfiles.findIndex(p => p.id === editingProfile.id);
        singleProfiles[index] = profile;
    } else {
        singleProfiles.push(profile);
    }
}

function closeEditor() {
    closeModal('editorModal');
    editingProfile = null;
    editingType = null;
}

// ===== TEMPLATES =====
function createFromTemplate(template) {
    const templates = {
        self: { name: 'Self Only', count: 1 },
        couple: { name: 'Couple', count: 2 },
        family4: { name: 'Family of 4', count: 4 },
        family6: { name: 'Family of 6', count: 6 }
    };

    const templateData = templates[template];
    openEditor('master');

    setTimeout(() => {
        document.getElementById('profileName').value = templateData.name;
        document.getElementById('pilgrimCount').value = templateData.count;
        document.getElementById('pilgrimCount').dispatchEvent(new Event('change'));
    }, 100);
}

// ===== IMPORT/EXPORT =====
function exportProfiles() {
    const data = {
        masterProfiles,
        singleProfiles,
        exportedAt: new Date().toISOString(),
        version: '2.0.0'
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ttd-profiles-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('📥 Profiles exported successfully', 'success');
}

function importProfiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
        try {
            const file = e.target.files[0];
            const text = await file.text();
            const data = JSON.parse(text);

            if (confirm(`Import ${(data.masterProfiles?.length || 0) + (data.singleProfiles?.length || 0)} profiles? This will add to existing profiles.`)) {
                masterProfiles = [...masterProfiles, ...(data.masterProfiles || [])];
                singleProfiles = [...singleProfiles, ...(data.singleProfiles || [])];

                await saveData();
                renderProfiles();
                showToast('📤 Profiles imported successfully', 'success');
            }
        } catch (error) {
            showToast('❌ Import failed: Invalid file', 'error');
        }
    };

    input.click();
}

// ===== SEARCH/FILTER =====
function filterProfiles(query) {
    const q = query.toLowerCase();

    document.querySelectorAll('.profile-card').forEach(card => {
        const name = card.querySelector('.profile-name').textContent.toLowerCase();
        card.style.display = name.includes(q) ? '' : 'none';
    });
}

function getFilteredProfiles(profiles) {
    // Sort: favorites first, then by last used
    return [...profiles].sort((a, b) => {
        if (a.stats?.favorite && !b.stats?.favorite) return -1;
        if (!a.stats?.favorite && b.stats?.favorite) return 1;
        return (b.stats?.lastUsed || 0) - (a.stats?.lastUsed || 0);
    });
}

// ===== SETTINGS =====
function openSettings() {
    document.getElementById('autoFillLastUsed').checked = settings.autoFillLastUsed;
    openModal('settingsModal');
}

async function clearAllData() {
    if (!confirm('⚠️ This will delete ALL profiles and data. Are you absolutely sure?')) return;
    if (!confirm('⚠️ Last chance! This cannot be undone. Delete everything?')) return;

    masterProfiles = [];
    singleProfiles = [];
    lastUsedProfile = null;

    await chrome.storage.local.clear();
    renderProfiles();
    closeModal('settingsModal');
    showToast('🗑️ All data cleared', 'info');
}

// ===== MODAL MANAGEMENT =====
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ===== UTILITIES =====
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return 'Never';

    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return new Date(timestamp).toLocaleDateString();
}
