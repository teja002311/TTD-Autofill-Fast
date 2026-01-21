// Content Script - Core Autofill Engine
// Handles smart field detection, React/Angular-safe value injection, and form filling

console.log('Fast Autofill content script loaded');

// Field mapping patterns for different sites and field types
// EXPANDED WITH TTD-SPECIFIC PATTERNS
const FIELD_PATTERNS = {
    fullName: [
        'fname', // TTD darshan booking pages use this
        'name', 'pilgrimname', 'pilgrim_name', 'passengerName', 'passenger_name',
        'fullname', 'full_name', 'pname', 'userName', 'user_name',
        'devotee_name', 'devoteeName', 'personName', 'person_name'
    ],
    age: [
        'age', 'pilgrimage', 'pilgrim_age', 'passengerAge', 'passenger_age',
        'pAge', 'devotee_age', 'devoteeAge', 'personAge', 'person_age'
    ],
    gender: [
        'gender', 'sex', 'pilgrimgender', 'pilgrim_gender',
        'passengerGender', 'passenger_gender', 'pGender',
        'devotee_gender', 'devoteeGender', 'personGender'
    ],
    phone: [
        'phone', 'mobile', 'contact', 'phoneNumber', 'mobileNumber',
        'phone_number', 'mobile_number', 'contactNumber', 'contact_number',
        'mobileno', 'phoneno', 'cellphone'
    ],
    email: [
        'email', 'mail', 'emailId', 'email_id', 'e_mail',
        'emailaddress', 'email_address', 'mailid'
    ],
    idType: [
        // CRITICAL: TTD field name is "photoIdType" which becomes "photoidtype" after toLowerCase
        'photoidtype', 'photoidproof', 'photo_id_proof', 'photoIdProof', 'photoIdType',
        'photo_id_type', 'idproof', 'id_proof', 'idType', 'id_type',
        'idcard', 'id_card', 'documentType', 'document_type',
        'prooftype', 'proof_type', 'identityType', 'identity_type'
    ],
    idNumber: [
        // CRITICAL: TTD field name is "idProofNumber" which becomes "idproofnumber" after toLowerCase  
        'idproofnumber', 'photoidnumber', 'photo_id_number', 'photoIdNumber', 'photoIdNo',
        'photo_id_no', 'idnumber', 'id_number', 'idNo', 'id_no',
        'idcard_no', 'documentNumber', 'document_number', 'cardNumber',
        'card_number', 'proofnumber', 'proof_number', 'identityNumber',
        'aadhaar', 'aadhar', 'pan', 'passport'
    ],
    address: [
        'address', 'street', 'addr', 'address1', 'address_line',
        'addressline1', 'streetaddress', 'street_address'
    ],
    city: [
        'city', 'town', 'cityname', 'city_name', 'townname'
    ],
    state: [
        'state', 'province', 'statename', 'state_name'
    ],
    pincode: [
        'pincode', 'pin', 'zip', 'zipcode', 'postal', 'postalCode',
        'postal_code', 'pinno', 'pin_code'
    ],
    country: [
        'country', 'countryname', 'country_name', 'countryCode'
    ]
};

/**
 * Set value on an input element in a React/Angular-safe way
 * This triggers all necessary events that frameworks listen to
 */
function setNativeValue(element, value) {
    const { set: valueSetter } = Object.getOwnPropertyDescriptor(element, 'value') || {};
    const prototype = Object.getPrototypeOf(element);
    const { set: prototypeValueSetter } = Object.getOwnPropertyDescriptor(prototype, 'value') || {};

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
        valueSetter.call(element, value);
    } else {
        element.value = value;
    }

    // Dispatch events that React/Angular listen to
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Check if a field name/id/attribute matches a field type pattern
 */
function matchesPattern(fieldName, patterns) {
    if (!fieldName) return false;
    const lowerField = fieldName.toLowerCase();
    return patterns.some(pattern => lowerField.includes(pattern));
}

/**
 * Get all relevant attributes from an element for matching
 */
function getElementAttributes(element) {
    return [
        element.name,
        element.id,
        element.placeholder,
        element.getAttribute('aria-label'),
        element.getAttribute('formcontrolname'),
        element.getAttribute('ng-reflect-name'),
        element.getAttribute('data-field'),
        element.getAttribute('data-name'),
        element.className
    ].filter(Boolean).join(' ');
}

/**
 * Safely set input value using native setter to trigger React/Angular events
 * Removes maxlength restriction to allow full value (fixes 12-digit number truncation)
 */
