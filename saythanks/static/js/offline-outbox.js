/* ==========================================================================
   SayThanks.io — IndexedDB Offline Outbox & Background Synchronizer
   Stores notes and audio messages in airplane mode and dispatches on reconnect.
   ========================================================================== */

const DB_NAME = 'SayThanksOutboxDB';
const DB_VERSION = 1;
const STORE_NAME = 'outbox';

function openOutboxDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Queues a note to the local IndexedDB Outbox
 */
async function queueOfflineNote(noteData) {
  const db = await openOutboxDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item = {
      action: noteData.action,
      byline: noteData.byline || '',
      body: noteData.body || '',
      audioBlob: noteData.audioBlob || null,
      audioFileName: noteData.audioFileName || 'voice_note.webm',
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    const req = store.add(item);
    req.onsuccess = () => {
      updateOutboxBadge();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Fetches all pending notes from the outbox
 */
async function getAllPendingNotes() {
  const db = await openOutboxDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Removes a synced note from the outbox
 */
async function deleteFromOutbox(id) {
  const db = await openOutboxDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => {
      updateOutboxBadge();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Automatically drains outbox queue by POSTing each note to its target action
 */
async function syncOutboxQueue() {
  if (!navigator.onLine) {
    return;
  }
  const pendingNotes = await getAllPendingNotes();
  if (pendingNotes.length === 0) {
    return;
  }

  showOutboxToast(`Syncing ${pendingNotes.length} offline note(s)...`);

  for (const note of pendingNotes) {
    try {
      const formData = new FormData();
      formData.append('byline', note.byline);
      formData.append('body', note.body);
      if (note.audioBlob) {
        formData.append('audio', note.audioBlob, note.audioFileName);
      }

      const response = await fetch(note.action, {
        method: 'POST',
        body: formData
      });

      if (response.ok || response.redirected || response.status < 400) {
        await deleteFromOutbox(note.id);
      }
    } catch (err) {
      console.warn('[Outbox Sync] Retry postponed:', err);
    }
  }

  const remaining = await getAllPendingNotes();
  if (remaining.length === 0) {
    showOutboxToast('All offline notes delivered successfully!');
  } else {
    updateOutboxBadge();
  }
}

/**
 * Updates the visual Outbox status indicator
 */
async function updateOutboxBadge() {
  try {
    const notes = await getAllPendingNotes();
    let badge = document.getElementById('pwa-outbox-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'pwa-outbox-badge';
      badge.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 9999;
        background: #33C3F0; color: #fff; padding: 10px 16px;
        border-radius: 24px; font-size: 13px; font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none;
        cursor: pointer; transition: all 0.3s ease;
      `;
      document.body.appendChild(badge);
      badge.addEventListener('click', () => syncOutboxQueue());
    }

    if (notes.length > 0) {
      badge.innerHTML = `📬 Outbox: ${notes.length} pending sync`;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  } catch (e) {
    // Ignore IndexedDB error if in restricted private mode
  }
}

function showOutboxToast(message) {
  let toast = document.getElementById('pwa-outbox-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pwa-outbox-toast';
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      z-index: 10000; background: #2ecc71; color: #fff; padding: 12px 24px;
      border-radius: 30px; font-size: 14px; font-weight: 600;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2); transition: opacity 0.4s ease;
    `;
    document.body.appendChild(toast);
  }
  toast.innerText = message;
  toast.style.opacity = '1';
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 400);
  }, 4000);
}

// Listen for network connectivity restored
window.addEventListener('online', () => {
  showOutboxToast('Connection restored! Syncing outbox...');
  syncOutboxQueue();
});

// Listen for Service Worker background sync triggers
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'TRIGGER_OUTBOX_SYNC') {
      syncOutboxQueue();
    }
  });
}

// Run initial check on load
window.addEventListener('DOMContentLoaded', () => {
  updateOutboxBadge();
  if (navigator.onLine) {
    syncOutboxQueue();
  }
});
