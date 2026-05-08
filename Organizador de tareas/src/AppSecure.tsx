import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { db } from './lib/firebase';
import type { Attendee, GembRecord, ImportAttendeeInput, Workshop } from './types/gemb';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Flame,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  Search,
  Trash2,
  Upload,
  UserRoundCheck,
  UserRoundX,
  Users,
  Wallet,
} from 'lucide-react';

type View = 'dashboard' | 'workshop' | 'arrival';
type Filter = 'all' | 'paid' | 'unpaid' | 'present' | 'absent';
type Notice = { type: 'success' | 'error' | 'info'; message: string } | null;

type AttendeeWithWorkshop = Attendee & { workshopName: string };

const RECORDS_COLLECTION = 'tasks';
const BATCH_LIMIT = 450;
const MAX_IMPORT_ROWS = 5000;
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

const nowIso = () => new Date().toISOString();
const cleanName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const normalize = (value: string) => cleanName(value).toLowerCase();
const getTime = (value: number | null) => value ? new Date(value).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '--:--';
const safeText = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);
const getPct = (part: number, total: number) => total ? Math.round((part / total) * 100) : 0;

function Toast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;
  const tone = notice.type === 'success' ? 'border-emerald-400/30 bg-emerald-950/90 text-emerald-50' : notice.type === 'error' ? 'border-red-400/30 bg-red-950/90 text-red-50' : 'border-cyan-400/30 bg-cyan-950/90 text-cyan-50';
  return (
    <div className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border px-5 py-4 text-sm shadow-2xl backdrop-blur ${tone}`}>
      <p className="font-black">{notice.type === 'success' ? 'Listo' : notice.type === 'error' ? 'Error' : 'Aviso'}</p>
      <p className="mt-1 opacity-90">{notice.message}</p>
      <button type="button" onClick={onClose} className="mt-3 text-xs font-black underline decoration-white/30">Cerrar</button>
    </div>
  );
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

function validateAttendee(row: ImportAttendeeInput) {
  if (!row.name || row.name.length < 2) return 'Nombre vacío o demasiado corto.';
  if (row.name.length > 120) return 'Nombre demasiado largo.';
  if (row.email && !/^\S+@\S+\.\S+$/.test(row.email)) return 'Correo inválido.';
  if (row.amount < 0 || row.amount > 50000000) return 'Valor de pago fuera de rango.';
  return null;
}

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

function StatCard({ title, value, detail, icon }: { title: string; value: string | number; detail?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-[1.7rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{title}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-white">{value}</p>
          {detail && <p className="mt-2 text-xs font-semibold text-slate-400">{detail}</p>}
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-500/10 text-orange-200 shadow-xl shadow-orange-500/10">{icon}</div>
      </div>
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-orange-300/70 focus:bg-black/40 ${props.className || ''}`} />;
}

