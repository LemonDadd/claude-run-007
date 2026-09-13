// IndexedDB 封装：设置、收藏字帖、数据块缓存
const DB_NAME = 'bishun-zitie';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode) {
  return open().then((db) => db.transaction(store, mode).objectStore(store));
}
function reqP(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function kvGet(key, fallback = null) {
  const v = await reqP((await tx('kv', 'readonly')).get(key));
  return v === undefined ? fallback : v;
}
export async function kvSet(key, value) {
  await reqP((await tx('kv', 'readwrite')).put(value, key));
}
export async function kvDel(key) {
  await reqP((await tx('kv', 'readwrite')).delete(key));
}

export async function cacheGetChunk(name) {
  const v = await reqP((await tx('chunks', 'readonly')).get(name));
  return v === undefined ? null : v;
}
export async function cacheSetChunk(name, data) {
  await reqP((await tx('chunks', 'readwrite')).put(data, name));
}
export async function cacheClear() {
  await reqP((await tx('chunks', 'readwrite')).clear());
}
export async function cacheSize() {
  return new Promise(async (resolve) => {
    let bytes = 0, count = 0;
    const store = await tx('chunks', 'readonly');
    const cur = store.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        count++;
        bytes += JSON.stringify(c.value).length;
        c.continue();
      } else resolve({ bytes, count });
    };
    cur.onerror = () => resolve({ bytes: 0, count: 0 });
  });
}
