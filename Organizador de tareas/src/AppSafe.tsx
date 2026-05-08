import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { db } from './lib/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Flame,
  LogOut,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

type Workshop = {
  id: string;
  kind: 'gemb_workshop';
  name: string;
  isArchived: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type Attendee = {
  id: string;
  kind: 'gemb_attendee';
  workshopId: string;
  name: string;
  paid: boolean;
  amount: number;
  attended: boolean;
  checkInTime: number | null;
};

type GembRecord = Workshop | Attendee;

type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

const RECORDS_COLLECTION = 'tasks';
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const nowIso = () => new Date().toISOString();
const cleanName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const normalize = (value: string) => cleanName(value).toLowerCase();
const getTime = (value: number | null) => value ? new Date(value).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '--:--';

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

function StatCard({ title, value, icon, accent }: { title: string; value: string | number; icon: React.ReactNode; accent: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{title}</p>
          <p className="mt-2 text-2xl font-black text-white sm:text-3xl">{value}</p>
        </div>
        <div className={`rounded-2xl border border-white/10 bg-black/30 p-3 ${accent}`}>{icon}</div>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, loading, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkshopId, setActiveWorkshopId] = useState<string | null>(null);
  const [view, setView] = useState<'dashboard' | 'workshop' | 'arrival'>('dashboard');
  const [newWorkshopName, setNewWorkshopName] = useState('');
  const [workshopSearch, setWorkshopSearch] = useState('');
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'paid' | 'unpaid' | 'present'>('all');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');

  useEffect(() => {
    if (!user) {
      setWorkshops([]);
      setAttendees([]);
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    const unsubscribe = onSnapshot(
      query(collection(db, RECORDS_COLLECTION), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as GembRecord[];
        setWorkshops(rows.filter((item): item is Workshop => item.kind === 'gemb_workshop'));
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

  const filteredWorkshops = useMemo(() => {
    return workshops.filter((workshop) => !workshop.isArchived && workshop.name.toLowerCase().includes(workshopSearch.toLowerCase()));
  }, [workshops, workshopSearch]);

  const filteredAttendees = useMemo(() => {
    let rows = [...activeAttendees];
    if (attendeeSearch.trim()) rows = rows.filter((attendee) => attendee.name.toLowerCase().includes(attendeeSearch.toLowerCase()));
    if (filter === 'paid') rows = rows.filter((attendee) => attendee.paid);
    if (filter === 'unpaid') rows = rows.filter((attendee) => !attendee.paid);
    if (filter === 'present') rows = rows.filter((attendee) => attendee.attended);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeAttendees, attendeeSearch, filter]);

  const arrivalList = useMemo(() => {
    return attendees
      .filter((attendee) => attendee.attended && attendee.checkInTime)
      .map((attendee) => ({ ...attendee, workshopName: workshops.find((workshop) => workshop.id === attendee.workshopId)?.name || 'SIN TALLER' }))
      .sort((a, b) => Number(a.checkInTime) - Number(b.checkInTime));
  }, [attendees, workshops]);

  const stats = useMemo(() => {
    const scope = activeWorkshop ? activeAttendees : attendees;
    return {
      attendees: scope.length,
      present: scope.filter((attendee) => attendee.attended).length,
      paid: scope.filter((attendee) => attendee.paid).length,
      pending: scope.filter((attendee) => !attendee.paid).length,
      collected: scope.reduce((sum, attendee) => sum + (attendee.paid ? Number(attendee.amount || 0) : 0), 0),
    };
  }, [activeWorkshop, activeAttendees, attendees]);

  const createWorkshop = async () => {
    const name = cleanName(newWorkshopName);
    if (!name) return;

    const ref = await addDoc(collection(db, RECORDS_COLLECTION), {
      ...legacyTaskShape(`TALLER: ${name}`, user?.uid),
      kind: 'gemb_workshop',
      name,
      isArchived: false,
    });

    setNewWorkshopName('');
    setActiveWorkshopId(ref.id);
    setView('workshop');
  };

  const updateWorkshop = async (id: string, updates: Partial<Workshop>) => {
    const title = updates.name ? `TALLER: ${updates.name}` : undefined;
    await updateDoc(doc(db, RECORDS_COLLECTION, id), { ...updates, ...(title ? { title } : {}), updatedAt: nowIso() });
  };

  const deleteWorkshop = async (workshop: Workshop) => {
    if (!window.confirm(`¿Eliminar definitivamente "${workshop.name}" y sus asistentes?`)) return;
    const batch = writeBatch(db);
    attendees.filter((attendee) => attendee.workshopId === workshop.id).forEach((attendee) => batch.delete(doc(db, RECORDS_COLLECTION, attendee.id)));
    batch.delete(doc(db, RECORDS_COLLECTION, workshop.id));
    await batch.commit();
    if (activeWorkshopId === workshop.id) {
      setActiveWorkshopId(null);
      setView('dashboard');
    }
  };

  const addAttendee = async () => {
    if (!activeWorkshop) return;
    await addDoc(collection(db, RECORDS_COLLECTION), {
      ...legacyTaskShape('ASISTENTE: NUEVO ASISTENTE', user?.uid),
      kind: 'gemb_attendee',
      workshopId: activeWorkshop.id,
      name: 'NUEVO ASISTENTE',
      paid: false,
      amount: 0,
      attended: false,
      checkInTime: null,
    });
  };

  const updateAttendee = async (id: string, updates: Partial<Attendee>) => {
    const title = updates.name ? `ASISTENTE: ${updates.name}` : undefined;
    await updateDoc(doc(db, RECORDS_COLLECTION, id), { ...updates, ...(title ? { title } : {}), updatedAt: nowIso() });
  };

  const saveAttendeeName = async (attendee: Attendee) => {
    const name = cleanName(tempName || attendee.name);
    const duplicate = activeAttendees.some((row) => row.id !== attendee.id && normalize(row.name) === normalize(name));
    if (duplicate && !window.confirm(`El nombre "${name}" ya existe. ¿Guardarlo de todos modos?`)) return;
    await updateAttendee(attendee.id, { name });
    setEditingName(null);
  };

  const toggleAttendance = async (attendee: Attendee) => {
    const next = !attendee.attended;
    await updateAttendee(attendee.id, { attended: next, checkInTime: next ? Date.now() : null });
  };

  const deleteAttendee = async (attendee: Attendee) => {
    if (!window.confirm(`¿Eliminar a "${attendee.name}"?`)) return;
    await deleteDoc(doc(db, RECORDS_COLLECTION, attendee.id));
  };

  const clearActiveList = async () => {
    if (!activeWorkshop || !window.confirm('¿Vaciar todos los asistentes de este taller?')) return;
    const batch = writeBatch(db);
    activeAttendees.forEach((attendee) => batch.delete(doc(db, RECORDS_COLLECTION, attendee.id)));
    await batch.commit();
  };

  const handleImport = async (file: File) => {
    if (!activeWorkshop) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Por seguridad, la importación acepta solo CSV. En Excel usa: Archivo > Guardar como > CSV UTF-8.');
      return;
    }

    const rows = parseCsv(await file.text());
    if (!rows.length) return;

    const headers = rows[0].map((header) => String(header || '').toLowerCase());
    let nameIndex = headers.findIndex((header) => header.includes('nombre') || header.includes('name') || header.includes('participante') || header.includes('asistente'));
    if (nameIndex < 0) nameIndex = 0;

    const existing = new Set(activeAttendees.map((attendee) => normalize(attendee.name)));
    const batch = writeBatch(db);
    let added = 0;
    let skipped = 0;

    rows.slice(1).forEach((row) => {
      const raw = row[nameIndex];
      const name = cleanName(String(raw || ''));
      if (!name) return;
      if (existing.has(normalize(name))) {
        skipped += 1;
        return;
      }

      existing.add(normalize(name));
      const ref = doc(collection(db, RECORDS_COLLECTION));
      batch.set(ref, {
        ...legacyTaskShape(`ASISTENTE: ${name}`, user?.uid),
        kind: 'gemb_attendee',
        workshopId: activeWorkshop.id,
        name,
        paid: false,
        amount: 0,
        attended: false,
        checkInTime: null,
      });
      added += 1;
    });

    await batch.commit();
    alert(`Importación terminada. Agregados: ${added}. Duplicados omitidos: ${skipped}.`);
  };

  const exportPDF = () => {
    const targets = activeWorkshop ? [activeWorkshop] : workshops.filter((workshop) => !workshop.isArchived);
    const pdf = new jsPDF();

    targets.forEach((workshop, index) => {
      if (index > 0) pdf.addPage();
      const rows = attendees.filter((attendee) => attendee.workshopId === workshop.id).sort((a, b) => a.name.localeCompare(b.name));
      const total = rows.reduce((sum, attendee) => sum + (attendee.paid ? Number(attendee.amount || 0) : 0), 0);

      pdf.setFillColor(249, 115, 22);
      pdf.rect(0, 0, 210, 34, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(255, 255, 255);
      pdf.text('GIMNASIO EMOCIONAL MENTES BRILLANTES', 105, 14, { align: 'center' });
      pdf.setFontSize(10);
      pdf.text('REPORTE DE TALLERES Y ASISTENCIA', 105, 23, { align: 'center' });
      pdf.setTextColor(20, 20, 20);
      pdf.setFontSize(13);
      pdf.text(workshop.name, 14, 47);
      pdf.setFontSize(9);
      pdf.text(new Date().toLocaleDateString('es-CO'), 196, 47, { align: 'right' });

      autoTable(pdf, {
        startY: 54,
        head: [['Participante', 'Asistencia', 'Hora', 'Pago', 'Valor']],
        body: rows.map((attendee) => [attendee.name, attendee.attended ? 'SI' : 'NO', getTime(attendee.checkInTime), attendee.paid ? 'PAGADO' : 'PENDIENTE', money.format(Number(attendee.amount || 0))]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [249, 115, 22] },
      });

      const finalY = (pdf as PdfWithTable).lastAutoTable?.finalY || 70;
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Total recaudado: ${money.format(total)}`, 14, finalY + 12);
      pdf.text(`Asistencia: ${rows.filter((attendee) => attendee.attended).length} / ${rows.length}`, 14, finalY + 20);
    });

    pdf.save(activeWorkshop ? `${activeWorkshop.name.replace(/[^a-z0-9]/gi, '_')}.pdf` : 'reporte_talleres.pdf');
  };

  if (loading || loadingData) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white"><div className="h-12 w-12 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" /></div>;
  }

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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,#f9731633,transparent_36%),radial-gradient(circle_at_right,#22d3ee22,transparent_28%)]" />
      <div className="relative flex min-h-screen">
        <aside className="hidden w-80 shrink-0 border-r border-white/10 bg-slate-950/80 p-5 backdrop-blur-xl lg:block">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-3xl bg-gradient-to-br from-amber-300 via-orange-500 to-red-500 p-3 text-white shadow-lg shadow-orange-500/30"><Flame className="h-8 w-8" /></div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-300">Gimnasio Emocional</p>
              <h1 className="text-xl font-black leading-5 text-white">Mentes Brillantes</h1>
            </div>
          </div>

          <button onClick={() => { setView('dashboard'); setActiveWorkshopId(null); }} className={`mb-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wide transition ${view === 'dashboard' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Wallet size={18} /> Panel general</button>
          <button onClick={() => { setView('arrival'); setActiveWorkshopId(null); }} className={`mb-5 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wide transition ${view === 'arrival' ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Clock size={18} /> Orden de llegada</button>

          <div className="mb-3 flex gap-2">
            <input value={newWorkshopName} onChange={(event) => setNewWorkshopName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createWorkshop()} placeholder="Nuevo taller" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold uppercase outline-none focus:border-orange-400" />
            <button onClick={createWorkshop} className="rounded-2xl bg-orange-500 p-3 text-white hover:bg-orange-400"><Plus size={18} /></button>
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input value={workshopSearch} onChange={(event) => setWorkshopSearch(event.target.value)} placeholder="Buscar taller" className="w-full rounded-2xl border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-400" />
          </div>

          <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
            {filteredWorkshops.map((workshop) => (
              <button key={workshop.id} onClick={() => { setActiveWorkshopId(workshop.id); setView('workshop'); }} className={`group flex w-full items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-left transition ${activeWorkshopId === workshop.id && view === 'workshop' ? 'border-orange-400 bg-orange-500/10 text-orange-200' : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-white'}`}>
                <span className="truncate text-xs font-black uppercase">{workshop.name}</span>
                <Trash2 onClick={(event) => { event.stopPropagation(); deleteWorkshop(workshop); }} className="opacity-0 transition group-hover:opacity-100 hover:text-red-400" size={15} />
              </button>
            ))}
          </div>
        </aside>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-black/20 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">Gestor interno</p>
              <h2 className="text-2xl font-black text-white sm:text-3xl">{view === 'workshop' && activeWorkshop ? activeWorkshop.name : view === 'arrival' ? 'Orden de llegada' : 'Panel general de talleres'}</h2>
              <p className="mt-1 text-sm text-slate-400">Login actual, Firebase autorizado, importación CSV segura y reportes PDF.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeWorkshop && view === 'workshop' && <button onClick={exportPDF} className="flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2 text-sm font-black text-white hover:bg-orange-400"><Download size={16} /> PDF</button>}
              <button onClick={logout} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-2 text-sm font-black text-slate-300 hover:bg-white/5"><LogOut size={16} /> Salir</button>
            </div>
          </header>

          <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Asistentes" value={stats.attendees} icon={<Users size={26} />} accent="text-blue-300" />
            <StatCard title="En sala" value={`${stats.present}/${stats.attendees}`} icon={<CheckCircle2 size={26} />} accent="text-cyan-300" />
            <StatCard title="Pagaron" value={stats.paid} icon={<Wallet size={26} />} accent="text-emerald-300" />
            <StatCard title="Pendientes" value={stats.pending} icon={<AlertTriangle size={26} />} accent="text-red-300" />
            <StatCard title="Recaudado" value={money.format(stats.collected)} icon={<Download size={26} />} accent="text-orange-300" />
          </section>

          {view === 'dashboard' && (
            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-8 text-center shadow-2xl shadow-black/20">
              <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-orange-500/10 text-orange-300 shadow-lg shadow-orange-500/20"><Flame className="h-12 w-12" /></div>
              <h3 className="text-3xl font-black text-white">Centro de talleres GEMB</h3>
              <p className="mx-auto mt-2 max-w-2xl text-slate-400">Administra talleres, participantes, pagos, asistencia, orden de llegada y reportes PDF. Para importar desde Excel, guarda primero el archivo como CSV UTF-8.</p>
              <button onClick={exportPDF} className="mt-6 rounded-2xl bg-orange-500 px-5 py-3 font-black text-white hover:bg-orange-400">Exportar reporte global</button>
            </section>
          )}

          {view === 'arrival' && (
            <section className="space-y-3">
              {arrivalList.length === 0 ? <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-10 text-center text-slate-400">Aún no hay asistentes marcados en sala.</div> : arrivalList.map((attendee, index) => (
                <div key={attendee.id} className="flex items-center gap-4 rounded-3xl border border-cyan-400/20 bg-slate-900/70 p-4 shadow-lg shadow-cyan-500/5">
                  <div className="w-14 text-center text-3xl font-black text-cyan-300">{index + 1}</div>
                  <div className="min-w-0 flex-1"><p className="truncate font-black uppercase text-white">{attendee.name}</p><p className="truncate text-xs font-bold uppercase tracking-wide text-slate-400">{attendee.workshopName}</p></div>
                  <div className="rounded-2xl border border-cyan-400/20 bg-black/30 px-4 py-2 font-mono text-cyan-200">{getTime(attendee.checkInTime)}</div>
                </div>
              ))}
            </section>
          )}

          {view === 'workshop' && activeWorkshop && (
            <section className="space-y-5">
              <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                  <input value={attendeeSearch} onChange={(event) => setAttendeeSearch(event.target.value)} placeholder="Buscar asistente" className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-10 pr-3 outline-none focus:border-orange-400" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'paid', 'unpaid', 'present'] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-2xl px-4 py-2 text-xs font-black uppercase ${filter === item ? 'bg-orange-500 text-white' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>{item === 'all' ? 'Todos' : item === 'paid' ? 'Pagaron' : item === 'unpaid' ? 'Pendientes' : 'En sala'}</button>)}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={addAttendee} className="flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white hover:bg-orange-400"><Plus size={16} /> Nuevo asistente</button>
                <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 hover:bg-white/5"><Upload size={16} /> Importar CSV</button>
                <button onClick={() => updateWorkshop(activeWorkshop.id, { isArchived: !activeWorkshop.isArchived })} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 hover:bg-white/5"><Archive size={16} /> Finalizar</button>
                <button onClick={clearActiveList} className="flex items-center gap-2 rounded-2xl border border-red-500/30 px-4 py-3 text-sm font-black text-red-300 hover:bg-red-500/10"><Trash2 size={16} /> Limpiar lista</button>
              </div>

              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => event.target.files?.[0] && handleImport(event.target.files[0]).finally(() => { event.currentTarget.value = ''; })} />

              <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 shadow-2xl shadow-black/20">
                <div className="grid grid-cols-12 border-b border-white/10 bg-black/30 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-400">
                  <div className="col-span-5">Participante</div><div className="col-span-2 text-center">Asistencia</div><div className="col-span-2 text-center">Pago</div><div className="col-span-2 text-right">Valor</div><div className="col-span-1" />
                </div>
                {filteredAttendees.length === 0 ? (
                  <div className="p-10 text-center text-slate-500"><FileSpreadsheet className="mx-auto mb-3" size={44} />Importa un CSV o agrega asistentes manualmente.</div>
                ) : filteredAttendees.map((attendee) => (
                  <div key={attendee.id} className="grid grid-cols-12 items-center gap-2 border-b border-white/5 px-4 py-3 last:border-b-0 hover:bg-white/[0.03]">
                    <div className="col-span-5 min-w-0">
                      {editingName === attendee.id ? <input autoFocus value={tempName} onChange={(event) => setTempName(event.target.value)} onBlur={() => saveAttendeeName(attendee)} onKeyDown={(event) => event.key === 'Enter' && saveAttendeeName(attendee)} className="w-full rounded-xl border border-orange-400 bg-black/40 px-3 py-2 font-bold uppercase outline-none" /> : <button onClick={() => { setEditingName(attendee.id); setTempName(attendee.name); }} className="truncate text-left font-black uppercase text-white hover:text-orange-300">{attendee.name}</button>}
                    </div>
                    <div className="col-span-2 text-center"><button onClick={() => toggleAttendance(attendee)} className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${attendee.attended ? 'bg-cyan-500/15 text-cyan-200' : 'border border-white/10 text-slate-500'}`}>{attendee.attended ? 'En sala' : 'Ausente'}</button></div>
                    <div className="col-span-2 text-center"><button onClick={() => updateAttendee(attendee.id, { paid: !attendee.paid, amount: !attendee.paid && !attendee.amount ? 0 : attendee.amount })} className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${attendee.paid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{attendee.paid ? 'Pagado' : 'Pendiente'}</button></div>
                    <div className="col-span-2"><input type="number" min="0" value={attendee.paid ? attendee.amount || '' : ''} disabled={!attendee.paid} onChange={(event) => updateAttendee(attendee.id, { amount: Number(event.target.value || 0) })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-right font-mono outline-none disabled:opacity-30" placeholder="0" /></div>
                    <div className="col-span-1 text-right"><button onClick={() => deleteAttendee(attendee)} className="rounded-xl p-2 text-red-300 hover:bg-red-500/10"><Trash2 size={16} /></button></div>
                  </div>
                ))}
              </div>
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
