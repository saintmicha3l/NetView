import {schema} from "./schema.js";
import {lookup, validate} from "./workspace-model.js";

const location = new URL(".", import.meta.url);
const databaseName = `netview:${location.pathname}`;
let opening;

function error(message, status) {
  return Object.assign(new Error(message), {status});
}

function openDatabase() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore("workspace");
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Close the other NetView tabs and retry."));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
    }).catch(cause => {
      opening = null;
      throw cause;
    });
  }
  return opening;
}

async function transaction(mode, change) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", mode);
    const store = tx.objectStore("workspace");
    const request = store.get("main");
    let result;
    let failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error("The browser could not write the workspace."));
    request.onsuccess = () => {
      try {
        result = change(store, request.result);
      } catch (cause) {
        failure = cause;
        tx.abort();
      }
    };
  });
}

export async function readWorkspace() {
  const saved = await transaction("readonly", (_, current) => current);
  if (saved) return saved;
  const response = await fetch(new URL("demo.json", location));
  if (!response.ok) throw new Error("The starter workspace could not be loaded.");
  const initial = {revision: 1, workspace: validate(await response.json())};
  return transaction("readwrite", (store, current) => {
    if (current) return current;
    store.put(initial, "main");
    return initial;
  });
}

export async function writeWorkspace(revision, workspace) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision === Number.MAX_SAFE_INTEGER) {
    throw error("A valid workspace revision is required.", 400);
  }
  const next = {revision: revision + 1, workspace: validate(workspace)};
  const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
  if (bytes > schema.maxWorkspaceBytes) throw error("The workspace exceeds the 8 MiB workspace size limit.", 400);
  return transaction("readwrite", (store, current) => {
    if (current?.revision !== revision) {
      throw error("Another tab saved changes first. Reload before editing again.", 409);
    }
    store.put(next, "main");
    return next;
  });
}

export async function lookupRoute(revision, {device, destination, vrf}) {
  const saved = await readWorkspace();
  if (revision !== saved.revision) throw error("The workspace changed. Reload before looking up routes.", 409);
  return lookup(saved.workspace, device, destination, vrf);
}