function AppContent() {
  const { user, loading, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeWorkshopId, setActiveWorkshopId] = useState<string | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [newWorkshopName, setNewWorkshopName] = useState('');
  const [workshopSearch, setWorkshopSearch] = useState('');
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');

  const runSafe = async (key: string, action: () => Promise<void>, successMessage?: string) => {
    try {
      setBusy(key);
      await action();
      if (successMessage) setNotice({ type: 'success', message: successMessage });
    } catch (err) {
      setNotice({ type: 'error', message: err instanceof Error ? err.message : 'Ocurrió un error inesperado.' });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!user) {
      setWorkshops([]);
      setAttendees([]);
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    const unsubscribe = onSnapshot(
      query(collection(db, RECORDS_COLLECTION), where('kind', 'in', ['gemb_workshop', 'gemb_attendee'])),
      (snapshot) => {
        const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as GembRecord[];
        setWorkshops(rows.filter((item): item is Workshop => item.kind === 'gemb_workshop').sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
        setAttendees(rows.filter((item): item is Attendee => item.kind === 'gemb_attendee'));
        setLoadingData(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoadingData(false);
      },
    );

    return () => unsubscribe();
  }, [user]);

  const activeWorkshop = useMemo(() => workshops.find((workshop) => workshop.id === activeWorkshopId) || null, [workshops, activeWorkshopId]);
  const activeAttendees = useMemo(() => attendees.filter((attendee) => attendee.workshopId === activeWorkshopId), [attendees, activeWorkshopId]);
  const activeWorkshops = useMemo(() => workshops.filter((workshop) => !workshop.isArchived), [workshops]);
  const workshopById = useMemo(() => new Map(workshops.map((workshop) => [workshop.id, workshop.name])), [workshops]);

  const filteredWorkshops = useMemo(() => {
    const search = workshopSearch.toLowerCase();
    return activeWorkshops.filter((workshop) => workshop.name.toLowerCase().includes(search));
  }, [activeWorkshops, workshopSearch]);

  const filteredAttendees = useMemo(() => {
    const search = attendeeSearch.trim().toLowerCase();
    let rows = [...activeAttendees];
    if (search) rows = rows.filter((attendee) => [attendee.name, attendee.email, attendee.phone, attendee.documentId].some((value) => String(value || '').toLowerCase().includes(search)));
    if (filter === 'paid') rows = rows.filter((attendee) => attendee.paid);
    if (filter === 'unpaid') rows = rows.filter((attendee) => !attendee.paid);
    if (filter === 'present') rows = rows.filter((attendee) => attendee.attended);
    if (filter === 'absent') rows = rows.filter((attendee) => !attendee.attended);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeAttendees, attendeeSearch, filter]);

  const globalResults = useMemo<AttendeeWithWorkshop[]>(() => {
    const search = globalSearch.trim().toLowerCase();
    if (!search) return [];
    return attendees
      .filter((attendee) => [attendee.name, attendee.email, attendee.phone, attendee.documentId].some((value) => String(value || '').toLowerCase().includes(search)))
      .slice(0, 15)
      .map((attendee) => ({ ...attendee, workshopName: workshopById.get(attendee.workshopId) || 'SIN TALLER' }));
  }, [attendees, globalSearch, workshopById]);

  const arrivalList = useMemo<AttendeeWithWorkshop[]>(() => {
    return attendees
      .filter((attendee) => attendee.attended && attendee.checkInTime)
      .map((attendee) => ({ ...attendee, workshopName: workshopById.get(attendee.workshopId) || 'SIN TALLER' }))
      .sort((a, b) => Number(a.checkInTime) - Number(b.checkInTime));
  }, [attendees, workshopById]);

  const stats = useMemo(() => {
    const scope = activeWorkshop ? activeAttendees : attendees;
    const present = scope.filter((attendee) => attendee.attended).length;
    const paid = scope.filter((attendee) => attendee.paid).length;
    return {
      attendees: scope.length,
      present,
      absent: Math.max(scope.length - present, 0),
      paid,
      pending: scope.filter((attendee) => !attendee.paid).length,
      collected: scope.reduce((sum, attendee) => sum + (attendee.paid ? Number(attendee.amount || 0) : 0), 0),
      attendancePct: getPct(present, scope.length),
    };
  }, [activeWorkshop, activeAttendees, attendees]);

  const createWorkshop = async () => {
    const name = cleanName(newWorkshopName);
    if (!name) return setNotice({ type: 'info', message: 'Escribe el nombre del taller.' });
    await runSafe('create-workshop', async () => {
      const ref = await addDoc(collection(db, RECORDS_COLLECTION), {
        ...legacyTaskShape(`TALLER: ${name}`, user?.uid),
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
      setNewWorkshopName('');
      setActiveWorkshopId(ref.id);
      setView('workshop');
    }, 'Taller creado correctamente.');
  };

  const updateWorkshop = async (id: string, updates: Partial<Workshop>) => {
    const title = updates.name ? `TALLER: ${updates.name}` : undefined;
    await updateDoc(doc(db, RECORDS_COLLECTION, id), { ...updates, ...(title ? { title } : {}), updatedAt: nowIso() });
  };

  const addAttendee = async () => {
    if (!activeWorkshop) return;
    await runSafe('add-attendee', async () => {
      await addDoc(collection(db, RECORDS_COLLECTION), {
        ...legacyTaskShape('ASISTENTE: NUEVO ASISTENTE', user?.uid),
        kind: 'gemb_attendee',
        workshopId: activeWorkshop.id,
        name: 'NUEVO ASISTENTE',
        email: '',
        phone: '',
        documentId: '',
        notes: '',
        registrationSource: 'manual',
        paid: false,
        amount: 0,
        attended: false,
        checkInTime: null,
      });
    }, 'Asistente creado.');
  };

  const updateAttendee = async (id: string, updates: Partial<Attendee>) => {
    const title = updates.name ? `ASISTENTE: ${updates.name}` : undefined;
    await updateDoc(doc(db, RECORDS_COLLECTION, id), { ...updates, ...(title ? { title } : {}), updatedAt: nowIso() });
  };

  const saveAttendeeName = async (attendee: Attendee) => {
    const name = cleanName(tempName || attendee.name);
    const duplicate = activeAttendees.some((row) => row.id !== attendee.id && normalize(row.name) === normalize(name));
    if (duplicate && !window.confirm(`El nombre "${name}" ya existe. ¿Guardarlo de todos modos?`)) return;
    await runSafe(`save-${attendee.id}`, async () => {
      await updateAttendee(attendee.id, { name });
      setEditingName(null);
    }, 'Nombre actualizado.');
  };

  const toggleAttendance = async (attendee: Attendee) => {
    const next = !attendee.attended;
    await runSafe(`attendance-${attendee.id}`, async () => updateAttendee(attendee.id, { attended: next, checkInTime: next ? Date.now() : null }), next ? 'Asistencia marcada.' : 'Asistencia retirada.');
  };

  const deleteAttendee = async (attendee: Attendee) => {
    if (!window.confirm(`¿Eliminar a "${attendee.name}"?`)) return;
    await runSafe(`delete-${attendee.id}`, async () => deleteDoc(doc(db, RECORDS_COLLECTION, attendee.id)), 'Asistente eliminado.');
  };

  const deleteWorkshop = async (workshop: Workshop) => {
    if (!window.confirm(`¿Eliminar definitivamente "${workshop.name}" y sus asistentes?`)) return;
    await runSafe(`delete-workshop-${workshop.id}`, async () => {
      for (const group of chunk(attendees.filter((attendee) => attendee.workshopId === workshop.id))) {
        const batch = writeBatch(db);
        group.forEach((attendee) => batch.delete(doc(db, RECORDS_COLLECTION, attendee.id)));
        await batch.commit();
      }
      await deleteDoc(doc(db, RECORDS_COLLECTION, workshop.id));
      if (activeWorkshopId === workshop.id) {
        setActiveWorkshopId(null);
        setView('dashboard');
      }
    }, 'Taller eliminado.');
  };

  const clearActiveList = async () => {
    if (!activeWorkshop || !window.confirm('¿Vaciar todos los asistentes de este taller?')) return;
    await runSafe('clear-list', async () => {
      for (const group of chunk(activeAttendees)) {
        const batch = writeBatch(db);
        group.forEach((attendee) => batch.delete(doc(db, RECORDS_COLLECTION, attendee.id)));
        await batch.commit();
      }
    }, 'Lista vaciada correctamente.');
  };

  const handleImport = async (file: File) => {
    if (!activeWorkshop) return;
    await runSafe('import-csv', async () => {
      if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('Por seguridad, la importación acepta solo CSV. En Google Sheets usa: Archivo > Descargar > Valores separados por comas (.csv).');
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
      const existing = new Set(activeAttendees.map((attendee) => normalize(attendee.name)));
      const imported: ImportAttendeeInput[] = [];
      let invalid = 0;
      let duplicates = 0;

      rows.slice(1).forEach((row) => {
        const item: ImportAttendeeInput = {
          name: cleanName(String(row[nameIndex] || '')),
          email: emailIndex >= 0 ? safeText(row[emailIndex], 120) : '',
          phone: phoneIndex >= 0 ? safeText(row[phoneIndex], 40) : '',
          documentId: documentIndex >= 0 ? safeText(row[documentIndex], 40) : '',
          paid: paidIndex >= 0 ? isPaidValue(String(row[paidIndex] || '')) : false,
          amount: amountIndex >= 0 ? parseAmount(String(row[amountIndex] || '')) : 0,
          notes: notesIndex >= 0 ? safeText(row[notesIndex], 500) : '',
        };
        if (validateAttendee(item)) {
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
      if (!window.confirm(`Vista previa de importación\n\nTaller: ${activeWorkshop.name}\nNuevos: ${imported.length}\nDuplicados omitidos: ${duplicates}\nInválidos omitidos: ${invalid}\n\n¿Importar ahora?`)) return;

      for (const group of chunk(imported)) {
        const batch = writeBatch(db);
        group.forEach((row) => {
          const ref = doc(collection(db, RECORDS_COLLECTION));
          batch.set(ref, {
            ...legacyTaskShape(`ASISTENTE: ${row.name}`, user?.uid),
            kind: 'gemb_attendee',
            workshopId: activeWorkshop.id,
            ...row,
            registrationSource: 'google-forms-csv',
            attended: false,
            checkInTime: null,
          });
        });
        await batch.commit();
      }
      setNotice({ type: 'success', message: `Importación terminada. Agregados: ${imported.length}. Duplicados: ${duplicates}. Inválidos: ${invalid}.` });
    });
  };

  const exportPDF = async () => {
    await runSafe('export-pdf', async () => {
      const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const autoTable = autoTableModule.default;
      const targets = activeWorkshop ? [activeWorkshop] : activeWorkshops;
      const pdf = new jsPDF();
      targets.forEach((workshop, index) => {
        if (index > 0) pdf.addPage();
        const rows = attendees.filter((attendee) => attendee.workshopId === workshop.id).sort((a, b) => a.name.localeCompare(b.name));
        const present = rows.filter((attendee) => attendee.attended).length;
        const paid = rows.filter((attendee) => attendee.paid);
        const total = paid.reduce((sum, attendee) => sum + Number(attendee.amount || 0), 0);

        pdf.setFillColor(12, 17, 31);
        pdf.rect(0, 0, 210, 297, 'F');
        pdf.setFillColor(249, 115, 22);
        pdf.roundedRect(14, 14, 182, 34, 6, 6, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        pdf.text('GIMNASIO EMOCIONAL MENTES BRILLANTES', 105, 28, { align: 'center' });
        pdf.setFontSize(10);
        pdf.text('REPORTE DE TALLERES Y ASISTENCIA', 105, 39, { align: 'center' });
        pdf.setFontSize(15);
        pdf.text(workshop.name, 14, 64);
        pdf.setFontSize(9);
        pdf.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, 74);
        pdf.text(`Registrados: ${rows.length}   Asistieron: ${present}   Pagaron: ${paid.length}   Recaudado: ${money.format(total)}`, 14, 84);

        autoTable(pdf, {
          startY: 96,
          head: [['Participante', 'Contacto', 'Asistencia', 'Hora', 'Pago', 'Valor']],
          body: rows.map((attendee) => [attendee.name, [attendee.phone, attendee.email].filter(Boolean).join(' | '), attendee.attended ? 'SI' : 'NO', getTime(attendee.checkInTime), attendee.paid ? 'PAGADO' : 'PENDIENTE', money.format(Number(attendee.amount || 0))]),
          styles: { fontSize: 7, cellPadding: 2 },
          headStyles: { fillColor: [249, 115, 22], textColor: [255, 255, 255], fontStyle: 'bold' },
        });
        const pageCount = pdf.getNumberOfPages();
        for (let page = 1; page <= pageCount; page += 1) {
          pdf.setPage(page);
          pdf.setFontSize(8);
          pdf.setTextColor(120, 120, 120);
          pdf.text(`Página ${page} de ${pageCount}`, 196, 288, { align: 'right' });
        }
      });
      pdf.save(activeWorkshop ? `${activeWorkshop.name.replace(/[^a-z0-9]/gi, '_')}_reporte.pdf` : 'reporte_global_talleres_gemb.pdf');
    }, 'Reporte PDF generado.');
  };

  if (loading || loadingData) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white"><Loader2 className="h-12 w-12 animate-spin text-orange-400" /></div>;
  if (!user) return <Login />;

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="max-w-md rounded-3xl border border-red-500/30 bg-red-950/40 p-6 text-center">
          <AlertTriangle className="mx-auto mb-4 text-red-400" size={44} />
          <h1 className="text-xl font-black">Error de conexión con Firebase</h1>
          <p className="mt-2 text-sm text-red-100">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-red-500 px-5 py-2 font-bold text-white">Recargar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050816] text-slate-100">
      <Toast notice={notice} onClose={() => setNotice(null)} />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_5%,#f9731638,transparent_30%),radial-gradient(circle_at_85%_12%,#22d3ee22,transparent_26%),radial-gradient(circle_at_60%_85%,#7c3aed20,transparent_32%)]" />
      <div className="relative flex min-h-screen">
        <aside className="hidden w-88 shrink-0 border-r border-white/10 bg-black/25 p-5 backdrop-blur-2xl lg:block">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-amber-300 via-orange-500 to-red-500 text-white shadow-2xl shadow-orange-500/25"><Flame size={34} /></div>
            <div><p className="text-xs font-black uppercase tracking-[0.32em] text-orange-200">Gimnasio Emocional</p><h1 className="text-2xl font-black leading-6 text-white">Mentes Brillantes</h1></div>
          </div>
          <nav className="space-y-2">
            <button onClick={() => { setView('dashboard'); setActiveWorkshopId(null); }} className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wide transition ${view === 'dashboard' ? 'bg-orange-500 text-white shadow-xl shadow-orange-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><LayoutDashboard size={18} /> Panel general</button>
            <button onClick={() => { setView('arrival'); setActiveWorkshopId(null); }} className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wide transition ${view === 'arrival' ? 'bg-cyan-400 text-slate-950 shadow-xl shadow-cyan-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Clock size={18} /> Orden de llegada</button>
          </nav>
          <div className="my-6 h-px bg-white/10" />
          <div className="mb-3 flex gap-2">
            <TextInput value={newWorkshopName} onChange={(event) => setNewWorkshopName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createWorkshop()} placeholder="NUEVO TALLER" className="py-3 uppercase" disabled={busy === 'create-workshop'} />
            <button disabled={busy === 'create-workshop'} onClick={createWorkshop} className="rounded-2xl bg-orange-500 px-4 text-white shadow-xl shadow-orange-500/20 transition hover:bg-orange-400 disabled:opacity-50"><Plus size={20} /></button>
          </div>
          <div className="relative mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} /><input value={workshopSearch} onChange={(event) => setWorkshopSearch(event.target.value)} placeholder="Buscar taller" className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-sm outline-none focus:border-orange-400" /></div>
          <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
            {filteredWorkshops.map((workshop) => {
              const count = attendees.filter((attendee) => attendee.workshopId === workshop.id).length;
              return <button key={workshop.id} onClick={() => { setActiveWorkshopId(workshop.id); setView('workshop'); }} className={`group w-full rounded-2xl border p-4 text-left transition ${activeWorkshopId === workshop.id && view === 'workshop' ? 'border-orange-400/60 bg-orange-500/10 text-orange-100' : 'border-white/5 bg-white/[0.03] text-slate-300 hover:border-white/15 hover:bg-white/[0.06]'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black uppercase">{workshop.name}</p><p className="mt-1 text-xs text-slate-500">{count} asistentes</p></div><Trash2 onClick={(event) => { event.stopPropagation(); deleteWorkshop(workshop); }} className="opacity-0 transition group-hover:opacity-100 hover:text-red-300" size={16} /></div></button>;
            })}
          </div>
        </aside>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <header className="mb-6 flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/20 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
            <div><p className="mb-2 inline-flex rounded-full border border-orange-400/20 bg-orange-500/10 px-4 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-orange-200">Gestor interno pro</p><h2 className="text-3xl font-black text-white sm:text-4xl">{view === 'workshop' && activeWorkshop ? activeWorkshop.name : view === 'arrival' ? 'Orden de llegada' : 'Panel general de talleres'}</h2><p className="mt-2 text-sm text-slate-400">Control de inscritos, asistencia, pagos, búsqueda global, CSV y reportes PDF.</p></div>
            <div className="flex flex-wrap gap-2"><button disabled={busy === 'export-pdf'} onClick={exportPDF} className="flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-xl shadow-orange-500/25 hover:bg-orange-400 disabled:opacity-50">{busy === 'export-pdf' ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />} PDF</button><button onClick={logout} className="flex items-center gap-2 rounded-2xl border border-white/10 px-5 py-3 text-sm font-black text-slate-300 hover:bg-white/5"><LogOut size={16} /> Salir</button></div>
          </header>

          <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Inscritos" value={stats.attendees} detail={`${activeWorkshops.length} talleres activos`} icon={<Users size={24} />} />
            <StatCard title="Asistencia" value={`${stats.present}/${stats.attendees}`} detail={`${stats.attendancePct}% de asistencia`} icon={<CheckCircle2 size={24} />} />
            <StatCard title="No asistieron" value={stats.absent} detail="Inscritos ausentes" icon={<UserRoundX size={24} />} />
            <StatCard title="Pagaron" value={stats.paid} detail={`${stats.pending} pendientes`} icon={<Wallet size={24} />} />
            <StatCard title="Recaudado" value={money.format(stats.collected)} detail="Pagos marcados" icon={<Download size={24} />} />
          </section>

          {view === 'dashboard' && (
            <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-8 shadow-2xl shadow-black/20"><div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-orange-500/10 text-orange-200"><Flame size={42} /></div><h3 className="text-3xl font-black text-white">Centro de talleres GEMB</h3><p className="mt-4 max-w-2xl text-slate-400">Crea talleres, importa respuestas de Google Forms desde CSV, marca asistencia en vivo, controla pagos y genera reportes para archivo interno.</p><div className="mt-7 flex flex-wrap gap-3"><button onClick={() => setNotice({ type: 'info', message: 'Selecciona o crea un taller para importar asistentes.' })} className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-black text-slate-300 hover:bg-white/5">Google Forms CSV</button><button onClick={exportPDF} className="rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white hover:bg-orange-400">Exportar reporte global</button></div></div>
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/20"><p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Buscador global</p><div className="relative mt-4"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Buscar por nombre, correo, celular o documento" className="w-full rounded-2xl border border-white/10 bg-black/30 py-4 pl-12 pr-4 outline-none focus:border-orange-400" /></div><div className="mt-4 space-y-3">{globalResults.length ? globalResults.map((item) => <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="font-black uppercase text-white">{item.name}</p><p className="text-xs text-slate-400">{item.workshopName}</p><p className="mt-2 text-xs text-slate-300">{item.paid ? 'Pagó' : 'Pendiente'} · {item.attended ? 'Asistió' : 'No asistió'}</p></div>) : <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">Escribe un nombre para ver en qué taller está, si pagó y si asistió.</p>}</div></div>
            </section>
          )}

          {view === 'arrival' && <section className="space-y-3">{arrivalList.length ? arrivalList.map((attendee, index) => <div key={attendee.id} className="flex items-center gap-4 rounded-3xl border border-cyan-400/20 bg-white/[0.055] p-4"><div className="w-14 text-center text-3xl font-black text-cyan-300">{index + 1}</div><div className="min-w-0 flex-1"><p className="truncate font-black uppercase text-white">{attendee.name}</p><p className="truncate text-xs font-bold uppercase tracking-wide text-slate-400">{attendee.workshopName}</p></div><div className="rounded-2xl border border-cyan-400/20 bg-black/30 px-4 py-2 font-mono text-cyan-200">{getTime(attendee.checkInTime)}</div></div>) : <div className="rounded-3xl border border-white/10 bg-white/[0.055] p-10 text-center text-slate-400">Aún no hay asistentes marcados en sala.</div>}</section>}

          {view === 'workshop' && activeWorkshop && (
            <section className="space-y-5">
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-5"><div className="grid gap-3 md:grid-cols-4"><TextInput placeholder="Fecha" type="date" value={activeWorkshop.date || ''} onChange={(event) => runSafe('workshop-date', () => updateWorkshop(activeWorkshop.id, { date: event.target.value }))} /><TextInput placeholder="Hora" type="time" value={activeWorkshop.time || ''} onChange={(event) => runSafe('workshop-time', () => updateWorkshop(activeWorkshop.id, { time: event.target.value }))} /><TextInput placeholder="Lugar" value={activeWorkshop.location || ''} onChange={(event) => runSafe('workshop-location', () => updateWorkshop(activeWorkshop.id, { location: event.target.value }))} /><TextInput placeholder="Precio base" type="number" value={activeWorkshop.basePrice || ''} onChange={(event) => runSafe('workshop-price', () => updateWorkshop(activeWorkshop.id, { basePrice: Number(event.target.value || 0) }))} /></div></div>
              <div className="flex flex-col gap-3 rounded-[2rem] border border-white/10 bg-white/[0.055] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} /><input value={attendeeSearch} onChange={(event) => setAttendeeSearch(event.target.value)} placeholder="Buscar asistente" className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-10 pr-3 outline-none focus:border-orange-400" /></div><div className="flex flex-wrap gap-2">{(['all', 'paid', 'unpaid', 'present', 'absent'] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-2xl px-4 py-2 text-xs font-black uppercase ${filter === item ? 'bg-orange-500 text-white' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>{item === 'all' ? 'Todos' : item === 'paid' ? 'Pagaron' : item === 'unpaid' ? 'Pendientes' : item === 'present' ? 'En sala' : 'Ausentes'}</button>)}</div></div>
              <div className="flex flex-wrap gap-2"><button onClick={addAttendee} disabled={busy === 'add-attendee'} className="flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white hover:bg-orange-400 disabled:opacity-50"><Plus size={16} /> Nuevo asistente</button><button onClick={() => fileInputRef.current?.click()} disabled={busy === 'import-csv'} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 hover:bg-white/5 disabled:opacity-50">{busy === 'import-csv' ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Importar CSV</button><button onClick={() => runSafe('archive', () => updateWorkshop(activeWorkshop.id, { isArchived: !activeWorkshop.isArchived }), activeWorkshop.isArchived ? 'Taller reactivado.' : 'Taller finalizado.')} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 hover:bg-white/5"><CheckCircle2 size={16} /> Finalizar</button><button onClick={clearActiveList} className="flex items-center gap-2 rounded-2xl border border-red-500/30 px-4 py-3 text-sm font-black text-red-300 hover:bg-red-500/10"><Trash2 size={16} /> Limpiar lista</button></div>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(event) => event.target.files?.[0] && handleImport(event.target.files[0]).finally(() => { event.currentTarget.value = ''; })} />
              <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/20"><div className="grid grid-cols-12 border-b border-white/10 bg-black/30 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-400"><div className="col-span-5">Participante</div><div className="col-span-2 text-center">Asistencia</div><div className="col-span-2 text-center">Pago</div><div className="col-span-2 text-right">Valor</div><div className="col-span-1" /></div>{filteredAttendees.length ? filteredAttendees.map((attendee) => <div key={attendee.id} className="grid grid-cols-12 items-center gap-2 border-b border-white/5 px-4 py-3 last:border-b-0 hover:bg-white/[0.03]"><div className="col-span-5 min-w-0">{editingName === attendee.id ? <input autoFocus value={tempName} onChange={(event) => setTempName(event.target.value)} onBlur={() => saveAttendeeName(attendee)} onKeyDown={(event) => event.key === 'Enter' && saveAttendeeName(attendee)} className="w-full rounded-xl border border-orange-400 bg-black/40 px-3 py-2 font-bold uppercase outline-none" /> : <button onClick={() => { setEditingName(attendee.id); setTempName(attendee.name); }} className="truncate text-left font-black uppercase text-white hover:text-orange-300">{attendee.name}</button>}</div><div className="col-span-2 text-center"><button onClick={() => toggleAttendance(attendee)} className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${attendee.attended ? 'bg-cyan-500/15 text-cyan-200' : 'border border-white/10 text-slate-500'}`}>{attendee.attended ? 'En sala' : 'Ausente'}</button></div><div className="col-span-2 text-center"><button onClick={() => runSafe(`paid-${attendee.id}`, () => updateAttendee(attendee.id, { paid: !attendee.paid, amount: !attendee.paid && !attendee.amount ? Number(activeWorkshop.basePrice || 0) : attendee.amount }))} className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${attendee.paid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{attendee.paid ? 'Pagado' : 'Pendiente'}</button></div><div className="col-span-2"><input type="number" min="0" value={attendee.paid ? attendee.amount || '' : ''} disabled={!attendee.paid} onChange={(event) => runSafe(`amount-${attendee.id}`, () => updateAttendee(attendee.id, { amount: Number(event.target.value || 0) }))} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-right font-mono outline-none disabled:opacity-30" placeholder="0" /></div><div className="col-span-1 text-right"><button onClick={() => deleteAttendee(attendee)} className="rounded-xl p-2 text-red-300 hover:bg-red-500/10"><Trash2 size={16} /></button></div></div>) : <div className="p-10 text-center text-slate-500"><UserRoundCheck className="mx-auto mb-3" size={44} />Importa un CSV o agrega asistentes manualmente.</div>}</div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
