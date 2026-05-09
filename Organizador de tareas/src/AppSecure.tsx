import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
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
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cloud,
  Crown,
  Download,
  FileSpreadsheet,
  Gauge,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  Users,
  Wallet,
  XCircle,
  Zap,
} from 'lucide-react';
import { PremiumShell } from './components/layout/PremiumShell';
import { EmptyState } from './components/ui/EmptyState';
import { GlassPanel } from './components/ui/GlassPanel';
import { Logo } from './components/ui/Logo';
import { MetricCard } from './components/ui/MetricCard';
import { PremiumButton } from './components/ui/PremiumButton';

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
const getTime = (value: number | null) => (value ? new Date(value).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '--:--');
const safeText = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);
const getPct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

const filterLabels: Record<Filter, string> = {
  all: 'Todos',
  paid: 'Pagaron',
  unpaid: 'Pendientes',
  present: 'En sala',
  absent: 'Ausentes',
};

function Toast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;

  const tone =
    notice.type === 'success'
      ? 'border-emerald-300/30 bg-emerald-950/92 text-emerald-50'
      : notice.type === 'error'
        ? 'border-red-300/30 bg-red-950/92 text-red-50'
        : 'border-amber-300/30 bg-slate-950/92 text-amber-50';
  const Icon = notice.type === 'success' ? CheckCircle2 : notice.type === 'error' ? AlertTriangle : Sparkles;

  return (
    <div className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-lg border px-5 py-4 text-sm shadow-2xl backdrop-blur ${tone}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 shrink-0" size={20} />
        <div>
          <p className="font-black">{notice.type === 'success' ? 'Listo' : notice.type === 'error' ? 'Revisar' : 'Aviso'}</p>
          <p className="mt-1 leading-5 opacity-90">{notice.message}</p>
          <button type="button" onClick={onClose} className="mt-3 text-xs font-black text-white underline decoration-amber-200/40 underline-offset-4">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`premium-input px-4 py-3 text-sm font-semibold ${className}`} />;
}