function setNativeValue(element, value) {
    // Remove maxlength restriction to allow full value (e.g., 12-digit Aadhaar numbers)
    if (element.hasAttribute('maxlength')) {
        element.removeAttribute('maxlength');
    }

    // Set value using native setter
    element.value = value;

    // Trigger all necessary events for React/Angular
    const events = ['input', 'change', 'blur'];
    events.forEach(eventType => {
        element.dispatchEvent(new Event(eventType, { bubbles: true }));
    });
}

/**
 * DEBUG FUNCTION: Detect all form fields on the page
 * Call this to see what fields exist and their attributes
 */
function detectAllFields() {
    console.log('🔍 DETECTING ALL FORM FIELDS ON PAGE...');
    console.log('=====================================');

    const allFields = document.querySelectorAll('input, select, textarea');
    const fieldInfo = [];

    allFields.forEach((field, index) => {
        const info = {
            index: index + 1,
            type: field.tagName.toLowerCase(),
            inputType: field.type || 'N/A',
            name: field.name || 'N/A',
            id: field.id || 'N/A',
            formcontrolname: field.getAttribute('formcontrolname') || 'N/A',
            'ng-reflect-name': field.getAttribute('ng-reflect-name') || 'N/A',
            placeholder: field.placeholder || 'N/A',
            'aria-label': field.getAttribute('aria-label') || 'N/A',
            classList: field.className || 'N/A'
        };

        fieldInfo.push(info);
        console.log(`Field #${info.index}:`, info);
    });

    console.log('=====================================');
    console.log(`Total fields found: ${fieldInfo.length}`);
    console.log('Copy this information and send to developer to add patterns!');

    return fieldInfo;
}

/**
 * Find and fill a specific field type
 */
function fillField(fieldType, value, container = document) {
    if (!value) return false;

    const patterns = FIELD_PATTERNS[fieldType];
    if (!patterns) return false;

    // Find all input/select elements
    const elements = container.querySelectorAll('input, select, textarea');

    for (const element of elements) {
        const attributes = getElementAttributes(element);

        if (matchesPattern(attributes, patterns)) {
            // Handle select/dropdown elements
            if (element.tagName === 'SELECT') {
                fillSelect(element, value);
                console.log(`✅ Filled ${fieldType} (SELECT):`, value);
                return true;
            }

            // Handle radio buttons
            if (element.type === 'radio') {
                fillRadio(element, value);
                console.log(`✅ Filled ${fieldType} (RADIO):`, value);
                return true;
            }

            // Handle regular inputs
            if (element.type !== 'submit' && element.type !== 'button') {
                setNativeValue(element, value);
                console.log(`✅ Filled ${fieldType} (INPUT):`, value);

                // For gender and idType fields, also try Angular Material dropdown
                // in case the input is actually a trigger for a custom dropdown
                if (fieldType === 'gender' || fieldType === 'idType') {
                    // Optimized timing: Gender 200ms, idType 600ms
                    const delay = fieldType === 'idType' ? 600 : 200;
                    setTimeout(() => fillAngularMaterialDropdown(element, value), delay);
                }

                return true;
            }
        }
    }

    console.log(`⚠️  Could not find field for ${fieldType}`);
    return false;
}

/**
 * Fill a select dropdown (standard HTML)
 */
function fillSelect(selectElement, value) {
    const valueStr = String(value).toLowerCase();

    // Try to find matching option
    for (const option of selectElement.options) {
        const optionText = option.text.toLowerCase();
        const optionValue = option.value.toLowerCase();

        if (optionText.includes(valueStr) || optionValue.includes(valueStr) ||
            valueStr.includes(optionText) || valueStr.includes(optionValue)) {
            selectElement.value = option.value;
            setNativeValue(selectElement, option.value);
            return true;
        }
    }

    return false;
}

/**
 * Fill Angular Material dropdown (used by TTD)
 * These are custom dropdowns that need to be clicked to open
 */
