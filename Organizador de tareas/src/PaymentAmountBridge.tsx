import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { auth, db } from './lib/firebase';

const RECORDS_COLLECTION = 'tasks';
const MAX_AMOUNT = 50000000;

type AttendeePaymentRow = {
  id: string;
  kind: 'gemb_attendee';
  name: string;
  amount?: number;
  paid?: boolean;
};

const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

function normalize(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseAmount(value: string) {
  const onlyNumbers = value.replace(/[^0-9]/g, '');
  return Math.min(Number(onlyNumbers || 0), MAX_AMOUNT);
}

function setInputValue(input: HTMLInputElement, value: string) {
  if (nativeValueSetter) nativeValueSetter.call(input, value);
  else input.value = value;
  input.setAttribute('value', value);
}

function findAttendeeForInput(input: HTMLInputElement, attendees: AttendeePaymentRow[]) {
  let node: HTMLElement | null = input;
  let depth = 0;
  while (node && depth < 10) {
    const rowText = normalize(node.textContent);
    const match = attendees.find((attendee) => rowText.includes(normalize(attendee.name)));
    if (match) return match;
    node = node.parentElement;
    depth += 1;
  }
  return null;
}

function isEditablePaymentInput(target: EventTarget | null, attendees: AttendeePaymentRow[]) {
  if (!(target instanceof HTMLInputElement)) return null;
  const input = target;
  const attendee = findAttendeeForInput(input, attendees);
  if (!attendee) return null;
  return { input, attendee };
}

export function PaymentAmountBridge() {
  const [attendees, setAttendees] = useState<AttendeePaymentRow[]>([]);
  const attendeesRef = useRef<AttendeePaymentRow[]>([]);
  const savingTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    attendeesRef.current = attendees;
  }, [attendees]);

  useEffect(() => {
    let unsubscribeRecords: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeRecords?.();
      unsubscribeRecords = undefined;
      if (!user) {
        setAttendees([]);
        return;
      }

      unsubscribeRecords = onSnapshot(query(collection(db, RECORDS_COLLECTION), where('kind', '==', 'gemb_attendee')), (snapshot) => {
        setAttendees(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AttendeePaymentRow[]);
      });
    });

    return () => {
      unsubscribeRecords?.();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    async function saveAmount(attendeeId: string, rawValue: string) {
      const amount = parseAmount(rawValue);
      await updateDoc(doc(db, RECORDS_COLLECTION, attendeeId), {
        amount,
        paid: amount > 0,
        updatedAt: new Date().toISOString(),
      });
    }

    function scheduleSave(attendeeId: string, rawValue: string, delay = 500) {
      window.clearTimeout(savingTimers.current[attendeeId]);
      savingTimers.current[attendeeId] = window.setTimeout(() => {
        void saveAmount(attendeeId, rawValue).catch((error) => console.error('No se pudo guardar el pago', error));
      }, delay);
    }

    function preparePaymentInputs() {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"], input[data-gemb-payment-input="true"]'));
      for (const input of inputs) {
        const match = isEditablePaymentInput(input, attendeesRef.current);
        if (!match) continue;

        input.disabled = false;
        input.readOnly = false;
        input.removeAttribute('disabled');
        input.removeAttribute('readonly');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.dataset.gembPaymentInput = 'true';
        input.autocomplete = 'off';
        input.placeholder = '0';
        input.title = 'Escribe el valor pagado y presiona Enter o sal del campo. Mayor a 0 queda PAGADO; 0 queda PENDIENTE.';
      }
    }

    function onFocusIn(event: FocusEvent) {
      const match = isEditablePaymentInput(event.target, attendeesRef.current);
      if (!match) return;
      const { input } = match;
      preparePaymentInputs();
      if (input.value === '0') setInputValue(input, '');
    }

    function onKeyDown(event: KeyboardEvent) {
      const match = isEditablePaymentInput(event.target, attendeesRef.current);
      if (!match) return;
      const { input, attendee } = match;

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const navigationKeys = ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (navigationKeys.includes(event.key)) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        void saveAmount(attendee.id, input.value).catch((error) => console.error('No se pudo guardar el pago', error));
        input.blur();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setInputValue(input, String(Number(attendee.amount || 0)));
        input.blur();
        return;
      }

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        const current = input.value.replace(/[^0-9]/g, '');
        const next = current === '0' ? event.key : `${current}${event.key}`;
        const cleanNext = String(parseAmount(next));
        setInputValue(input, cleanNext);
        scheduleSave(attendee.id, cleanNext);
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        const current = input.value.replace(/[^0-9]/g, '');
        const next = current.slice(0, -1);
        setInputValue(input, next || '');
        scheduleSave(attendee.id, next || '0');
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        setInputValue(input, '');
        scheduleSave(attendee.id, '0');
        return;
      }

      event.preventDefault();
    }

    function onPaste(event: ClipboardEvent) {
      const match = isEditablePaymentInput(event.target, attendeesRef.current);
      if (!match) return;
      event.preventDefault();
      const pasted = event.clipboardData?.getData('text') || '';
      const amount = String(parseAmount(pasted));
      setInputValue(match.input, amount === '0' ? '' : amount);
      scheduleSave(match.attendee.id, amount, 100);
    }

    function onBlur(event: FocusEvent) {
      const match = isEditablePaymentInput(event.target, attendeesRef.current);
      if (!match) return;
      const amount = String(parseAmount(match.input.value));
      setInputValue(match.input, amount);
      scheduleSave(match.attendee.id, amount, 50);
    }

    preparePaymentInputs();
    const observer = new MutationObserver(preparePaymentInputs);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'type', 'value'] });
    const interval = window.setInterval(preparePaymentInputs, 750);

    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('focusout', onBlur, true);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      Object.values(savingTimers.current).forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('focusout', onBlur, true);
    };
  }, []);

  return null;
}
