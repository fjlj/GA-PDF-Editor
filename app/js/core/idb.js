/**
 * idb.js — tiny IndexedDB key-value helper (vanilla, no deps).
 * Used for session tab list + FileSystemFileHandle persistence.
 */
(function (global) {
    "use strict";

    function openDb(dbName, version, storeName) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(dbName, version);
            req.onerror = () => reject(req.error || new Error("IDB open failed"));
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            };
            req.onsuccess = () => resolve(req.result);
        });
    }

    function txDone(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error("IDB transaction failed"));
            tx.onabort = () => reject(tx.error || new Error("IDB transaction aborted"));
        });
    }

    /**
     * @param {string} dbName
     * @param {number} version
     * @param {string} storeName
     */
    function createKv(dbName, version, storeName) {
        let dbPromise = null;
        const getDb = () => {
            if (!dbPromise) dbPromise = openDb(dbName, version, storeName);
            return dbPromise;
        };

        return {
            async get(key) {
                const db = await getDb();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(storeName, "readonly");
                    const req = tx.objectStore(storeName).get(key);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            },
            async set(key, value) {
                const db = await getDb();
                const tx = db.transaction(storeName, "readwrite");
                tx.objectStore(storeName).put(value, key);
                await txDone(tx);
            },
            async del(key) {
                const db = await getDb();
                const tx = db.transaction(storeName, "readwrite");
                tx.objectStore(storeName).delete(key);
                await txDone(tx);
            },
            async clear() {
                const db = await getDb();
                const tx = db.transaction(storeName, "readwrite");
                tx.objectStore(storeName).clear();
                await txDone(tx);
            }
        };
    }

    global.GaIdb = {
        createKv,
        /**
         * Default app session store (names from GA_CONFIG).
         */
        sessionStore() {
            const name = global.gaConfig ? global.gaConfig("sessionDbName", "ga-pdf-editor-session") : "ga-pdf-editor-session";
            const ver = global.gaConfig ? global.gaConfig("sessionDbVersion", 1) : 1;
            return createKv(name, ver, "kv");
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
