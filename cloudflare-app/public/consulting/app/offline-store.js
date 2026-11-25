/**
 * Zero-dependency IndexedDB offline persistence for Field To Forest Compliance Studio.
 * Stores multiple job drafts, binary site photos (ArrayBuffer), and pending D1/R2 sync state
 * so rural zero-signal field inspections survive page reloads, browser restarts, and multi-site days.
 */

const DB_NAME = "ftf_compliance_offline_v1";
const DB_VERSION = 1;

let _dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("drafts")) {
          const ds = db.createObjectStore("drafts", { keyPath: "draftKey" });
          ds.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains("photos")) {
          const ps = db.createObjectStore("photos", { keyPath: "id" });
          ps.createIndex("draftKey", "draftKey");
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
  return _dbPromise;
}

function runTx(storeName, mode, fn) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);
        if (req && typeof req === "object" && "onsuccess" in req) {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } else {
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(null);
        }
      } catch (_) {
        resolve(null);
      }
    });
  });
}

export function getDraftKey(activeJobId, assessment) {
  if (activeJobId) return `job:${activeJobId}`;
  const ref = String(assessment?.project_ref || "draft").trim();
  return `local:${ref}`;
}

export async function saveOfflineDraft({ draftKey, activeJobId, assessment, spatial, dirty = true }) {
  if (!draftKey || !assessment) return null;
  const record = {
    draftKey,
    activeJobId: activeJobId || null,
    projectRef: assessment.project_ref || draftKey,
    applicantName: assessment.applicant_name || "Draft Client",
    lotNumber: assessment.lot_number || "",
    planLabel: assessment.plan_label || "",
    assessment,
    spatial: spatial || null,
    dirty: Boolean(dirty),
    updatedAt: new Date().toISOString(),
  };
  await runTx("drafts", "readwrite", (s) => s.put(record));
  await runTx("meta", "readwrite", (s) => s.put({ key: "lastDraftKey", value: draftKey }));
  return record;
}

export async function getOfflineDraft(draftKey) {
  if (!draftKey) return null;
  return await runTx("drafts", "readonly", (s) => s.get(draftKey));
}

export async function getLastOfflineDraft() {
  const meta = await runTx("meta", "readonly", (s) => s.get("lastDraftKey"));
  if (meta?.value) {
    const found = await getOfflineDraft(meta.value);
    if (found) return found;
  }
  const all = await listOfflineDrafts();
  return all.length ? all[0] : null;
}

export async function listOfflineDrafts() {
  const all = await runTx("drafts", "readonly", (s) => s.getAll());
  if (!Array.isArray(all)) return [];
  return all.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function deleteOfflineDraft(draftKey) {
  if (!draftKey) return;
  await runTx("drafts", "readwrite", (s) => s.delete(draftKey));
  const photos = await listOfflinePhotos(draftKey);
  for (const p of photos) {
    await deleteOfflinePhoto(p.id);
  }
}

export async function saveOfflinePhoto(photo) {
  if (!photo?.id || !photo?.draftKey) return null;
  const rec = {
    id: photo.id,
    draftKey: photo.draftKey,
    caption: photo.caption || "Site photo",
    ext: photo.ext || "jpg",
    mimeType: photo.mimeType || "image/jpeg",
    bytes: photo.bytes,
    synced: Boolean(photo.synced),
    createdAt: photo.createdAt || new Date().toISOString(),
  };
  await runTx("photos", "readwrite", (s) => s.put(rec));
  return rec;
}

export async function listOfflinePhotos(draftKey) {
  if (!draftKey) return [];
  const res = await runTx("photos", "readonly", (s) => s.index("draftKey").getAll(draftKey));
  return Array.isArray(res) ? res : [];
}

export async function listAllUnsyncedPhotos() {
  const all = await runTx("photos", "readonly", (s) => s.getAll());
  if (!Array.isArray(all)) return [];
  return all.filter((p) => !p.synced);
}

export async function markOfflinePhotoSynced(photoId, newDraftKey = null) {
  const existing = await runTx("photos", "readonly", (s) => s.get(photoId));
  if (!existing) return;
  existing.synced = true;
  if (newDraftKey) existing.draftKey = newDraftKey;
  await runTx("photos", "readwrite", (s) => s.put(existing));
}

export async function rekeyOfflinePhotos(oldDraftKey, newDraftKey) {
  if (!oldDraftKey || !newDraftKey || oldDraftKey === newDraftKey) return;
  const photos = await listOfflinePhotos(oldDraftKey);
  for (const p of photos) {
    p.draftKey = newDraftKey;
    await runTx("photos", "readwrite", (s) => s.put(p));
  }
}

export async function deleteOfflinePhoto(photoId) {
  if (!photoId) return;
  await runTx("photos", "readwrite", (s) => s.delete(photoId));
}
