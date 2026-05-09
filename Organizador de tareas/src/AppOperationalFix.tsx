import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import AppSecure from './AppSecure';
import { auth, db } from './lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, doc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { CheckCircle2, Clock3, Search, ShieldCheck, UserCheck, Users, X } from 'lucide-react';
import { GlassPanel } from './components/ui/GlassPanel';
import { Logo } from './components/ui/Logo';
import { PremiumButton } from './components/ui/PremiumButton';

const RECORDS_COLLECTION = 'tasks';
const MAX_IMPORT_ROWS = 5000;
const BATCH_LIMIT = 450;

type WorkshopRow = { id: string; kind: 'gemb_workshop'; name: string; isArchived?: boolean };
type AttendeeRow = {
  id: string;
  kind: 'gemb_attendee';
  workshopId: string;
  name: string;
  email?: string;
  phone?: string;
  documentId?: string;
  notes?: string;
  paid?: boolean;
  amount?: number;
  attended?: boolean;
  checkInTime?: number | null;
  registrationSource?: string;
};
type ImportRow = { name: string; email: string; phone: string; documentId: string; notes: string };

type ColumnMap = { name: number; email: number; phone: number; document: number; ignored: Set<number> };

const nowIso = () => new Date().toISOString();
const clean = (value: unknown, max = 300) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const cleanName = (value: unknown) => clean(value, 140).toUpperCase();
const norm = (value: unknown) => cleanName(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const normHeader = (value: unknown) => norm(value).replace(/[^a-z0-9@$\s]/g, ' ').replace(/\s+/g, ' ').trim();
const looksEmail = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(clean(value, 160));
const digits = (value: unknown) => clean(value).replace(/\D/g, '');
const looksPhone = (value: unknown) => digits(value).length >= 7 && digits(value).length <= 15;
const looksDocument = (value: unknown) => digits(value).length >= 5 && digits(value).length <= 13;
const timeText = (value?: number | null) => value ? new Date(value).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '--:--';

function chunk<T>(items: T[], size = BATCH_LIMIT) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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

function detectDelimiter(text: string) {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
  let comma = 0;
  let semicolon = 0;
  let quoted = false;
  for (let i = 0; i < first.length; i += 1) {
    if (first[i] === '"') quoted = !quoted;
    if (!quoted && first[i] === ',') comma += 1;
    if (!quoted && first[i] === ';') semicolon += 1;
  }
  return semicolon > comma ? ';' : ',';
}

function parseCsv(text: string) {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '"' && next === '"') {
      field += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function samples(rows: string[][], index: number) {
  return rows.slice(1, 30).map((row) => clean(row[index], 180)).filter(Boolean);
}

function best(headers: string[], rows: string[][], score: (header: string, sample: string[]) => number) {
  let index = -1;
  let bestScore = 0;
  headers.forEach((header, i) => {
    const current = score(header, samples(rows, i));
    if (current > bestScore) {
      bestScore = current;
      index = i;
    }
  });
  return index;
}

function mapColumns(rawHeaders: string[], rows: string[][]): ColumnMap {
  const headers = rawHeaders.map(normHeader);
  const email = best(headers, rows, (h, s) => (h.includes('correo') || h.includes('email') || h.includes('mail') || h.includes('usuario') ? 80 : 0) + s.filter(looksEmail).length * 25);
  const phone = best(headers, rows, (h, s) => (h.includes('whatsapp') ? 120 : h.includes('telefono') || h.includes('celular') || h.includes('contacto') ? 90 : 0) + s.filter(looksPhone).length * 8 - (h.includes('documento') || h.includes('cedula') ? 80 : 0));
  const document = best(headers, rows, (h, s) => (h.includes('documento') || h.includes('cedula') || h.includes('identificacion') ? 110 : 0) + s.filter(looksDocument).length * 6 - (h.includes('whatsapp') || h.includes('telefono') || h.includes('celular') ? 80 : 0));
  const name = best(headers, rows, (h, s) => {
    let points = 0;
    if (h.includes('nombre completo')) points += 170;
    if (h.includes('nombre y apellido') || h.includes('nombres y apellidos')) points += 160;
    if (h === 'nombre' || h.includes('tu nombre') || h.includes('su nombre')) points += 95;
    if (h.includes('participante') || h.includes('asistente')) points += 70;
    if (h.includes('nombre de usuario') || h === 'usuario' || h.includes('correo') || h.includes('email') || h.includes('mail')) points -= 180;
    if (h.includes('documento') || h.includes('cedula') || h.includes('telefono') || h.includes('whatsapp')) points -= 130;
    s.forEach((v) => {
      if (looksEmail(v) || looksPhone(v)) points -= 45;
      if (/\s/.test(v)) points += 8;
      if (v.split(/\s+/).length >= 2) points += 8;
      if (/[a-zA-ZÁÉÍÓÚÜÑáéíóúüñ]/.test(v)) points += 5;
    });
    return points;
  });
  return { name: name >= 0 ? name : 0, email, phone, document, ignored: new Set([name, email, phone, document].filter((i) => i >= 0)) };
}

function buildNotes(headers: string[], row: string[], map: ColumnMap) {
  return headers
    .map((h, i) => ({ h: clean(h, 120), v: clean(row[i], 250), i }))
    .filter((item) => item.v && !map.ignored.has(item.i))
    .map((item) => `${item.h}: ${item.v}`)
    .join(' | ')
    .slice(0, 900);
}

function validate(row: ImportRow) {
  if (!row.name || row.name.length < 2) return 'Nombre vacío.';
  if (looksEmail(row.name)) return 'El nombre fue detectado como correo.';
  if (row.email && !looksEmail(row.email)) return 'Correo inválido.';
  return null;
}

async function getOrCreateWorkshop(workshopName: string, userId: string) {
  const name = cleanName(workshopName);
  const snapshot = await getDocs(query(collection(db, RECORDS_COLLECTION), where('kind', '==', 'gemb_workshop')));
  const existing = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() } as WorkshopRow))
    .find((item) => !item.isArchived && norm(item.name) === norm(name));
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
  return { id: ref.id, kind: 'gemb_workshop', name, isArchived: false } as WorkshopRow;
}

