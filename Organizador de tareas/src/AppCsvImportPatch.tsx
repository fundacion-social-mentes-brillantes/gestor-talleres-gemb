import { useEffect, useRef, useState } from 'react';
import AppSecure from './AppSecure';
import { auth, db } from './lib/firebase';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

const RECORDS_COLLECTION = 'tasks';
const BATCH_LIMIT = 450;
const MAX_IMPORT_ROWS = 5000;
const DEFAULT_PAYMENT_AMOUNT = 38000;

type WorkshopLite = {
  id: string;
  kind: 'gemb_workshop';
  name: string;
  isArchived?: boolean;
};

type AttendeeLite = {
  id: string;
  kind: 'gemb_attendee';
  workshopId: string;
  name: string;
};

type ImportRow = {
  name: string;
  email: string;
  phone: string;
  documentId: string;
  paid: boolean;
  amount: number;
  notes: string;
};

type ColumnMap = {
  nameIndex: number;
  emailIndex: number;
  phoneIndex: number;
  documentIndex: number;
  paidIndex: number;
  amountIndex: number;
  paymentAmountFromHeader: number;
  ignoredIndexes: Set<number>;
};

const nowIso = () => new Date().toISOString();
const cleanName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const normalize = (value: string) => cleanName(value).toLowerCase();
const safeText = (value: unknown, max = 300) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const phoneRegex = /^\+?\d[\d\s().-]{6,18}$/;

function chunk<T>(items: T[], size = BATCH_LIMIT) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function legacyTaskShape(title: string, userId?: string | null) {
  const now = nowIso();
  return {
    title,
    description: '',
    status: 'pending',
    priority: 'medium',
    createdBy: userId || '',
    assignees: userId ? [userId] : [],
    dueDate: null,
    category: 'Talleres GEMB',
    tags: ['gemb', 'talleres'],
    subtasks: [],
    notes: '',
    links: [],
    progress: 0,
    createdAt: now,
    updatedAt: now,
    serverCreatedAt: serverTimestamp(),
  };
}

function normalizeHeader(value: string) {
  return safeText(value, 250)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9@$\s]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function countDelimiter(line: string, delimiter: ',' | ';') {
  let count = 0;
  let insideQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === delimiter && !insideQuotes) {
      count += 1;
    }
  }
  return count;
}

function firstPhysicalLine(text: string) {
  const normalized = text.replace(/^\uFEFF/, '');
  const newlineIndex = normalized.search(/\r?\n/);
  return newlineIndex >= 0 ? normalized.slice(0, newlineIndex) : normalized;
}

function detectDelimiter(text: string): ',' | ';' {
  const headerLine = firstPhysicalLine(text);
  return countDelimiter(headerLine, ';') > countDelimiter(headerLine, ',') ? ';' : ',';
}

