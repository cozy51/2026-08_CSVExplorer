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

export async function findNearestRowByValue(
  datasetId: string,
  rowCount: number,
  columnId: string,
  target: number,
): Promise<StoredRow | undefined> {
  if (rowCount <= 0) return undefined;
  const readOne = async (index: number) => (await readDatasetRows(datasetId, index, 1))[0];
  const first = await readOne(0);
  const last = await readOne(rowCount - 1);
  if (!first || !last) return undefined;
  const firstValue = Number(first.row[columnId]);
  const lastValue = Number(last.row[columnId]);
  if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue)) return undefined;
  const ascending = lastValue >= firstValue;
  let low = 0;
  let high = rowCount - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const record = await readOne(middle);
    const value = Number(record?.row[columnId]);
    if (!record || !Number.isFinite(value)) return undefined;
    if (value === target) return record;
    if ((ascending && value < target) || (!ascending && value > target)) low = middle + 1;
    else high = middle - 1;
  }
  const candidates = await Promise.all(
    [...new Set([Math.max(0, high), Math.min(rowCount - 1, low)])].map(readOne),
  );
  return candidates.filter((record): record is StoredRow => Boolean(record)).sort((left, right) => (
    Math.abs(Number(left.row[columnId]) - target) - Math.abs(Number(right.row[columnId]) - target)
  ))[0];
}
