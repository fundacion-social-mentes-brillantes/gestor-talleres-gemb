export type GembRecordKind = 'gemb_workshop' | 'gemb_attendee';
export type RegistrationSource = 'manual' | 'google-forms-csv';

export interface Workshop {
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
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Attendee {
  id: string;
  kind: 'gemb_attendee';
  workshopId: string;
  name: string;
  email?: string;
  phone?: string;
  documentId?: string;
  notes?: string;
  registrationSource?: RegistrationSource | string;
  paid: boolean;
  amount: number;
  attended: boolean;
  checkInTime: number | null;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type GembRecord = Workshop | Attendee;

export interface ImportAttendeeInput {
  name: string;
  email: string;
  phone: string;
  documentId: string;
  paid: boolean;
  amount: number;
  notes: string;
}

export interface ImportInvalidRow {
  rowNumber: number;
  reason: string;
  raw: string[];
}

export interface ImportPreview {
  validRows: ImportAttendeeInput[];
  invalidRows: ImportInvalidRow[];
  duplicateRows: ImportAttendeeInput[];
}