function parseCsv(text: string) {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let insideQuotes = false;
  const source = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"' && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === delimiter && !insideQuotes) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field.trim());
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function rowSamples(rows: string[][], index: number) {
  return rows.slice(1, 25).map((row) => safeText(row[index], 180)).filter(Boolean);
}

function findBestColumn(headers: string[], rows: string[][], scorer: (header: string, samples: string[]) => number) {
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  headers.forEach((header, index) => {
    const score = scorer(header, rowSamples(rows, index));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore > 0 ? bestIndex : -1;
}

function looksLikeEmail(value: string) {
  return emailRegex.test(value.trim());
}

function looksLikePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && phoneRegex.test(value.trim());
}

function looksLikeDocument(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 5 && digits.length <= 13 && /^\d+$/.test(digits);
}

function scoreNameColumn(header: string, samples: string[]) {
  let score = 0;
  if (header.includes('nombre completo')) score += 140;
  if (header.includes('nombre y apellido') || header.includes('nombres y apellidos')) score += 130;
  if (header.includes('nombre')) score += 70;
  if (header.includes('participante') || header.includes('asistente')) score += 45;
  if (header.includes('usuario') || header.includes('user') || header.includes('correo') || header.includes('email') || header.includes('mail')) score -= 120;
  if (header.includes('documento') || header.includes('cedula') || header.includes('telefono') || header.includes('whatsapp') || header.includes('contacto')) score -= 120;

  samples.forEach((sample) => {
    const value = sample.trim();
    if (!value) return;
    if (looksLikeEmail(value)) score -= 35;
    if (looksLikePhone(value) || looksLikeDocument(value)) score -= 25;
    if (/[a-zA-ZÁÉÍÓÚÜÑáéíóúüñ]/.test(value)) score += 6;
    if (/\s/.test(value)) score += 8;
    if (value.split(/\s+/).length >= 2) score += 10;
  });

  return score;
}

function scoreEmailColumn(header: string, samples: string[]) {
  let score = 0;
  if (header.includes('correo') || header.includes('email') || header.includes('mail')) score += 100;
  if (header.includes('nombre de usuario') || header === 'usuario' || header.includes('user')) score += 50;
  samples.forEach((sample) => {
    if (looksLikeEmail(sample)) score += 22;
  });
  return score;
}

function scorePhoneColumn(header: string, samples: string[]) {
  let score = 0;
  if (header.includes('whatsapp')) score += 120;
  if (header.includes('telefono') || header.includes('celular') || header.includes('contacto') || header.includes('phone')) score += 100;
  if (header.includes('documento') || header.includes('cedula')) score -= 80;
  samples.forEach((sample) => {
    if (looksLikePhone(sample)) score += 12;
  });
  return score;
}

function scoreDocumentColumn(header: string, samples: string[]) {
  let score = 0;
  if (header.includes('documento') || header.includes('cedula') || header.includes('identificacion') || header.includes('dni')) score += 120;
  if (header.includes('telefono') || header.includes('celular') || header.includes('whatsapp') || header.includes('contacto')) score -= 80;
  samples.forEach((sample) => {
    if (looksLikeDocument(sample)) score += 8;
  });
  return score;
}

function scorePaymentColumn(header: string, samples: string[]) {
  let score = 0;
  if (header.includes('aporte') || header.includes('pago') || header.includes('pagado') || header.includes('misional') || header.includes('voluntario') || header.includes('contribucion')) score += 130;
  if (header.includes('valor') || header.includes('monto')) score += 45;
  if (header.includes('traje') || header.includes('gala') || header.includes('alimento') || header.includes('bebida')) score -= 120;
  samples.forEach((sample) => {
    const value = normalizeHeader(sample);
    if (value.includes('aporte') || value.includes('gratitud') || value.includes('valor mayor') || value.includes('pag')) score += 8;
  });
  return score;
}

function scoreAmountColumn(header: string, samples: string[]) {
  let score = 0;
  if (header.includes('valor') || header.includes('monto') || header.includes('abono') || header.includes('precio')) score += 90;
  if (header.includes('aporte')) score += 20;
  samples.forEach((sample) => {
    if (parseAmount(sample) > 0) score += 10;
  });
  return score;
}

function parseAmount(value: string) {
  const cleaned = String(value || '').replace(/[^0-9,-]/g, '').replace(',', '.');
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount > 0 ? Math.min(amount, 50000000) : 0;
}

function parseAmountFromHeader(header: string) {
  const match = header.match(/\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,8})/);
  if (!match) return 0;
  const digits = match[1].replace(/\D/g, '');
  const amount = Number(digits);
  return Number.isFinite(amount) && amount >= 1000 ? amount : 0;
}

function isPaidValue(value: string) {
  const normalized = normalizeHeader(value);
  if (!normalized) return false;
  if (['no', 'n', 'false', '0', 'pendiente'].includes(normalized)) return false;
  if (normalized.includes('no deseo') || normalized.includes('no puedo') || normalized.includes('pendiente')) return false;
  return ['pagado', 'pago', 'si', 'sí', 'yes', 'true', '1', 'abono', 'abonado', 'aporte', 'gratitud', 'valor mayor', 'aportare', 'aportar'].some((word) => normalized.includes(normalizeHeader(word)));
}

