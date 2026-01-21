// Background Service Worker for Fast Autofill Extension
// Handles keyboard shortcuts, extension installation, and message coordination

// Initialize default profiles on installation
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Fast Autofill Extension installed');

  // Check if profiles already exist
  const { profiles } = await chrome.storage.local.get('profiles');

  // If no profiles, create sample profiles
  if (!profiles || profiles.length === 0) {
    const defaultProfiles = [
      {
        id: 'profile-1',
        name: 'Self',
        data: {
          // General Details
          email: 'john.doe@example.com',
          city: 'Hyderabad',
          state: 'Telangana',
          country: 'India',
          pincode: '500001',
          // Pilgrim Details
          fullName: 'John Doe',
          age: '30',
          gender: 'Male',
          idType: 'Aadhaar Card',
          idNumber: '123456789012'  // 12 digits
        }
      },
      {
        id: 'profile-2',
        name: 'Family Member 1',
        data: {
          // General Details
          email: 'jane.doe@example.com',
          city: 'Hyderabad',
          state: 'Telangana',
          country: 'India',
          pincode: '500001',
          // Pilgrim Details
          fullName: 'Jane Doe',
          age: '28',
          gender: 'Female',
          idType: 'Passport',
          idNumber: 'P12345678'
        }
      }
    ];

    await chrome.storage.local.set({ profiles: defaultProfiles });
    console.log('Default profiles created');
  }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  console.log('Keyboard shortcut triggered:', command);

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) {
    console.error('No active tab found');
    return;
  }

  // Check if tab URL matches allowed domains
  const allowedDomains = ['irctc.co.in', 'ttdsevaonline.com', 'ttdevasthanams.ap.gov.in', 'bookmyshow.com'];
  const isAllowed = allowedDomains.some(domain => tab.url?.includes(domain));

  if (!isAllowed) {
    console.log('Current site not in allowed list');
    return;
  }

  // Determine which profile to fill
  let profileIndex = -1;
  if (command === 'fill-profile-1') profileIndex = 0;
  else if (command === 'fill-profile-2') profileIndex = 1;
  else if (command === 'fill-profile-3') profileIndex = 2;

  if (profileIndex === -1) return;

  // Get profiles from storage
  const { profiles } = await chrome.storage.local.get('profiles');

  if (!profiles || !profiles[profileIndex]) {
    console.error('Profile not found at index:', profileIndex);
    return;
  }

  // Send message to content script to fill form
  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'fillForm',
      profile: profiles[profileIndex]
    });
    console.log('Autofill triggered for profile:', profiles[profileIndex].name);
  } catch (error) {
    console.error('Error sending message to content script:', error);
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fillFormFromPopup') {
    // Forward to content script in active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'fillForm',
          profile: message.profile
        }).then(() => {
          sendResponse({ success: true });
        }).catch((error) => {
          console.error('Error forwarding message:', error);
          sendResponse({ success: false, error: error.message });
        });
      }
    });
    return true; // Keep channel open for async response
  }
});

console.log('Fast Autofill background service worker ready');
