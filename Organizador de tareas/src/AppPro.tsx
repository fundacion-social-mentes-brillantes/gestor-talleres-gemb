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
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Flame,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRoundCheck,
  UserRoundX,
  Users,
  Wallet,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

type Workshop = {
  id: string;
  kind: 'gemb_workshop';
  name: string;
  date?: string;
  time?: string;
  location?: string;
  modality?: string;
  basePrice?: number;
  capacity?: number;
  notes?: string;
  isArchived: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type Attendee = {
  id: string;
  kind: 'gemb_attendee';
  workshopId: string;
  name: string;
  email?: string;
  phone?: string;
  documentId?: string;
  notes?: string;
  registrationSource?: string;
  paid: boolean;
  amount: number;
  attended: boolean;
  checkInTime: number | null;
  createdAt?: string;
  updatedAt?: string;
};

type GembRecord = Workshop | Attendee;
type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } };
type View = 'dashboard' | 'workshop' | 'arrival';
type Filter = 'all' | 'paid' | 'unpaid' | 'present' | 'absent';

const RECORDS_COLLECTION = 'tasks';
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const nowIso = () => new Date().toISOString();
const cleanName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const normalize = (value: string) => cleanName(value).toLowerCase();
const getTime = (value: number | null) => value ? new Date(value).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '--:--';
const getDateLabel = (value?: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin fecha';
const getPct = (part: number, total: number) => total ? Math.round((part / total) * 100) : 0;

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
  return Number.isFinite(amount) ? amount : 0;
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

function IconBadge({ children, tone = 'orange' }: { children: React.ReactNode; tone?: 'orange' | 'cyan' | 'emerald' | 'red' | 'slate' }) {
  const tones = {
    orange: 'border-orange-400/20 bg-orange-500/10 text-orange-200 shadow-orange-500/10',
    cyan: 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200 shadow-cyan-500/10',
    emerald: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200 shadow-emerald-500/10',
    red: 'border-red-400/20 bg-red-500/10 text-red-200 shadow-red-500/10',
    slate: 'border-white/10 bg-white/5 text-slate-200 shadow-black/20',
  };
  return <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border shadow-xl ${tones[tone]}`}>{children}</div>;
}

function StatCard({ title, value, detail, icon, tone }: { title: string; value: string | number; detail?: string; icon: React.ReactNode; tone: 'orange' | 'cyan' | 'emerald' | 'red' | 'slate' }) {
  return (
    <div className="group overflow-hidden rounded-[1.7rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.07]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{title}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-white">{value}</p>
          {detail && <p className="mt-2 text-xs font-semibold text-slate-400">{detail}</p>}
        </div>
        <IconBadge tone={tone}>{icon}</IconBadge>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-orange-300/70 focus:bg-black/40 ${props.className || ''}`} />;
}