function buildColumnMap(headersRaw: string[], rows: string[][]): ColumnMap {
  const headers = headersRaw.map(normalizeHeader);
  const nameIndex = findBestColumn(headers, rows, scoreNameColumn);
  const emailIndex = findBestColumn(headers, rows, scoreEmailColumn);
  const phoneIndex = findBestColumn(headers, rows, scorePhoneColumn);
  const documentIndex = findBestColumn(headers, rows, scoreDocumentColumn);
  const paidIndex = findBestColumn(headers, rows, scorePaymentColumn);
  const amountIndex = findBestColumn(headers, rows, scoreAmountColumn);
  const paymentAmountFromHeader = paidIndex >= 0 ? parseAmountFromHeader(headersRaw[paidIndex]) : 0;
  const ignoredIndexes = new Set([nameIndex, emailIndex, phoneIndex, documentIndex, paidIndex, amountIndex].filter((index) => index >= 0));

  return {
    nameIndex: nameIndex >= 0 ? nameIndex : 0,
    emailIndex,
    phoneIndex,
    documentIndex,
    paidIndex,
    amountIndex,
    paymentAmountFromHeader,
    ignoredIndexes,
  };
}

function buildNotes(headersRaw: string[], row: string[], map: ColumnMap) {
  return headersRaw
    .map((header, index) => ({ header: safeText(header, 120), value: safeText(row[index], 250), index }))
    .filter((item) => item.value && !map.ignoredIndexes.has(item.index))
    .map((item) => `${item.header}: ${item.value}`)
    .join(' | ')
    .slice(0, 900);
}

function validateRow(row: ImportRow) {
  if (!row.name || row.name.length < 2) return 'Nombre vacío o demasiado corto.';
  if (row.name.length > 120) return 'Nombre demasiado largo.';
  if (looksLikeEmail(row.name)) return 'El nombre fue detectado como correo. Revisa encabezados del CSV.';
  if (row.email && !emailRegex.test(row.email)) return 'Correo inválido.';
  if (row.amount < 0 || row.amount > 50000000) return 'Valor de pago fuera de rango.';
  return null;
}

async function getOrCreateWorkshop(workshopName: string, userId: string) {
  const name = cleanName(workshopName);
  const workshopsSnapshot = await getDocs(query(collection(db, RECORDS_COLLECTION), where('kind', '==', 'gemb_workshop')));
  const existing = workshopsSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() } as WorkshopLite))
    .find((workshop) => !workshop.isArchived && normalize(workshop.name) === normalize(name));

  if (existing) return existing;

  const ref = await addDoc(collection(db, RECORDS_COLLECTION), {
    ...legacyTaskShape(`TALLER: ${name}`, userId),
    kind: 'gemb_workshop',
    name,
    date: '',
    time: '',
    location: '',
    modality: 'Presencial',
    basePrice: 0,
    capacity: 0,
    notes: '',
    isArchived: false,
  });

  return { id: ref.id, kind: 'gemb_workshop', name, isArchived: false } as WorkshopLite;
}

