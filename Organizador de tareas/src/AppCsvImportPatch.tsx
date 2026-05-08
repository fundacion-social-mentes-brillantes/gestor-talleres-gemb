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

const nowIso = () => new Date().toISOString();
const cleanName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const normalize = (value: string) => cleanName(value).toLowerCase();
const safeText = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);

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

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if ((char === ',' || char === ';') && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function parseCsv(text: string) {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

function findColumn(headers: string[], keys: string[]) {
  return headers.findIndex((header) => keys.some((key) => header.includes(key)));
}

function isPaidValue(value: string) {
  const normalized = normalize(value);
  return ['pagado', 'pago', 'si', 'sí', 'yes', 'true', '1', 'abono', 'abonado'].some((word) => normalized.includes(word));
}

function parseAmount(value: string) {
  const cleaned = String(value || '').replace(/[^0-9,-]/g, '').replace(',', '.');
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount > 0 ? Math.min(amount, 50000000) : 0;
}

function validateRow(row: ImportRow) {
  if (!row.name || row.name.length < 2) return 'Nombre vacío o demasiado corto.';
  if (row.name.length > 120) return 'Nombre demasiado largo.';
  if (row.email && !/^\S+@\S+\.\S+$/.test(row.email)) return 'Correo inválido.';
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

  const workshop = await getOrCreateWorkshop(workshopName, user.uid);
  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error('El CSV no tiene suficientes filas para importar.');
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`El archivo tiene demasiadas filas. Máximo permitido: ${MAX_IMPORT_ROWS}.`);

  const headers = rows[0].map((header) => String(header || '').toLowerCase());
  let nameIndex = findColumn(headers, ['nombre', 'name', 'participante', 'asistente']);
  if (nameIndex < 0) nameIndex = 0;
  const emailIndex = findColumn(headers, ['correo', 'email', 'mail']);
  const phoneIndex = findColumn(headers, ['celular', 'telefono', 'teléfono', 'whatsapp', 'phone']);
  const documentIndex = findColumn(headers, ['documento', 'cedula', 'cédula', 'identificacion', 'identificación']);
  const paidIndex = findColumn(headers, ['pago', 'pagado', 'estado']);
  const amountIndex = findColumn(headers, ['valor', 'monto', 'abono', 'pagado']);
  const notesIndex = findColumn(headers, ['observacion', 'observación', 'notas', 'comentario']);

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
    const item: ImportRow = {
      name: cleanName(String(row[nameIndex] || '')),
      email: emailIndex >= 0 ? safeText(row[emailIndex], 120) : '',
      phone: phoneIndex >= 0 ? safeText(row[phoneIndex], 40) : '',
      documentId: documentIndex >= 0 ? safeText(row[documentIndex], 40) : '',
      paid: paidIndex >= 0 ? isPaidValue(String(row[paidIndex] || '')) : false,
      amount: amountIndex >= 0 ? parseAmount(String(row[amountIndex] || '')) : 0,
      notes: notesIndex >= 0 ? safeText(row[notesIndex], 500) : '',
    };

    if (validateRow(item)) {
      invalid += 1;
      return;
    }

    if (existing.has(normalize(item.name))) {
      duplicates += 1;
      return;
    }

    existing.add(normalize(item.name));
    imported.push(item);
  });

  if (!imported.length) throw new Error(`No hay registros nuevos para importar. Inválidos: ${invalid}. Duplicados: ${duplicates}.`);

  const confirmed = window.confirm(
    `Vista previa de importación\n\nTaller: ${workshop.name}\nNuevos: ${imported.length}\nDuplicados omitidos: ${duplicates}\nInválidos omitidos: ${invalid}\n\n¿Importar ahora?`,
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
        registrationSource: 'google-forms-csv',
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
      if (!button?.textContent?.includes('Google Forms CSV')) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const workshopName = window.prompt('Escribe el nombre del taller para cargar este CSV. Si no existe, lo crearé automáticamente.');
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
            <p className="text-lg font-black">Importando CSV...</p>
            <p className="mt-2 text-sm text-slate-300">No cierres esta ventana.</p>
          </div>
        </div>
      )}
    </>
  );
}