function StatusBadge({
  children,
  icon,
  tone = 'neutral',
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'gold' | 'cyan' | 'success' | 'danger';
}) {
  const className =
    tone === 'success'
      ? 'border-emerald-300/24 bg-emerald-400/12 text-emerald-100'
      : tone === 'danger'
        ? 'border-red-300/24 bg-red-400/12 text-red-100'
        : tone === 'cyan'
          ? 'border-cyan-300/24 bg-cyan-400/12 text-cyan-100'
          : tone === 'gold'
            ? 'border-amber-300/28 bg-amber-300/12 text-amber-100'
            : 'border-white/10 bg-white/[0.045] text-slate-300';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold ${className}`}>
      {icon}
      {children}
    </span>
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

async function loadImageDataUrl(src: string) {
  const response = await fetch(src);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
    await runSafe(
      'create-workshop',
      async () => {
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
      },
      'Taller creado correctamente.',
    );
  };

  const updateWorkshop = async (id: string, updates: Partial<Workshop>) => {
    const title = updates.name ? `TALLER: ${updates.name}` : undefined;
    await updateDoc(doc(db, RECORDS_COLLECTION, id), { ...updates, ...(title ? { title } : {}), updatedAt: nowIso() });
  };

  const addAttendee = async () => {
    if (!activeWorkshop) return;
    await runSafe(
      'add-attendee',
      async () => {
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
      },
      'Asistente creado.',
    );
  };

  const updateAttendee = async (id: string, updates: Partial<Attendee>) => {
    const title = updates.name ? `ASISTENTE: ${updates.name}` : undefined;
    await updateDoc(doc(db, RECORDS_COLLECTION, id), { ...updates, ...(title ? { title } : {}), updatedAt: nowIso() });
  };

  const saveAttendeeName = async (attendee: Attendee) => {
    const name = cleanName(tempName || attendee.name);
    const duplicate = activeAttendees.some((row) => row.id !== attendee.id && normalize(row.name) === normalize(name));
    if (duplicate && !window.confirm(`El nombre "${name}" ya existe. ¿Guardarlo de todos modos?`)) return;
    await runSafe(
      `save-${attendee.id}`,
      async () => {
        await updateAttendee(attendee.id, { name });
        setEditingName(null);
      },
      'Nombre actualizado.',
    );
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
    await runSafe(
      `delete-workshop-${workshop.id}`,
      async () => {
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
      },
      'Taller eliminado.',
    );
  };

  const clearActiveList = async () => {
    if (!activeWorkshop || !window.confirm('¿Vaciar todos los asistentes de este taller?')) return;
    await runSafe(
      'clear-list',
      async () => {
        for (const group of chunk(activeAttendees)) {
          const batch = writeBatch(db);
          group.forEach((attendee) => batch.delete(doc(db, RECORDS_COLLECTION, attendee.id)));
          await batch.commit();
        }
      },
      'Lista vaciada correctamente.',
    );
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
          paid: false,
          amount: 0,
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
      if (
        !window.confirm(
          `Vista previa de importación\n\nTaller: ${activeWorkshop.name}\nNuevos: ${imported.length}\nDuplicados omitidos: ${duplicates}\nInválidos omitidos: ${invalid}\n\nPagos: siempre PENDIENTE\nValor: siempre 0\n\n¿Importar ahora?`,
        )
      ) {
        return;
      }

      for (const group of chunk(imported)) {
        const batch = writeBatch(db);
        group.forEach((row) => {
          const ref = doc(collection(db, RECORDS_COLLECTION));
          batch.set(ref, {
            ...legacyTaskShape(`ASISTENTE: ${row.name}`, user?.uid),
            kind: 'gemb_attendee',
            workshopId: activeWorkshop.id,
            ...row,
            paid: false,
            amount: 0,
            registrationSource: 'google-forms-csv',
            attended: false,
            checkInTime: null,
          });
        });
        await batch.commit();
      }
      setNotice({ type: 'success', message: `Importación terminada. Agregados: ${imported.length}. Duplicados: ${duplicates}. Inválidos: ${invalid}. Pagos pendientes y valor 0.` });
    });
  };

  const exportPDF = async () => {
    await runSafe(
      'export-pdf',
      async () => {
        const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
        const autoTable = autoTableModule.default;
        const logoDataUrl = await loadImageDataUrl('/logo-gemb-symbol.png').catch(() => null);
        const targets = activeWorkshop ? [activeWorkshop] : activeWorkshops;
        const pdf = new jsPDF();
        targets.forEach((workshop, index) => {
          if (index > 0) pdf.addPage();
          const rows = attendees.filter((attendee) => attendee.workshopId === workshop.id).sort((a, b) => a.name.localeCompare(b.name));
          const present = rows.filter((attendee) => attendee.attended).length;
          const paid = rows.filter((attendee) => attendee.paid);
          const total = paid.reduce((sum, attendee) => sum + Number(attendee.amount || 0), 0);

          pdf.setFillColor(3, 5, 11);
          pdf.rect(0, 0, 210, 297, 'F');

          pdf.setDrawColor(205, 153, 56);
          pdf.setFillColor(12, 16, 27);
          pdf.roundedRect(12, 12, 186, 42, 4, 4, 'FD');
          if (logoDataUrl) pdf.addImage(logoDataUrl, 'PNG', 16, 17, 34, 20);
          pdf.setTextColor(255, 247, 237);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(14);
          pdf.text('GIMNASIO EMOCIONAL MENTES BRILLANTES', logoDataUrl ? 54 : 18, 27);
          pdf.setFontSize(10);
          pdf.setTextColor(246, 214, 125);
          pdf.text('REPORTE DE TALLERES Y ASISTENCIA', logoDataUrl ? 54 : 18, 36);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor(203, 213, 225);
          pdf.text(`Generado: ${new Date().toLocaleString('es-CO')}`, logoDataUrl ? 54 : 18, 44);

          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(16);
          pdf.setTextColor(255, 255, 255);
          pdf.text(workshop.name, 14, 68);

          const metrics = [
            ['Registrados', String(rows.length)],
            ['Asistieron', String(present)],
            ['Pagaron', String(paid.length)],
            ['Recaudado', money.format(total)],
          ];
          metrics.forEach(([label, value], metricIndex) => {
            const x = 14 + metricIndex * 46;
            pdf.setDrawColor(101, 76, 28);
            pdf.setFillColor(18, 24, 38);
            pdf.roundedRect(x, 78, 42, 20, 3, 3, 'FD');
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(7);
            pdf.setTextColor(203, 213, 225);
            pdf.text(label, x + 3, 85);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(metricIndex === 3 ? 9 : 13);
            pdf.setTextColor(246, 214, 125);
            pdf.text(value, x + 3, 94);
          });

          autoTable(pdf, {
            startY: 108,
            head: [['Participante', 'Contacto', 'Asistencia', 'Hora', 'Pago', 'Valor']],
            body: rows.map((attendee) => [attendee.name, [attendee.phone, attendee.email].filter(Boolean).join(' | '), attendee.attended ? 'SI' : 'NO', getTime(attendee.checkInTime), attendee.paid ? 'PAGADO' : 'PENDIENTE', money.format(Number(attendee.amount || 0))]),
            styles: { fontSize: 7, cellPadding: 2.2, lineColor: [224, 214, 190], lineWidth: 0.1, textColor: [18, 24, 38] },
            headStyles: { fillColor: [166, 97, 7], textColor: [255, 247, 237], fontStyle: 'bold' },
            bodyStyles: { fillColor: [255, 252, 244] },
            alternateRowStyles: { fillColor: [247, 241, 229] },
            margin: { left: 14, right: 14 },
          });
          const pageCount = pdf.getNumberOfPages();
          for (let page = 1; page <= pageCount; page += 1) {
            pdf.setPage(page);
            pdf.setFontSize(8);
            pdf.setTextColor(170, 170, 170);
            pdf.text(`Página ${page} de ${pageCount}`, 196, 288, { align: 'right' });
          }
        });
        pdf.save(activeWorkshop ? `${activeWorkshop.name.replace(/[^a-z0-9]/gi, '_')}_reporte.pdf` : 'reporte_global_talleres_gemb.pdf');
      },
      'Reporte PDF generado.',
    );
  };

  const openDashboard = () => {
    setView('dashboard');
    setActiveWorkshopId(null);
  };

  const openWorkshop = (workshop: Workshop) => {
    setActiveWorkshopId(workshop.id);
    setView('workshop');
  };

  const sidebar = (
    <aside className="hidden w-[21rem] shrink-0 border-r border-amber-200/10 bg-slate-950/58 p-5 shadow-[18px_0_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl lg:flex lg:flex-col">
      <div className="rounded-lg border border-amber-200/18 bg-black/18 p-4">
        <Logo variant="full" className="mx-auto h-40 w-full" />
      </div>

      <nav className="mt-5 space-y-2" aria-label="Navegación principal">
        <button
          onClick={openDashboard}
          className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 ${
            view === 'dashboard' ? 'border-amber-300/50 bg-amber-300/12 text-amber-50 shadow-[0_14px_36px_rgba(246,182,52,0.14)]' : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.055] hover:text-white'
          }`}
        >
          <LayoutDashboard size={19} />
          Panel general
        </button>
        <button
          onClick={() => {
            setView('arrival');
            setActiveWorkshopId(null);
          }}
          className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 ${
            view === 'arrival' ? 'border-cyan-300/45 bg-cyan-300/12 text-cyan-50 shadow-[0_14px_36px_rgba(34,211,238,0.12)]' : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.055] hover:text-white'
          }`}
        >
          <Clock3 size={19} />
          Orden de llegada
        </button>
      </nav>

      <div className="my-5 h-px gold-divider" />

      <GlassPanel tone="gold" className="p-4" padded={false}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-amber-100">Nuevo taller</p>
            <p className="mt-1 text-xs text-slate-400">Crea la lista base para inscripción y asistencia.</p>
          </div>
          <Crown className="shrink-0 text-amber-200" size={22} />
        </div>
        <div className="flex gap-2">
          <TextInput
            value={newWorkshopName}
            onChange={(event) => setNewWorkshopName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && createWorkshop()}
            placeholder="Nombre del taller"
            className="uppercase"
            disabled={busy === 'create-workshop'}
          />
          <PremiumButton aria-label="Crear nuevo taller" disabled={busy === 'create-workshop'} onClick={createWorkshop} icon={busy === 'create-workshop' ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} variant="primary" />
        </div>
      </GlassPanel>

      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
        <input value={workshopSearch} onChange={(event) => setWorkshopSearch(event.target.value)} placeholder="Buscar taller" className="premium-input py-3 pl-10 pr-3 text-sm" />
      </div>

      <div className="premium-scrollbar mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {filteredWorkshops.map((workshop) => {
          const count = attendees.filter((attendee) => attendee.workshopId === workshop.id).length;
          return (
            <button
              key={workshop.id}
              onClick={() => openWorkshop(workshop)}
              className={`group w-full rounded-lg border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 ${
                activeWorkshopId === workshop.id && view === 'workshop' ? 'border-amber-300/48 bg-amber-300/12 text-amber-50' : 'border-white/8 bg-white/[0.035] text-slate-300 hover:border-amber-200/18 hover:bg-white/[0.06]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black uppercase">{workshop.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{count} asistentes</p>
                </div>
                <Trash2
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteWorkshop(workshop);
                  }}
                  className="shrink-0 opacity-0 transition group-hover:opacity-100 hover:text-red-300"
                  size={16}
                />
              </div>
            </button>
          );
        })}
        {!filteredWorkshops.length && <p className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">No hay talleres activos con ese nombre.</p>}
      </div>

      <GlassPanel className="mt-5 p-4" padded={false}>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-amber-200/24 bg-amber-300/10 text-sm font-black text-amber-50">
            {user?.displayName?.slice(0, 2).toUpperCase() || 'MB'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-white">{user?.displayName || 'Administrador'}</p>
            <p className="truncate text-xs text-slate-400">{user?.email || 'admin@gemb.com'}</p>
          </div>
        </div>
      </GlassPanel>
    </aside>
  );

  if (loading || loadingData) {
    return (
      <PremiumShell>
        <div className="flex min-h-screen flex-1 items-center justify-center p-6">
          <GlassPanel className="max-w-sm text-center" tone="gold">
            <Logo variant="symbol" className="mx-auto h-24 w-40" />
            <Loader2 className="mx-auto mt-5 h-10 w-10 animate-spin text-amber-200" />
            <p className="mt-4 text-sm font-bold text-slate-300">Preparando el panel GEMB...</p>
          </GlassPanel>
        </div>
      </PremiumShell>
    );
  }

  if (!user) return <Login />;

  if (error) {
    return (
      <PremiumShell>
        <div className="flex min-h-screen flex-1 items-center justify-center p-6">
          <GlassPanel tone="rose" className="max-w-md text-center">
            <AlertTriangle className="mx-auto mb-4 text-red-300" size={44} />
            <h1 className="text-xl font-black">Error de conexión con Firebase</h1>
            <p className="mt-2 text-sm leading-6 text-red-100/90">{error}</p>
            <PremiumButton onClick={() => window.location.reload()} className="mt-5" variant="danger">
              Recargar
            </PremiumButton>
          </GlassPanel>
        </div>
      </PremiumShell>
    );
  }

  return (
    <PremiumShell sidebar={sidebar}>
      <Toast notice={notice} onClose={() => setNotice(null)} />

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <section className="mb-5 lg:hidden">
          <GlassPanel className="space-y-4" tone="gold">
            <div className="flex items-center gap-3">
              <Logo variant="symbol" className="h-16 w-24 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-amber-100">Gimnasio Emocional</p>
                <h1 className="truncate text-xl font-black text-white">Mentes Brillantes</h1>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PremiumButton onClick={openDashboard} variant={view === 'dashboard' ? 'primary' : 'secondary'} icon={<LayoutDashboard size={16} />}>
                Panel
              </PremiumButton>
              <PremiumButton
                onClick={() => {
                  setView('arrival');
                  setActiveWorkshopId(null);
                }}
                variant={view === 'arrival' ? 'cyan' : 'secondary'}
                icon={<Clock3 size={16} />}
              >
                Orden de llegada
              </PremiumButton>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <TextInput value={newWorkshopName} onChange={(event) => setNewWorkshopName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createWorkshop()} placeholder="Nuevo taller" className="uppercase" />
              <PremiumButton disabled={busy === 'create-workshop'} onClick={createWorkshop} icon={busy === 'create-workshop' ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} variant="primary">
                Crear
              </PremiumButton>
            </div>
          </GlassPanel>
        </section>

        <header className="mb-6 overflow-hidden rounded-lg border border-amber-200/18 bg-white/[0.055] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.30)] backdrop-blur-2xl sm:p-7">
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 overflow-hidden lg:block" aria-hidden="true">
              <Logo variant="symbol" className="absolute right-6 top-1/2 h-48 w-72 -translate-y-1/2 opacity-18" />
              <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(3,5,11,0)_0%,rgba(246,182,52,0.16)_42%,rgba(255,247,237,0.10)_50%,rgba(246,182,52,0.08)_58%,rgba(3,5,11,0)_100%)]" />
            </div>
            <div className="relative max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-lg border border-amber-200/22 bg-amber-300/10 px-3 py-1.5 text-xs font-black uppercase text-amber-100">
                <Crown size={14} />
                Gestor interno premium
              </span>
              <h2 className="mt-4 text-3xl font-black leading-tight text-white sm:text-4xl">
                {view === 'workshop' && activeWorkshop ? activeWorkshop.name : view === 'arrival' ? 'Orden de llegada' : 'Panel general de talleres'}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Control integral de inscritos, asistencia, pagos manuales, búsqueda global, CSV de Google Forms y reportes PDF.</p>
            </div>
            <div className="relative flex flex-wrap gap-2">
              <PremiumButton disabled={busy === 'export-pdf'} onClick={exportPDF} icon={busy === 'export-pdf' ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />} variant="primary" size="lg">
                Exportar PDF
              </PremiumButton>
              <PremiumButton onClick={logout} icon={<LogOut size={16} />} variant="ghost" size="lg">
                Cerrar sesión
              </PremiumButton>
            </div>
          </div>
        </header>

        <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard title="Inscritos" value={stats.attendees} detail={activeWorkshop ? 'En este taller' : `${activeWorkshops.length} talleres activos`} icon={<Users size={23} />} tone="violet" progress={100} />
          <MetricCard title="Asistencia" value={`${stats.present}/${stats.attendees}`} detail={`${stats.attendancePct}% de asistencia`} icon={<CheckCircle2 size={23} />} tone="emerald" progress={stats.attendancePct} />
          <MetricCard title="No asistieron" value={stats.absent} detail="Inscritos ausentes" icon={<UserRoundX size={23} />} tone="rose" progress={stats.attendees ? getPct(stats.absent, stats.attendees) : 0} />
          <MetricCard title="Pagaron" value={stats.paid} detail={`${stats.pending} pendientes`} icon={<Wallet size={23} />} tone="cyan" progress={stats.attendees ? getPct(stats.paid, stats.attendees) : 0} />
          <MetricCard title="Recaudado" value={money.format(stats.collected)} detail="Pagos marcados" icon={<BarChart3 size={23} />} tone="gold" progress={stats.paid ? 100 : 0} />
        </section>

        {view === 'dashboard' && (
          <section className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[1.18fr_0.82fr]">
              <GlassPanel tone="gold" className="min-h-[21rem]">
                <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-center">
                  <div className="flex h-28 w-36 items-center justify-center rounded-lg border border-amber-200/18 bg-black/20">
                    <Logo variant="symbol" className="h-24 w-32" />
                  </div>
                  <div>
                    <p className="text-sm font-black uppercase text-amber-100">Centro de talleres GEMB</p>
                    <h3 className="mt-3 text-3xl font-black leading-tight text-white">Operación elegante para una experiencia humana y ordenada.</h3>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
                      Crea talleres, importa respuestas desde Google Forms, marca asistencia en vivo, controla pagos manuales y genera reportes para archivo interno.
                    </p>
                  </div>
                </div>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  <PremiumButton icon={<FileSpreadsheet size={18} />} variant="secondary" size="lg" onClick={() => setNotice({ type: 'info', message: 'Elige o crea el taller exacto. Al importar, todos los pagos quedan pendientes y con valor 0.' })}>
                    Importar Google Forms CSV
                  </PremiumButton>
                  <PremiumButton onClick={exportPDF} icon={<BarChart3 size={18} />} variant="primary" size="lg">
                    Exportar reporte global
                  </PremiumButton>
                </div>
              </GlassPanel>

              <GlassPanel>
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-amber-200/22 bg-amber-300/10 text-amber-100">
                    <Search size={27} />
                  </div>
                  <div>
                    <p className="text-sm font-black uppercase text-amber-100">Buscador global</p>
                    <h3 className="text-xl font-black text-white">Encuentra personas en segundos</h3>
                  </div>
                </div>
                <div className="relative mt-5">
                  <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Buscar por nombre, correo, celular o documento" className="premium-input py-4 pl-12 pr-12 text-sm" />
                  <SlidersHorizontal className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                </div>
                <div className="premium-scrollbar mt-5 max-h-[23rem] space-y-3 overflow-y-auto pr-1">
                  {globalResults.length ? (
                    globalResults.map((item) => (
                      <article key={item.id} className="rounded-lg border border-white/10 bg-black/18 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-black uppercase text-white">{item.name}</p>
                            <p className="mt-1 truncate text-xs text-slate-400">{item.workshopName}</p>
                          </div>
                          <ChevronRight className="shrink-0 text-amber-200" size={18} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <StatusBadge tone={item.paid ? 'success' : 'danger'}>{item.paid ? 'Pagó' : 'Pago pendiente'}</StatusBadge>
                          <StatusBadge tone={item.attended ? 'cyan' : 'neutral'}>{item.attended ? 'Asistió' : 'No asistió'}</StatusBadge>
                        </div>
                      </article>
                    ))
                  ) : (
                    <EmptyState icon={<Sparkles size={22} />} title="Búsqueda lista" description="Escribe un nombre para ver en qué taller está, si pagó y si asistió." />
                  )}
                </div>
              </GlassPanel>
            </div>

            <GlassPanel className="p-0" padded={false}>
              <div className="grid divide-y divide-white/10 md:grid-cols-4 md:divide-x md:divide-y-0">
                {[
                  { title: 'Datos seguros', detail: 'Información protegida con Firebase y acceso autenticado.', icon: <ShieldCheck size={23} /> },
                  { title: 'Acceso en la nube', detail: 'Gestiona talleres desde cualquier equipo autorizado.', icon: <Cloud size={23} /> },
                  { title: 'Tiempo real', detail: 'Asistencia y pagos sincronizados al instante.', icon: <Zap size={23} /> },
                  { title: 'Reportes claros', detail: 'PDF listo para archivo y seguimiento interno.', icon: <Gauge size={23} /> },
                ].map((item) => (
                  <div key={item.title} className="flex gap-4 p-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-amber-200/18 bg-amber-300/10 text-amber-100">{item.icon}</div>
                    <div>
                      <p className="font-black text-white">{item.title}</p>
                      <p className="mt-1 text-sm leading-5 text-slate-400">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GlassPanel>
          </section>
        )}

        {view === 'arrival' && (
          <section className="space-y-4">
            <GlassPanel tone="cyan">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black uppercase text-cyan-100">Modo portería</p>
                  <h3 className="mt-2 text-2xl font-black text-white">Llegadas en vivo</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">Usa Orden de llegada para buscar asistentes y marcarlos al entrar. Los marcados aparecen ordenados por hora.</p>
                </div>
                <PremiumButton icon={<Clock3 size={17} />} variant="cyan" size="lg">
                  Abrir Orden de llegada
                </PremiumButton>
              </div>
            </GlassPanel>
            {arrivalList.length ? (
              <div className="space-y-3">
                {arrivalList.map((attendee, index) => (
                  <GlassPanel key={attendee.id} className="p-4" tone="cyan" padded={false}>
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-cyan-200/24 bg-cyan-300/12 text-lg font-black text-cyan-100">{index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-black uppercase text-white">{attendee.name}</p>
                        <p className="truncate text-xs font-bold uppercase text-slate-400">{attendee.workshopName}</p>
                      </div>
                      <StatusBadge tone="cyan" icon={<Clock3 size={14} />}>
                        {getTime(attendee.checkInTime)}
                      </StatusBadge>
                    </div>
                  </GlassPanel>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Clock3 size={24} />} title="Aún no hay llegadas marcadas" description="Abre el modo portería y marca asistentes en vivo para construir el orden de llegada." />
            )}
          </section>
        )}

        {view === 'workshop' && activeWorkshop && (
          <section className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
              <GlassPanel>
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black uppercase text-amber-100">Ficha del taller</p>
                    <h3 className="mt-2 text-2xl font-black text-white">{activeWorkshop.name}</h3>
                  </div>
                  <StatusBadge tone={activeWorkshop.isArchived ? 'neutral' : 'success'}>{activeWorkshop.isArchived ? 'Finalizado' : 'Activo'}</StatusBadge>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-400">
                      <CalendarDays size={14} />
                      Fecha
                    </span>
                    <TextInput type="date" value={activeWorkshop.date || ''} onChange={(event) => runSafe('workshop-date', () => updateWorkshop(activeWorkshop.id, { date: event.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-400">
                      <Clock3 size={14} />
                      Hora
                    </span>
                    <TextInput type="time" value={activeWorkshop.time || ''} onChange={(event) => runSafe('workshop-time', () => updateWorkshop(activeWorkshop.id, { time: event.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-400">
                      <MapPin size={14} />
                      Lugar
                    </span>
                    <TextInput placeholder="Lugar" value={activeWorkshop.location || ''} onChange={(event) => runSafe('workshop-location', () => updateWorkshop(activeWorkshop.id, { location: event.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-400">
                      <Wallet size={14} />
                      Precio base
                    </span>
                    <TextInput placeholder="0" type="number" value={activeWorkshop.basePrice || ''} onChange={(event) => runSafe('workshop-price', () => updateWorkshop(activeWorkshop.id, { basePrice: Number(event.target.value || 0) }))} />
                  </label>
                </div>
              </GlassPanel>

              <GlassPanel tone="gold">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-amber-200/24 bg-amber-300/10 text-amber-100">
                    <Upload size={25} />
                  </div>
                  <div>
                    <p className="text-sm font-black uppercase text-amber-100">Importador CSV</p>
                    <h3 className="mt-2 text-xl font-black text-white">Google Forms sin pagos inventados</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">Cada persona importada entra con pago pendiente y valor 0. Los recaudos se marcan manualmente dentro del taller.</p>
                  </div>
                </div>
                <PremiumButton className="mt-5 w-full" disabled={busy === 'import-csv'} onClick={() => fileInputRef.current?.click()} icon={busy === 'import-csv' ? <Loader2 className="animate-spin" size={17} /> : <FileSpreadsheet size={17} />} variant="primary" size="lg">
                  Importar CSV
                </PremiumButton>
              </GlassPanel>
            </div>

            <GlassPanel>
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                  <input value={attendeeSearch} onChange={(event) => setAttendeeSearch(event.target.value)} placeholder="Buscar asistente por nombre, correo, celular o documento" className="premium-input py-3 pl-10 pr-3 text-sm" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'paid', 'unpaid', 'present', 'absent'] as const).map((item) => (
                    <PremiumButton key={item} onClick={() => setFilter(item)} variant={filter === item ? 'primary' : 'ghost'} size="sm">
                      {filterLabels[item]}
                    </PremiumButton>
                  ))}
                </div>
              </div>
            </GlassPanel>

            <div className="flex flex-wrap gap-2">
              <PremiumButton onClick={addAttendee} disabled={busy === 'add-attendee'} icon={<UserPlus size={16} />} variant="primary">
                Nuevo asistente
              </PremiumButton>
              <PremiumButton onClick={() => fileInputRef.current?.click()} disabled={busy === 'import-csv'} icon={busy === 'import-csv' ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} variant="secondary">
                Importar CSV
              </PremiumButton>
              <PremiumButton onClick={() => runSafe('archive', () => updateWorkshop(activeWorkshop.id, { isArchived: !activeWorkshop.isArchived }), activeWorkshop.isArchived ? 'Taller reactivado.' : 'Taller finalizado.')} icon={<CheckCircle2 size={16} />} variant="ghost">
                {activeWorkshop.isArchived ? 'Reactivar' : 'Finalizar'}
              </PremiumButton>
              <PremiumButton onClick={clearActiveList} icon={<Trash2 size={16} />} variant="danger">
                Limpiar lista
              </PremiumButton>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                event.target.files?.[0] &&
                handleImport(event.target.files[0]).finally(() => {
                  event.currentTarget.value = '';
                })
              }
            />

            <GlassPanel className="hidden p-0 md:block" padded={false}>
              <div className="grid grid-cols-12 gap-3 border-b border-white/10 bg-black/20 px-4 py-3 text-xs font-black uppercase text-slate-400">
                <div className="col-span-5">Participante</div>
                <div className="col-span-2 text-center">Asistencia</div>
                <div className="col-span-2 text-center">Pago</div>
                <div className="col-span-2 text-right">Valor</div>
                <div className="col-span-1" />
              </div>
              {filteredAttendees.length ? (
                filteredAttendees.map((attendee) => (
                  <div key={attendee.id} className="grid grid-cols-12 items-center gap-3 border-b border-white/6 px-4 py-3 last:border-b-0 hover:bg-white/[0.035]">
                    <div className="col-span-5 min-w-0">
                      {editingName === attendee.id ? (
                        <input
                          autoFocus
                          value={tempName}
                          onChange={(event) => setTempName(event.target.value)}
                          onBlur={() => saveAttendeeName(attendee)}
                          onKeyDown={(event) => event.key === 'Enter' && saveAttendeeName(attendee)}
                          className="premium-input px-3 py-2 font-bold uppercase"
                        />
                      ) : (
                        <button
                          onClick={() => {
                            setEditingName(attendee.id);
                            setTempName(attendee.name);
                          }}
                          className="block max-w-full truncate text-left font-black uppercase text-white hover:text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                        >
                          {attendee.name}
                        </button>
                      )}
                      <p className="mt-1 truncate text-xs text-slate-500">{[attendee.phone, attendee.email, attendee.documentId].filter(Boolean).join(' | ') || 'Sin contacto registrado'}</p>
                    </div>
                    <div className="col-span-2 text-center">
                      <button onClick={() => toggleAttendance(attendee)} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200">
                        <StatusBadge tone={attendee.attended ? 'cyan' : 'neutral'} icon={attendee.attended ? <CheckCircle2 size={14} /> : <XCircle size={14} />}>
                          {attendee.attended ? 'En sala' : 'Ausente'}
                        </StatusBadge>
                      </button>
                    </div>
                    <div className="col-span-2 text-center">
                      <button onClick={() => runSafe(`paid-${attendee.id}`, () => updateAttendee(attendee.id, { paid: !attendee.paid, amount: !attendee.paid && !attendee.amount ? Number(activeWorkshop.basePrice || 0) : attendee.amount }))} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200">
                        <StatusBadge tone={attendee.paid ? 'success' : 'danger'}>{attendee.paid ? 'Pagado' : 'Pendiente'}</StatusBadge>
                      </button>
                    </div>
                    <div className="col-span-2">
                      <input type="number" min="0" value={attendee.paid ? attendee.amount || '' : ''} disabled={!attendee.paid} onChange={(event) => runSafe(`amount-${attendee.id}`, () => updateAttendee(attendee.id, { amount: Number(event.target.value || 0) }))} className="premium-input px-3 py-2 text-right font-mono disabled:opacity-35" placeholder="0" />
                    </div>
                    <div className="col-span-1 text-right">
                      <button onClick={() => deleteAttendee(attendee)} className="rounded-lg p-2 text-red-300 transition hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-200" aria-label={`Eliminar a ${attendee.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8">
                  <EmptyState icon={<UserRoundCheck size={24} />} title="Lista lista para construir" description="Importa un CSV desde Google Forms o agrega asistentes manualmente. Los pagos importados siempre quedan pendientes y valor 0." />
                </div>
              )}
            </GlassPanel>

            <div className="space-y-3 md:hidden">
              {filteredAttendees.length ? (
                filteredAttendees.map((attendee) => (
                  <GlassPanel key={attendee.id} className="p-4" padded={false}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {editingName === attendee.id ? (
                          <input
                            autoFocus
                            value={tempName}
                            onChange={(event) => setTempName(event.target.value)}
                            onBlur={() => saveAttendeeName(attendee)}
                            onKeyDown={(event) => event.key === 'Enter' && saveAttendeeName(attendee)}
                            className="premium-input px-3 py-2 font-bold uppercase"
                          />
                        ) : (
                          <button
                            onClick={() => {
                              setEditingName(attendee.id);
                              setTempName(attendee.name);
                            }}
                            className="block max-w-full truncate text-left font-black uppercase text-white"
                          >
                            {attendee.name}
                          </button>
                        )}
                        <p className="mt-1 break-words text-xs leading-5 text-slate-500">{[attendee.phone, attendee.email, attendee.documentId].filter(Boolean).join(' | ') || 'Sin contacto registrado'}</p>
                      </div>
                      <button onClick={() => deleteAttendee(attendee)} className="rounded-lg p-2 text-red-300 transition hover:bg-red-500/10" aria-label={`Eliminar a ${attendee.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <PremiumButton onClick={() => toggleAttendance(attendee)} variant={attendee.attended ? 'cyan' : 'ghost'} size="sm" icon={attendee.attended ? <CheckCircle2 size={15} /> : <XCircle size={15} />}>
                        {attendee.attended ? 'En sala' : 'Ausente'}
                      </PremiumButton>
                      <PremiumButton onClick={() => runSafe(`paid-${attendee.id}`, () => updateAttendee(attendee.id, { paid: !attendee.paid, amount: !attendee.paid && !attendee.amount ? Number(activeWorkshop.basePrice || 0) : attendee.amount }))} variant={attendee.paid ? 'success' : 'danger'} size="sm">
                        {attendee.paid ? 'Pagado' : 'Pendiente'}
                      </PremiumButton>
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-2 block text-xs font-bold text-slate-400">Valor pagado</span>
                      <input type="number" min="0" value={attendee.paid ? attendee.amount || '' : ''} disabled={!attendee.paid} onChange={(event) => runSafe(`amount-${attendee.id}`, () => updateAttendee(attendee.id, { amount: Number(event.target.value || 0) }))} className="premium-input px-3 py-2 text-right font-mono disabled:opacity-35" placeholder="0" />
                    </label>
                  </GlassPanel>
                ))
              ) : (
                <EmptyState icon={<UserRoundCheck size={24} />} title="Lista lista para construir" description="Importa un CSV desde Google Forms o agrega asistentes manualmente. Los pagos importados siempre quedan pendientes y valor 0." />
              )}
            </div>
          </section>
        )}
      </main>
    </PremiumShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