function SmallPill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'emerald' | 'red' | 'cyan' | 'orange' | 'slate' }) {
  const tones = {
    emerald: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    red: 'border-red-400/20 bg-red-500/10 text-red-200',
    cyan: 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200',
    orange: 'border-orange-400/20 bg-orange-500/10 text-orange-200',
    slate: 'border-white/10 bg-white/5 text-slate-300',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}

function AppContent() {
  const { user, loading, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkshopId, setActiveWorkshopId] = useState<string | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [newWorkshopName, setNewWorkshopName] = useState('');
  const [workshopSearch, setWorkshopSearch] = useState('');
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
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
  const activeWorkshops = useMemo(() => workshops.filter((workshop) => !workshop.isArchived), [workshops]);

  const filteredWorkshops = useMemo(() => {
    return activeWorkshops.filter((workshop) => workshop.name.toLowerCase().includes(workshopSearch.toLowerCase()));
  }, [activeWorkshops, workshopSearch]);

  const filteredAttendees = useMemo(() => {
    let rows = [...activeAttendees];
    if (attendeeSearch.trim()) {
      const search = attendeeSearch.toLowerCase();
      rows = rows.filter((attendee) => [attendee.name, attendee.email, attendee.phone, attendee.documentId].some((value) => String(value || '').toLowerCase().includes(search)));
    }
    if (filter === 'paid') rows = rows.filter((attendee) => attendee.paid);
    if (filter === 'unpaid') rows = rows.filter((attendee) => !attendee.paid);
    if (filter === 'present') rows = rows.filter((attendee) => attendee.attended);
    if (filter === 'absent') rows = rows.filter((attendee) => !attendee.attended);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeAttendees, attendeeSearch, filter]);

  const globalResults = useMemo(() => {
    const search = globalSearch.trim().toLowerCase();
    if (!search) return [];
    return attendees
      .filter((attendee) => [attendee.name, attendee.email, attendee.phone, attendee.documentId].some((value) => String(value || '').toLowerCase().includes(search)))
      .slice(0, 15)
      .map((attendee) => ({ ...attendee, workshopName: workshops.find((workshop) => workshop.id === attendee.workshopId)?.name || 'SIN TALLER' }));
  }, [attendees, globalSearch, workshops]);

  const arrivalList = useMemo(() => {
    return attendees
      .filter((attendee) => attendee.attended && attendee.checkInTime)
      .map((attendee) => ({ ...attendee, workshopName: workshops.find((workshop) => workshop.id === attendee.workshopId)?.name || 'SIN TALLER' }))
      .sort((a, b) => Number(a.checkInTime) - Number(b.checkInTime));
  }, [attendees, workshops]);

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
    if (!name) return;

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
      alert('Por seguridad, la importación acepta solo CSV. En Google Sheets usa: Archivo > Descargar > Valores separados por comas (.csv).');
      return;
    }

    const rows = parseCsv(await file.text());
    if (!rows.length) return;

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
    const parsed = rows.slice(1).map((row) => {
      const name = cleanName(String(row[nameIndex] || ''));
      if (!name) return null;
      return {
        name,
        email: emailIndex >= 0 ? String(row[emailIndex] || '').trim() : '',
        phone: phoneIndex >= 0 ? String(row[phoneIndex] || '').trim() : '',
        documentId: documentIndex >= 0 ? String(row[documentIndex] || '').trim() : '',
        paid: paidIndex >= 0 ? isPaidValue(String(row[paidIndex] || '')) : false,
        amount: amountIndex >= 0 ? parseAmount(String(row[amountIndex] || '')) : 0,
        notes: notesIndex >= 0 ? String(row[notesIndex] || '').trim() : '',
      };
    }).filter(Boolean) as Array<Omit<Attendee, 'id' | 'kind' | 'workshopId' | 'attended' | 'checkInTime'>>;

    const newRows = parsed.filter((row) => !existing.has(normalize(row.name)));
    const duplicated = parsed.length - newRows.length;
    const confirmed = window.confirm(`Vista previa de importación\n\nTaller: ${activeWorkshop.name}\nLeídos: ${parsed.length}\nNuevos: ${newRows.length}\nDuplicados omitidos: ${duplicated}\n\n¿Importar ahora?`);
    if (!confirmed) return;

    const batch = writeBatch(db);
    newRows.forEach((row) => {
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
    alert(`Importación terminada. Agregados: ${newRows.length}. Duplicados omitidos: ${duplicated}.`);
  };

  const drawPdfSummary = (pdf: jsPDF, workshop: Workshop, rows: Attendee[]) => {
    const present = rows.filter((attendee) => attendee.attended);
    const absent = rows.filter((attendee) => !attendee.attended);
    const paid = rows.filter((attendee) => attendee.paid);
    const total = paid.reduce((sum, attendee) => sum + Number(attendee.amount || 0), 0);

    pdf.setFillColor(12, 17, 31);
    pdf.rect(0, 0, 210, 297, 'F');
    pdf.setFillColor(249, 115, 22);
    pdf.roundedRect(14, 14, 182, 34, 6, 6, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(17);
    pdf.text('GIMNASIO EMOCIONAL MENTES BRILLANTES', 105, 28, { align: 'center' });
    pdf.setFontSize(10);
    pdf.text('REPORTE PROFESIONAL DE TALLER', 105, 39, { align: 'center' });

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(19);
    pdf.text(workshop.name, 14, 68);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(190, 198, 213);
    pdf.text(`Fecha: ${getDateLabel(workshop.date)}   Hora: ${workshop.time || '--'}   Lugar: ${workshop.location || 'Sin lugar'}`, 14, 78);
    pdf.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, 85);

    const cards = [
      ['Registrados', String(rows.length)],
      ['Asistieron', `${present.length} (${getPct(present.length, rows.length)}%)`],
      ['No asistieron', String(absent.length)],
      ['Pagaron', String(paid.length)],
      ['Recaudado', money.format(total)],
    ];

    let x = 14;
    cards.forEach(([label, value], index) => {
      if (index === 3) x = 14;
      const y = index < 3 ? 102 : 132;
      const width = index < 3 ? 58 : 88;
      pdf.setFillColor(20, 28, 46);
      pdf.roundedRect(x, y, width, 20, 4, 4, 'F');
      pdf.setTextColor(146, 158, 180);
      pdf.setFontSize(7);
      pdf.setFont('helvetica', 'bold');
      pdf.text(label.toUpperCase(), x + 4, y + 7);
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(12);
      pdf.text(value, x + 4, y + 16);
      x += width + 4;
    });

    autoTable(pdf, {
      startY: 166,
      head: [['Participante', 'Contacto', 'Asistencia', 'Hora', 'Pago', 'Valor']],
      body: rows.map((attendee) => [
        attendee.name,
        [attendee.phone, attendee.email].filter(Boolean).join(' | '),
        attendee.attended ? 'ASISTIÓ' : 'NO ASISTIÓ',
        getTime(attendee.checkInTime),
        attendee.paid ? 'PAGADO' : 'PENDIENTE',
        money.format(Number(attendee.amount || 0)),
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [249, 115, 22], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 251] },
    });

    const finalY = (pdf as PdfWithTable).lastAutoTable?.finalY || 220;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(20, 28, 46);
    pdf.text(`Resumen: ${present.length} asistieron y ${absent.length} no asistieron de ${rows.length} inscritos.`, 14, Math.min(finalY + 12, 285));
  };

  const exportPDF = () => {
    const targets = activeWorkshop ? [activeWorkshop] : activeWorkshops;
    const pdf = new jsPDF();
    targets.forEach((workshop, index) => {
      if (index > 0) pdf.addPage();
      const rows = attendees.filter((attendee) => attendee.workshopId === workshop.id).sort((a, b) => a.name.localeCompare(b.name));
      drawPdfSummary(pdf, workshop, rows);
    });
    pdf.save(activeWorkshop ? `${activeWorkshop.name.replace(/[^a-z0-9]/gi, '_')}_reporte.pdf` : 'reporte_global_talleres_gemb.pdf');
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
    <div className="min-h-screen bg-[#050816] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_5%,#f9731638,transparent_30%),radial-gradient(circle_at_85%_12%,#22d3ee22,transparent_26%),radial-gradient(circle_at_60%_85%,#7c3aed20,transparent_32%)]" />
      <div className="relative flex min-h-screen">
        <aside className="hidden w-88 shrink-0 border-r border-white/10 bg-black/25 p-5 backdrop-blur-2xl lg:block">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-amber-300 via-orange-500 to-red-500 text-white shadow-2xl shadow-orange-500/25"><Flame size={34} /></div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.32em] text-orange-200">Gimnasio Emocional</p>
              <h1 className="text-2xl font-black leading-6 text-white">Mentes Brillantes</h1>
            </div>
          </div>

          <nav className="space-y-2">
            <button onClick={() => { setView('dashboard'); setActiveWorkshopId(null); }} className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wide transition ${view === 'dashboard' ? 'bg-orange-500 text-white shadow-xl shadow-orange-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><LayoutDashboard size={18} /> Panel general</button>
            <button onClick={() => { setView('arrival'); setActiveWorkshopId(null); }} className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wide transition ${view === 'arrival' ? 'bg-cyan-400 text-slate-950 shadow-xl shadow-cyan-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Clock size={18} /> Orden de llegada</button>
          </nav>

          <div className="my-6 h-px bg-white/10" />

          <div className="mb-3 flex gap-2">
            <TextInput value={newWorkshopName} onChange={(event) => setNewWorkshopName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createWorkshop()} placeholder="NUEVO TALLER" className="py-3 uppercase" />
            <button onClick={createWorkshop} className="rounded-2xl bg-orange-500 px-4 text-white shadow-xl shadow-orange-500/20 transition hover:bg-orange-400"><Plus size={20} /></button>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input value={workshopSearch} onChange={(event) => setWorkshopSearch(event.target.value)} placeholder="Buscar taller" className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-9 pr-3 text-sm outline-none focus:border-orange-400" />
          </div>

          <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
            {filteredWorkshops.map((workshop) => {
              const count = attendees.filter((attendee) => attendee.workshopId === workshop.id).length;
              return (
                <button key={workshop.id} onClick={() => { setActiveWorkshopId(workshop.id); setView('workshop'); }} className={`group w-full rounded-2xl border p-4 text-left transition ${activeWorkshopId === workshop.id && view === 'workshop' ? 'border-orange-400/60 bg-orange-500/10 text-orange-100' : 'border-white/5 bg-white/[0.03] text-slate-300 hover:border-white/15 hover:bg-white/[0.06]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black uppercase">{workshop.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{getDateLabel(workshop.date)} · {count} inscritos</p>
                    </div>
                    <Trash2 onClick={(event) => { event.stopPropagation(); deleteWorkshop(workshop); }} className="opacity-0 transition group-hover:opacity-100 hover:text-red-300" size={15} />
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <header className="mb-6 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/20 backdrop-blur-2xl">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-orange-300/20 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] text-orange-200"><Sparkles size={13} /> Gestor interno pro</div>
                <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{view === 'workshop' && activeWorkshop ? activeWorkshop.name : view === 'arrival' ? 'Orden de llegada' : 'Panel general de talleres'}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Control de inscritos, asistencia, pagos, búsqueda global, importación CSV desde Google Forms/Sheets y reportes PDF profesionales.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={exportPDF} className="flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white shadow-xl shadow-orange-500/20 hover:bg-orange-400"><Download size={16} /> PDF</button>
                <button onClick={logout} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 hover:bg-white/5"><LogOut size={16} /> Salir</button>
              </div>
            </div>
          </header>

          <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-5">
            <StatCard title="Inscritos" value={stats.attendees} detail={activeWorkshop ? 'En este taller' : `${activeWorkshops.length} talleres activos`} icon={<Users size={24} />} tone="slate" />
            <StatCard title="Asistencia" value={`${stats.present}/${stats.attendees}`} detail={`${stats.attendancePct}% de asistencia`} icon={<CheckCircle2 size={24} />} tone="cyan" />
            <StatCard title="No asistieron" value={stats.absent} detail="Inscritos ausentes" icon={<UserRoundX size={24} />} tone="red" />
            <StatCard title="Pagaron" value={stats.paid} detail={`${stats.pending} pendientes`} icon={<Wallet size={24} />} tone="emerald" />
            <StatCard title="Recaudado" value={money.format(stats.collected)} detail="Pagos marcados" icon={<Download size={24} />} tone="orange" />
          </section>

          {view === 'dashboard' && (
            <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-7 shadow-2xl shadow-black/20 backdrop-blur-xl">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[1.7rem] bg-orange-500/10 text-orange-200 shadow-2xl shadow-orange-500/20"><Flame size={40} /></div>
                <h3 className="text-3xl font-black text-white">Centro de talleres GEMB</h3>
                <p className="mt-3 max-w-3xl text-slate-400">Crea varios talleres, importa respuestas de Google Forms desde Google Sheets en CSV, marca asistencia en vivo, controla pagos y genera reportes bonitos para archivo interno.</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Google Forms</p><p className="mt-2 text-sm text-slate-300">Descarga respuestas como CSV y súbelas a un taller.</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Búsqueda global</p><p className="mt-2 text-sm text-slate-300">Encuentra personas por nombre, correo, celular o documento.</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-500">PDF pro</p><p className="mt-2 text-sm text-slate-300">Resumen, asistentes, ausentes, pagos y recaudo.</p></div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
                <p className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-slate-400">Buscador global</p>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Buscar por nombre, correo, celular o documento" className="w-full rounded-2xl border border-white/10 bg-black/30 py-4 pl-12 pr-4 text-sm outline-none focus:border-orange-400" />
                </div>
                <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                  {globalSearch && globalResults.length === 0 && <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">No encontré coincidencias.</p>}
                  {!globalSearch && <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">Escribe un nombre para ver en qué taller está, si pagó y si asistió.</p>}
                  {globalResults.map((attendee) => (
                    <div key={attendee.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate font-black uppercase text-white">{attendee.name}</p><p className="mt-1 truncate text-xs text-slate-400">{attendee.workshopName}</p></div>
                        <div className="flex gap-1"><SmallPill tone={attendee.attended ? 'cyan' : 'red'}>{attendee.attended ? 'Asistió' : 'Ausente'}</SmallPill><SmallPill tone={attendee.paid ? 'emerald' : 'orange'}>{attendee.paid ? 'Pagó' : 'Pendiente'}</SmallPill></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {view === 'arrival' && (
            <section className="space-y-3">
              {arrivalList.length === 0 ? <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-10 text-center text-slate-400">Aún no hay asistentes marcados en sala.</div> : arrivalList.map((attendee, index) => (
                <div key={attendee.id} className="flex items-center gap-4 rounded-[1.5rem] border border-cyan-400/20 bg-white/[0.045] p-4 shadow-lg shadow-cyan-500/5 backdrop-blur-xl">
                  <div className="w-14 text-center text-3xl font-black text-cyan-300">{index + 1}</div>
                  <div className="min-w-0 flex-1"><p className="truncate font-black uppercase text-white">{attendee.name}</p><p className="truncate text-xs font-bold uppercase tracking-wide text-slate-400">{attendee.workshopName}</p></div>
                  <div className="rounded-2xl border border-cyan-400/20 bg-black/30 px-4 py-2 font-mono text-cyan-200">{getTime(attendee.checkInTime)}</div>
                </div>
              ))}
            </section>
          )}

          {view === 'workshop' && activeWorkshop && (
            <section className="space-y-5">
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
                <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-200">Ficha del taller</p>
                    <h3 className="mt-1 text-2xl font-black text-white">{activeWorkshop.name}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={addAttendee} className="flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white hover:bg-orange-400"><Plus size={16} /> Nuevo asistente</button>
                    <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 hover:bg-white/5"><Upload size={16} /> Importar CSV</button>
                    <button onClick={() => updateWorkshop(activeWorkshop.id, { isArchived: !activeWorkshop.isArchived })} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 hover:bg-white/5"><Archive size={16} /> Finalizar</button>
                    <button onClick={clearActiveList} className="flex items-center gap-2 rounded-2xl border border-red-500/30 px-4 py-3 text-sm font-black text-red-300 hover:bg-red-500/10"><Trash2 size={16} /> Limpiar</button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Field label="Fecha"><TextInput type="date" value={activeWorkshop.date || ''} onChange={(event) => updateWorkshop(activeWorkshop.id, { date: event.target.value })} /></Field>
                  <Field label="Hora"><TextInput type="time" value={activeWorkshop.time || ''} onChange={(event) => updateWorkshop(activeWorkshop.id, { time: event.target.value })} /></Field>
                  <Field label="Lugar"><TextInput value={activeWorkshop.location || ''} onChange={(event) => updateWorkshop(activeWorkshop.id, { location: event.target.value })} placeholder="Sede / ciudad" /></Field>
                  <Field label="Valor"><TextInput type="number" value={activeWorkshop.basePrice || ''} onChange={(event) => updateWorkshop(activeWorkshop.id, { basePrice: Number(event.target.value || 0) })} placeholder="0" /></Field>
                  <Field label="Cupo"><TextInput type="number" value={activeWorkshop.capacity || ''} onChange={(event) => updateWorkshop(activeWorkshop.id, { capacity: Number(event.target.value || 0) })} placeholder="0" /></Field>
                </div>
              </div>

              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => event.target.files?.[0] && handleImport(event.target.files[0]).finally(() => { event.currentTarget.value = ''; })} />

              <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input value={attendeeSearch} onChange={(event) => setAttendeeSearch(event.target.value)} placeholder="Buscar por nombre, correo, celular o documento" className="w-full rounded-2xl border border-white/10 bg-black/30 py-4 pl-12 pr-4 outline-none focus:border-orange-400" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'present', 'absent', 'paid', 'unpaid'] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-2xl px-4 py-3 text-xs font-black uppercase ${filter === item ? 'bg-orange-500 text-white' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>{item === 'all' ? 'Todos' : item === 'present' ? 'Asistieron' : item === 'absent' ? 'No fueron' : item === 'paid' ? 'Pagaron' : 'Pendientes'}</button>)}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/20 backdrop-blur-xl">
                <div className="hidden grid-cols-12 border-b border-white/10 bg-black/30 px-5 py-4 text-xs font-black uppercase tracking-wide text-slate-400 xl:grid">
                  <div className="col-span-3">Participante</div><div className="col-span-2">Contacto</div><div className="col-span-2 text-center">Asistencia</div><div className="col-span-2 text-center">Pago</div><div className="col-span-2 text-right">Valor</div><div className="col-span-1" />
                </div>
                {filteredAttendees.length === 0 ? (
                  <div className="p-10 text-center text-slate-500"><FileSpreadsheet className="mx-auto mb-3" size={44} />Importa un CSV o agrega asistentes manualmente.</div>
                ) : filteredAttendees.map((attendee) => (
                  <div key={attendee.id} className="grid grid-cols-1 gap-3 border-b border-white/5 p-4 last:border-b-0 hover:bg-white/[0.03] xl:grid-cols-12 xl:items-center">
                    <div className="col-span-3 min-w-0">
                      {editingName === attendee.id ? <TextInput autoFocus value={tempName} onChange={(event) => setTempName(event.target.value)} onBlur={() => saveAttendeeName(attendee)} onKeyDown={(event) => event.key === 'Enter' && saveAttendeeName(attendee)} className="uppercase" /> : <button onClick={() => { setEditingName(attendee.id); setTempName(attendee.name); }} className="truncate text-left font-black uppercase text-white hover:text-orange-300">{attendee.name}</button>}
                      <p className="mt-1 text-xs text-slate-500">{attendee.documentId || attendee.registrationSource || 'manual'}</p>
                    </div>
                    <div className="col-span-2 min-w-0 text-xs text-slate-400"><p className="truncate">{attendee.phone || 'Sin celular'}</p><p className="truncate">{attendee.email || 'Sin correo'}</p></div>
                    <div className="col-span-2 text-left xl:text-center"><button onClick={() => toggleAttendance(attendee)} className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${attendee.attended ? 'bg-cyan-500/15 text-cyan-200' : 'border border-white/10 text-slate-500'}`}>{attendee.attended ? `Asistió ${getTime(attendee.checkInTime)}` : 'No asistió'}</button></div>
                    <div className="col-span-2 text-left xl:text-center"><button onClick={() => updateAttendee(attendee.id, { paid: !attendee.paid, amount: !attendee.paid && !attendee.amount ? Number(activeWorkshop.basePrice || 0) : attendee.amount })} className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${attendee.paid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{attendee.paid ? 'Pagado' : 'Pendiente'}</button></div>
                    <div className="col-span-2"><TextInput type="number" min="0" value={attendee.paid ? attendee.amount || '' : ''} disabled={!attendee.paid} onChange={(event) => updateAttendee(attendee.id, { amount: Number(event.target.value || 0) })} className="text-right font-mono disabled:opacity-30" placeholder="0" /></div>
                    <div className="col-span-1 text-right"><button onClick={() => deleteAttendee(attendee)} className="rounded-xl p-3 text-red-300 hover:bg-red-500/10"><Trash2 size={16} /></button></div>
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