function fillAngularMaterialDropdown(inputElement, value) {
    // KEEP ORIGINAL CAPITALIZATION - don't convert to lowercase!
    const searchValue = String(value);
    const searchValueLower = searchValue.toLowerCase();

    console.log(`🔍 Attempting Angular Material dropdown fill for: ${searchValue}`);

    // For TTD dropdowns, try clicking the input field FIRST
    // Only look for special triggers if input doesn't work
    let trigger = inputElement;  // Start with input itself

    console.log(`🎯 Will try clicking: ${trigger?.tagName}.${trigger?.className || 'no-class'}`);

    if (trigger) {
        // Click to open dropdown
        trigger.click();
        trigger.focus();
        console.log(`🖱️ Clicked dropdown trigger`);

        // Try to find and click options with RETRY logic
        // Some dropdowns load options slowly, so we try multiple times
        let attemptCount = 0;
        const maxAttempts = 3;
        const attemptIntervals = [300, 600, 1000]; // Try at 300ms, 600ms, 1000ms

        function tryFindAndClickOption(attemptNumber) {
            attemptCount++;
            console.log(`🔄 Attempt #${attemptCount} to find dropdown options...`);

            // Search for dropdown options
            const options = document.querySelectorAll(
                'mat-option, .mat-option, [role="option"], ' +
                '.mat-select-panel mat-option, cdk-virtual-scroll-viewport mat-option, ' +
                'div[role="listbox"] div, ul li, ' +
                '.dropdown-item, .select-option'
            );

            console.log(`📋 Found ${options.length} potential dropdown options`);

            // Filter to actual dropdown items
            const dropdownOptions = Array.from(options).filter(opt => {
                const classes = opt.className || '';
                return classes.includes('floatingDropdown') ||
                    classes.includes('listItem') ||
                    classes.includes('mat-option') ||
                    opt.getAttribute('role') === 'option';
            });

            console.log(`🎯 Filtered to ${dropdownOptions.length} actual dropdown options`);

            // If we found options, try to match and click
            if (dropdownOptions.length > 0) {
                console.log('Available options:');
                dropdownOptions.forEach((opt, idx) => {
                    const text = opt.textContent?.trim() || '';
                    console.log(`  ${idx + 1}. "${text}"`);
                });

                // Try exact match first
                for (const option of dropdownOptions) {
                    const optionText = option.textContent?.trim() || '';
                    if (optionText === searchValue) {
                        console.log(`✅ Found EXACT match: "${optionText}"`);
                        option.click();
                        setTimeout(() => console.log(`✅ Clicked: ${optionText}`), 50);
                        return true;
                    }
                }

                // Try case-insensitive exact
                for (const option of dropdownOptions) {
                    const optionText = option.textContent?.trim() || '';
                    if (optionText.toLowerCase() === searchValueLower) {
                        console.log(`✅ Found case-insensitive match: "${optionText}"`);
                        option.click();
                        setTimeout(() => console.log(`✅ Clicked: ${optionText}`), 50);
                        return true;
                    }
                }

                // Try starts-with
                for (const option of dropdownOptions) {
                    const optionText = option.textContent?.trim() || '';
                    if (optionText.toLowerCase().startsWith(searchValueLower)) {
                        console.log(`✅ Found starts-with match: "${optionText}"`);
                        option.click();
                        setTimeout(() => console.log(`✅ Clicked: ${optionText}`), 50);
                        return true;
                    }
                }

                // Try contains
                for (const option of dropdownOptions) {
                    const optionText = option.textContent?.trim() || '';
                    if (optionText.toLowerCase().includes(searchValueLower)) {
                        console.log(`✅ Found partial match: "${optionText}"`);
                        option.click();
                        setTimeout(() => console.log(`✅ Clicked: ${optionText}`), 50);
                        return true;
                    }
                }

                console.log(`⚠️ Options found but none matched: "${searchValue}"`);
                document.body.click();
                return false;
            }

            // No options found - try again if we haven't exceeded max attempts
            if (attemptNumber < maxAttempts) {
                console.log(`⏳ No options found yet, will retry in ${attemptIntervals[attemptNumber]}ms...`);
                setTimeout(() => tryFindAndClickOption(attemptNumber + 1), attemptIntervals[attemptNumber]);
            } else {
                console.log(`❌ Could not find dropdown options after ${maxAttempts} attempts`);
                document.body.click();
                return false;
            }
        }

        // Start first attempt after a short delay
        setTimeout(() => tryFindAndClickOption(0), attemptIntervals[0]);

        return true;
    }

    console.log(`⚠️ Could not find dropdown trigger`);
    return false;
}

/**
 * Fill radio button
    const valueStr = String(value).toLowerCase();
    const name = radioElement.name;
    const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);

    for (const radio of radios) {
        const radioValue = (radio.value || radio.id || '').toLowerCase();
        const radioLabel = radio.nextElementSibling?.textContent?.toLowerCase() || '';

        if (radioValue.includes(valueStr) || valueStr.includes(radioValue) ||
            radioLabel.includes(valueStr) || valueStr.includes(radioLabel)) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radio.dispatchEvent(new Event('click', { bubbles: true }));
            return true;
        }
    }

    return false;
}

/**
 * Main autofill function
 */
