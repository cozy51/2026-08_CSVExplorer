import type { DataRow } from '../models/dataset';

const DATABASE_NAME = 'csv-explorer';
const STORE_NAME = 'rows';
const VERSION = 1;

interface StoredRow {
  datasetId: string;
  index: number;
  row: DataRow;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: ['datasetId', 'index'] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function replaceDatasetRows(datasetId: string, rows: DataRow[]): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const range = IDBKeyRange.bound([datasetId, 0], [datasetId, Number.MAX_SAFE_INTEGER]);
  store.delete(range);
  rows.forEach((row, index) => store.put({ datasetId, index, row } satisfies StoredRow));
  await transactionDone(transaction);
  database.close();
}

export async function readDatasetRows(
  datasetId: string,
  start: number,
  count: number,
): Promise<StoredRow[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const store = transaction.objectStore(STORE_NAME);
  const range = IDBKeyRange.bound(
    [datasetId, start],
    [datasetId, Math.max(start, start + count - 1)],
  );
  const request = store.getAll(range, count);
  const result = await new Promise<StoredRow[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as StoredRow[]);
    request.onerror = () => reject(request.error);
  });
  await transactionDone(transaction);
  database.close();
  return result;
}