async function importSmartCsv(file: File, workshopName: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('Primero inicia sesión para importar asistentes.');
  if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('Solo se permite CSV descargado desde Google Forms o Google Sheets.');

  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error('El CSV no tiene filas suficientes.');
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`El archivo supera el máximo de ${MAX_IMPORT_ROWS} filas.`);

  const headers = rows[0].map(String);
  const map = mapColumns(headers, rows);
  const workshop = await getOrCreateWorkshop(workshopName, user.uid);
  const existingSnapshot = await getDocs(query(collection(db, RECORDS_COLLECTION), where('kind', '==', 'gemb_attendee')));
  const existing = new Set(
    existingSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() } as AttendeeRow))
      .filter((item) => item.workshopId === workshop.id)
      .map((item) => norm(item.name)),
  );

  const imported: ImportRow[] = [];
  let invalid = 0;
  let duplicates = 0;

  rows.slice(1).forEach((row) => {
    const email = map.email >= 0 ? clean(row[map.email], 120).toLowerCase() : '';
    const item: ImportRow = {
      name: cleanName(row[map.name]),
      email: looksEmail(email) ? email : '',
      phone: map.phone >= 0 ? clean(row[map.phone], 40) : '',
      documentId: map.document >= 0 ? clean(row[map.document], 40) : '',
      notes: buildNotes(headers, row, map),
    };
    if (validate(item)) {
      invalid += 1;
      return;
    }
    const key = norm(item.name);
    if (existing.has(key)) {
      duplicates += 1;
      return;
    }
    existing.add(key);
    imported.push(item);
  });

  if (!imported.length) throw new Error(`No hay registros nuevos. Inválidos: ${invalid}. Duplicados: ${duplicates}.`);
  const preview = imported.slice(0, 7).map((item) => `• ${item.name}${item.email ? ` (${item.email})` : ''}`).join('\n');
  const ok = window.confirm(`Vista previa inteligente\n\nTaller: ${workshop.name}\nNuevos: ${imported.length}\nDuplicados omitidos: ${duplicates}\nInválidos omitidos: ${invalid}\n\nPagos: siempre PENDIENTE\nValor: siempre 0\n\nPrimeros detectados:\n${preview}\n\n¿Importar ahora?`);
  if (!ok) return 'Importación cancelada.';

  for (const group of chunk(imported)) {
    const batch = writeBatch(db);
    group.forEach((item) => {
      const ref = doc(collection(db, RECORDS_COLLECTION));
      batch.set(ref, {
        ...legacyTaskShape(`ASISTENTE: ${item.name}`, user.uid),
        kind: 'gemb_attendee',
        workshopId: workshop.id,
        ...item,
        paid: false,
        amount: 0,
        attended: false,
        checkInTime: null,
        registrationSource: 'google-forms-csv-smart-v3',
      });
    });
    await batch.commit();
  }
  return `Importación lista. Agregados: ${imported.length}. Duplicados: ${duplicates}. Inválidos: ${invalid}. Pagos pendientes y valor 0.`;
}