function autofillForm(profileData) {
    console.log('⚡ FAST AUTOFILL STARTING...');
    console.log('Profile data:', profileData);
    console.log('=====================================');

    let filledCount = 0;
    const startTime = performance.now();

    // Fill General Details
    if (fillField('email', profileData.email)) filledCount++;
    if (fillField('city', profileData.city)) filledCount++;
    if (fillField('state', profileData.state)) filledCount++;
    if (fillField('country', profileData.country)) filledCount++;
    if (fillField('pincode', profileData.pincode)) filledCount++;

    // Fill Pilgrim Details
    if (fillField('fullName', profileData.fullName)) filledCount++;
    if (fillField('age', profileData.age)) filledCount++;
    if (fillField('gender', profileData.gender)) filledCount++;

    // Fill ID Type first, then ID Number ONLY if ID Type was filled
    console.log(`🔍 Attempting to fill idType with value: "${profileData.idType}"`);
    const idTypeFilled = fillField('idType', profileData.idType);
    console.log(`📊 idType fill result: ${idTypeFilled}`);
    if (idTypeFilled) {
        filledCount++;
        // Only fill ID Number if ID Type was successfully filled
        if (profileData.idNumber) {
            if (fillField('idNumber', profileData.idNumber)) filledCount++;
        }
    }

    // Also try to fill ID Number even if ID Type wasn't filled (user can manually select dropdown)
    if (!idTypeFilled && profileData.idNumber) {
        // DON'T fill immediately - wait for Photo ID Proof dropdown first

        // If we filled ID Number but not ID Type, try to auto-select the Photo ID Proof dropdown
        // This uses same logic as Gender dropdown - click input and wait for options
        if (profileData.idType) {
            console.log(`🔄 Will attempt Photo ID Proof dropdown automation...`);
            setTimeout(() => {
                const idTypeInputs = document.querySelectorAll('input');
                for (const inp of idTypeInputs) {
                    const attrs = [inp.name, inp.id, inp.getAttribute('formcontrolname')].join('').toLowerCase();
                    if (attrs.includes('photoidtype') || attrs.includes('idtype')) {
                        fillAngularMaterialDropdown(inp, profileData.idType);

                        // Fill ID Number AFTER dropdown selection completes
                        setTimeout(() => {
                            console.log(`🔢 Filling ID Number after Photo ID Proof selection...`);
                            fillField('idNumber', profileData.idNumber);
                        }, 400); // Fast: dropdown completes in 400ms
                        break;
                    }
                }
            }, 600); // Fast: Gender finishes by 600ms
        }
    }

    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    console.log('=====================================');
    console.log(`✅ Autofill complete: ${filledCount} fields filled in ${duration}ms`);

    // Show visual feedback
    showNotification(`✓ Filled ${filledCount} fields in ${duration}ms`, 'success');

    return filledCount;
}

/**
 * Show temporary notification to user
 */