async function importCsvIntoWorkshop(file: File, workshopName: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('Primero inicia sesión para importar asistentes.');
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new Error('La importación acepta solo archivos CSV. En Google Sheets usa: Archivo > Descargar > Valores separados por comas (.csv).');
  }

  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error('El CSV no tiene suficientes filas para importar.');
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`El archivo tiene demasiadas filas. Máximo permitido: ${MAX_IMPORT_ROWS}.`);

  const headersRaw = rows[0].map((header) => String(header || ''));
  const columnMap = buildColumnMap(headersRaw, rows);
  const workshop = await getOrCreateWorkshop(workshopName, user.uid);

  const attendeesSnapshot = await getDocs(query(collection(db, RECORDS_COLLECTION), where('kind', '==', 'gemb_attendee')));
  const existing = new Set(
    attendeesSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() } as AttendeeLite))
      .filter((attendee) => attendee.workshopId === workshop.id)
      .map((attendee) => normalize(attendee.name)),
  );

  const imported: ImportRow[] = [];
  let invalid = 0;
  let duplicates = 0;

  rows.slice(1).forEach((row) => {
    const paid = columnMap.paidIndex >= 0 ? isPaidValue(String(row[columnMap.paidIndex] || '')) : false;
    const explicitAmount = columnMap.amountIndex >= 0 ? parseAmount(String(row[columnMap.amountIndex] || '')) : 0;
    const amount = explicitAmount || (paid ? columnMap.paymentAmountFromHeader || DEFAULT_PAYMENT_AMOUNT : 0);
    const email = columnMap.emailIndex >= 0 ? safeText(row[columnMap.emailIndex], 120).toLowerCase() : '';

    const item: ImportRow = {
      name: cleanName(String(row[columnMap.nameIndex] || '')),
      email: looksLikeEmail(email) ? email : '',
      phone: columnMap.phoneIndex >= 0 ? safeText(row[columnMap.phoneIndex], 40) : '',
      documentId: columnMap.documentIndex >= 0 ? safeText(row[columnMap.documentIndex], 40) : '',
      paid,
      amount,
      notes: buildNotes(headersRaw, row, columnMap),
    };

    if (validateRow(item)) {
      invalid += 1;
      return;
    }

    const duplicateKey = normalize(item.name);
    if (existing.has(duplicateKey)) {
      duplicates += 1;
      return;
    }

    existing.add(duplicateKey);
    imported.push(item);
  });

  if (!imported.length) throw new Error(`No hay registros nuevos para importar. Inválidos: ${invalid}. Duplicados: ${duplicates}.`);

  const previewNames = imported.slice(0, 5).map((item) => `• ${item.name}${item.email ? ` (${item.email})` : ''}`).join('\n');
  const confirmed = window.confirm(
    `Vista previa de importación inteligente\n\nTaller: ${workshop.name}\nNuevos: ${imported.length}\nDuplicados omitidos: ${duplicates}\nInválidos omitidos: ${invalid}\n\nPrimeros detectados:\n${previewNames}\n\n¿Importar ahora?`,
  );
  if (!confirmed) return 'Importación cancelada.';

  for (const group of chunk(imported)) {
    const batch = writeBatch(db);
    group.forEach((row) => {
      const ref = doc(collection(db, RECORDS_COLLECTION));
      batch.set(ref, {
        ...legacyTaskShape(`ASISTENTE: ${row.name}`, user.uid),
        kind: 'gemb_attendee',
        workshopId: workshop.id,
        ...row,
        registrationSource: 'google-forms-csv-smart',
        attended: false,
        checkInTime: null,
      });
    });
    await batch.commit();
  }

  return `Importación terminada en ${workshop.name}. Agregados: ${imported.length}. Duplicados: ${duplicates}. Inválidos: ${invalid}.`;
}

export default function AppCsvImportPatch() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWorkshopNameRef = useRef('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const onClickCapture = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      const text = button?.textContent || '';
      if (!text.includes('Google Forms CSV') && !text.includes('Importar CSV')) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const workshopName = window.prompt('Escribe el nombre exacto del taller para cargar este CSV. Si no existe, lo crearé automáticamente.');
      const cleanWorkshopName = cleanName(workshopName || '');
      if (!cleanWorkshopName) return;

      pendingWorkshopNameRef.current = cleanWorkshopName;
      fileInputRef.current?.click();
    };

    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, []);

  const onFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    try {
      setImporting(true);
      const message = await importCsvIntoWorkshop(file, pendingWorkshopNameRef.current);
      window.alert(message);
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Ocurrió un error inesperado importando el CSV.');
    } finally {
      setImporting(false);
      pendingWorkshopNameRef.current = '';
    }
  };

  return (
    <>
      <AppSecure />
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileSelected} />
      {importing && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 text-white backdrop-blur-sm">
          <div className="rounded-3xl border border-orange-400/30 bg-slate-950 p-6 text-center shadow-2xl">
            <p className="text-lg font-black">Importando CSV inteligente...</p>
            <p className="mt-2 text-sm text-slate-300">Detectando nombre, correo, documento, WhatsApp y aporte.</p>
          </div>
        </div>
      )}
    </>
  );
}