function ArrivalModal({ open, onClose, rows, workshops }: { open: boolean; onClose: () => void; rows: AttendeeRow[]; workshops: WorkshopRow[] }) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const workshopById = useMemo(() => new Map(workshops.map((item) => [item.id, item.name])), [workshops]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((item) => !term || [item.name, item.email, item.phone, item.documentId, workshopById.get(item.workshopId)].some((value) => String(value || '').toLowerCase().includes(term)))
      .sort((a, b) => {
        const aa = Boolean(a.attended && a.checkInTime);
        const bb = Boolean(b.attended && b.checkInTime);
        if (aa && bb) return Number(a.checkInTime) - Number(b.checkInTime);
        if (aa) return -1;
        if (bb) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [rows, search, workshopById]);
  const arrived = rows.filter((item) => item.attended).length;

  const toggle = async (item: AttendeeRow) => {
    const next = !item.attended;
    try {
      setBusy(item.id);
      await updateDoc(doc(db, RECORDS_COLLECTION, item.id), { attended: next, checkInTime: next ? Date.now() : null, updatedAt: nowIso() });
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;
  return (
    <div className="luxury-bg fixed inset-0 z-[9998] overflow-y-auto p-4 text-white backdrop-blur-xl">
      <div className="luxury-grid" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl">
        <GlassPanel className="mb-5" tone="cyan">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4">
              <div className="hidden rounded-lg border border-cyan-200/18 bg-black/24 p-2 sm:block">
                <Logo variant="symbol" className="h-20 w-28" />
              </div>
              <div>
              <p className="text-sm font-black uppercase text-cyan-100">Modo portería</p>
              <h2 className="mt-2 text-3xl font-black">Orden de llegada real</h2>
              <p className="mt-1 text-sm text-slate-300">Busca asistentes, marca entrada en vivo y conserva el orden por hora.</p>
              </div>
            </div>
            <PremiumButton onClick={onClose} icon={<X size={17} />} variant="ghost" size="lg">Cerrar</PremiumButton>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-black/24 p-4"><p className="flex items-center gap-2 text-xs font-bold text-slate-400"><Users size={15} /> Inscritos</p><p className="mt-2 text-3xl font-black">{rows.length}</p></div>
            <div className="rounded-lg border border-cyan-300/22 bg-cyan-400/10 p-4"><p className="flex items-center gap-2 text-xs font-bold text-cyan-100"><UserCheck size={15} /> En sala</p><p className="mt-2 text-3xl font-black">{arrived}</p></div>
            <div className="rounded-lg border border-amber-300/22 bg-amber-300/10 p-4"><p className="flex items-center gap-2 text-xs font-bold text-amber-100"><Clock3 size={15} /> Pendientes</p><p className="mt-2 text-3xl font-black">{Math.max(rows.length - arrived, 0)}</p></div>
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, correo, celular, documento o taller" className="premium-input py-4 pl-12 pr-4 text-sm font-semibold" autoFocus />
          </div>
        </GlassPanel>
        <div className="space-y-3 pb-8">
          {filtered.map((item) => {
            const position = item.attended && item.checkInTime ? rows.filter((r) => r.attended && r.checkInTime && Number(r.checkInTime) <= Number(item.checkInTime)).length : null;
            return (
              <div key={item.id} className={`grid gap-3 rounded-lg border p-4 shadow-[0_16px_44px_rgba(0,0,0,0.22)] backdrop-blur-2xl md:grid-cols-[72px_1fr_auto] md:items-center ${item.attended ? 'border-cyan-300/25 bg-cyan-400/10' : 'border-white/10 bg-white/[0.052]'}`}>
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-xl font-black text-cyan-100">{position || '--'}</div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-black uppercase">{item.name}</p>
                  <p className="mt-1 truncate text-xs font-bold uppercase text-slate-400">{workshopById.get(item.workshopId) || 'SIN TALLER'} · {item.email || item.phone || 'sin contacto'}</p>
                  <p className="mt-1 text-xs text-slate-400">Hora: {timeText(item.checkInTime)}</p>
                </div>
                <PremiumButton disabled={busy === item.id} onClick={() => toggle(item)} icon={busy === item.id ? <Clock3 size={16} /> : item.attended ? <X size={16} /> : <CheckCircle2 size={16} />} variant={item.attended ? 'danger' : 'cyan'} size="lg">
                  {busy === item.id ? 'Guardando...' : item.attended ? 'Retirar' : 'Marcar llegada'}
                </PremiumButton>
              </div>
            );
          })}
          {!filtered.length && (
            <GlassPanel className="text-center" tone="cyan">
              <ShieldCheck className="mx-auto text-cyan-100" size={42} />
              <p className="mt-4 text-lg font-black text-white">No hay asistentes para mostrar.</p>
              <p className="mt-2 text-sm text-slate-400">Ajusta la búsqueda o importa la lista del taller.</p>
            </GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AppOperationalFix() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWorkshopName = useRef('');
  const [importing, setImporting] = useState(false);
  const [arrivalOpen, setArrivalOpen] = useState(false);
  const [workshops, setWorkshops] = useState<WorkshopRow[]>([]);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);

  useEffect(() => {
    let unsubscribeRecords: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeRecords?.();
      if (!user) {
        setWorkshops([]);
        setAttendees([]);
        return;
      }

      unsubscribeRecords = onSnapshot(query(collection(db, RECORDS_COLLECTION), where('kind', 'in', ['gemb_workshop', 'gemb_attendee'])), (snapshot) => {
        const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        setWorkshops(rows.filter((item) => item.kind === 'gemb_workshop') as WorkshopRow[]);
        setAttendees(rows.filter((item) => item.kind === 'gemb_attendee') as AttendeeRow[]);
      });
    });

    return () => {
      unsubscribeRecords?.();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    const wrong = attendees.filter((item) => Number(item.amount || 0) !== 0);
    if (!wrong.length) return;
    const run = async () => {
      for (const group of chunk(wrong)) {
        const batch = writeBatch(db);
        group.forEach((item) => {
          const imported = String(item.registrationSource || '').startsWith('google-forms-csv');
          batch.update(doc(db, RECORDS_COLLECTION, item.id), { amount: 0, ...(imported ? { paid: false } : {}), updatedAt: nowIso() });
        });
        await batch.commit();
      }
    };
    run().catch((error) => console.error('No se pudieron normalizar valores', error));
  }, [attendees]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      const text = button?.textContent || '';
      if (text.includes('ORDEN DE LLEGADA') || text.includes('Orden de llegada')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setArrivalOpen(true);
        return;
      }
      if (!text.includes('Google Forms CSV') && !text.includes('Importar CSV')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const name = window.prompt('Escribe el nombre exacto del taller para cargar este CSV. Si no existe, lo crearé automáticamente.');
      const workshopName = cleanName(name || '');
      if (!workshopName) return;
      pendingWorkshopName.current = workshopName;
      fileInputRef.current?.click();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const onFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      setImporting(true);
      const message = await importSmartCsv(file, pendingWorkshopName.current);
      window.alert(message);
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Ocurrió un error inesperado importando el CSV.');
    } finally {
      setImporting(false);
      pendingWorkshopName.current = '';
    }
  };

  return (
    <>
      <AppSecure />
      <ArrivalModal open={arrivalOpen} onClose={() => setArrivalOpen(false)} rows={attendees} workshops={workshops} />
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileSelected} />
      {importing && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/72 p-4 text-white backdrop-blur-sm">
          <GlassPanel tone="gold" className="max-w-sm text-center">
            <Logo variant="symbol" className="mx-auto h-24 w-40" />
            <p className="mt-4 text-lg font-black">Importando CSV inteligente...</p>
            <p className="mt-2 text-sm text-slate-300">Nombre, correo, documento y WhatsApp. Pago pendiente y valor 0.</p>
          </GlassPanel>
        </div>
      )}
    </>
  );
}