function showNotification(message, type = 'info') {
    // Remove existing notification
    const existing = document.getElementById('fast-autofill-notification');
    if (existing) existing.remove();

    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'fast-autofill-notification';
    notification.textContent = message;
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    font-weight: 500;
    animation: slideIn 0.3s ease-out;
  `;

    // Add animation
    const style = document.createElement('style');
    style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

/**
 * Detect separate pilgrim sections on TTD page
 * Returns array of container elements, one for each pilgrim
 */
function detectPilgrimSections() {
    const sections = [];

    // Look for sections containing name/age/gender fields
    // TTD typically groups pilgrim fields in parent divs
    const allInputs = document.querySelectorAll('input[name*="name"], input[name*="fname"]');

    allInputs.forEach(input => {
        // Find the parent section (usually a div/form container)
        const section = input.closest('div[class*="section"], div[class*="pilgrim"], div[class*="form"], form') || input.parentElement.parentElement;

        // Only add unique sections
        if (section && !sections.includes(section)) {
            sections.push(section);
        }
    });

    console.log(`🔍 Detected ${sections.length} pilgrim sections on page`);
    return sections;
}

/**
 * NEW: Fill Master Profile (Multiple Pilgrims)
 * NOTE: Currently fills only first pilgrim. Multi-section detection coming in next update.
 */
function autofillMasterProfile(masterProfile) {
    console.log('⚡ FILLING MASTER PROFILE (MULTI-PILGRIM)...');
    console.log('Master Profile:', masterProfile);
    console.log('=====================================');

    let filledCount = 0;
    const startTime = performance.now();

    // 1. Fill General Details (shared)
    if (fillField('email', masterProfile.generalDetails.email)) filledCount++;
    if (fillField('city', masterProfile.generalDetails.city)) filledCount++;
    if (fillField('state', masterProfile.generalDetails.state)) filledCount++;
    if (fillField('country', masterProfile.generalDetails.country)) filledCount++;
    if (fillField('pincode', masterProfile.generalDetails.pincode)) filledCount++;

    // 2. Detect pilgrim sections
    const pilgrimSections = detectPilgrimSections();

    // 3. Fill each pilgrim into their specific section
    // 3. Fill pilgrims - HYBRID: ID selectors OR pattern matching
    masterProfile.pilgrims.forEach((pilgrim, index) => {
        setTimeout(() => {
            console.log(`▶️ Pilgrim ${index + 1}`);

            // Try ID-based first (darshan pages: id="0", id="1")
            const idField = document.querySelector(`input[name="fname"][id="${index}"]`);

            if (idField) {
                // ID-based approach (darshan booking)
                console.log(`  ✓ ID-based (id="${index}")`);
                const f = {
                    name: document.querySelector(`input[name="fname"][id="${index}"]`),
                    age: document.querySelector(`input[name="age"][id="${index}"]`),
                    gender: document.querySelector(`input[name="gender"][id="${index}"]`),
                    idType: document.querySelector(`input[name="photoIdType"][id="${index}"]`),
                    idNum: document.querySelector(`input[name="idProofNumber"][id="${index}"]`)
                };
                if (f.name) setNativeValue(f.name, pilgrim.fullName);
                if (f.age) setNativeValue(f.age, pilgrim.age);
                if (f.gender) setNativeValue(f.gender, pilgrim.gender);
                setTimeout(() => {
                    if (f.gender) fillAngularMaterialDropdown(f.gender, pilgrim.gender);
                    setTimeout(() => {
                        if (f.idType) fillAngularMaterialDropdown(f.idType, pilgrim.idType);
                        setTimeout(() => { if (f.idNum) setNativeValue(f.idNum, pilgrim.idNumber); }, 400);
                    }, 600);
                }, 200);
            } else {
                // Pattern-based approach (other TTD pages)
                console.log(`  ✓ Pattern-based`);
                const sections = detectPilgrimSections();
                const section = sections[index] || document;

                fillField('fullName', pilgrim.fullName, section);
                fillField('age', pilgrim.age, section);
                fillField('gender', pilgrim.gender, section);

                setTimeout(() => {
                    // Find gender field and trigger dropdown
                    const genderInput = section.querySelector('input[name*="gender"], input[formcontrolname*="gender"]');
                    if (genderInput) fillAngularMaterialDropdown(genderInput, pilgrim.gender);

                    setTimeout(() => {
                        // Find Photo ID Type field and trigger dropdown
                        const idTypeInput = section.querySelector('input[name*="photoIdType"], input[name*="idType"], input[formcontrolname*="idType"]');
                        if (idTypeInput) {
                            fillAngularMaterialDropdown(idTypeInput, pilgrim.idType);
                            setTimeout(() => {
                                fillField('idNumber', pilgrim.idNumber, section);
                            }, 400);
                        }
                    }, 600);
                }, 200);
            }
        }, index * 2000);
    });

    // Count fields
    filledCount += (masterProfile.pilgrims.length * 4);

    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    console.log('=====================================');
    console.log(`✅ Master profile: ${filledCount} fields in ${duration}ms`);

    showNotification(`✓ Filling ${masterProfile.pilgrims.length} pilgrims...`, 'success');
    return filledCount;
}
/**
 * Listen for messages from background script or popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fillForm' && message.profile) {
        try {
            const count = autofillForm(message.profile.data);
            sendResponse({ success: true, filledCount: count });
        } catch (error) {
            console.error('Autofill error:', error);
            showNotification('❌ Autofill failed', 'error');
            sendResponse({ success: false, error: error.message });
        }
    } else if (message.action === 'fillMasterProfile' && message.masterProfile) {
        // NEW: Master profile fill (multi-pilgrim)
        try {
            const count = autofillMasterProfile(message.masterProfile);
            sendResponse({ success: true, filledCount: count });
        } catch (error) {
            console.error('Master autofill error:', error);
            showNotification('❌ Master autofill failed', 'error');
            sendResponse({ success: false, error: error.message });
        }
    }
    return true; // Keep channel open for async response
});

// MutationObserver to handle dynamically loaded forms
const observer = new MutationObserver((mutations) => {
    // We don't auto-fill on mutation, just log that DOM changed
    // User must explicitly trigger fill
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Expose debug function globally for easy access
window.detectTTDFields = detectAllFields;

console.log('⚡ Fast Autofill Extension Loaded!');
console.log('=====================================');
console.log('📋 To see all fields on this page, open Console and type:');
console.log('   detectTTDFields()');
console.log('=====================================');
console.log('✅ Ready to autofill - click extension or press Ctrl+Shift+1');
