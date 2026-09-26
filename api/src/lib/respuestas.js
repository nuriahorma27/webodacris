import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { TableClient } from '@azure/data-tables';
import * as XLSX from 'xlsx';

export const COLUMNS = [
  ['fecha', 'Fecha'],
  ['nombre', 'Nombre'],
  ['apellidos', 'Apellidos'],
  ['direccion', 'Dirección'],
  ['asistencia', '¿Asiste?'],
  ['acompanante', '¿Acompañante?'],
  ['nombre-acompanante', 'Nombre acompañante'],
  ['apellidos-acompanante', 'Apellidos acompañante'],
  ['alergias', 'Alergias'],
  ['alergias-acompanante', 'Alergias acompañante'],
  ['bus-ida', 'Bus ida'],
  ['bus-ida-origen', 'Ida desde'],
  ['bus-vuelta', 'Bus vuelta'],
  ['bus-vuelta-destino', 'Vuelta a'],
  ['bus-ida-acompanante', 'Bus ida acompañante'],
  ['bus-ida-origen-acompanante', 'Ida desde (acompañante)'],
  ['bus-vuelta-acompanante', 'Bus vuelta acompañante'],
  ['bus-vuelta-destino-acompanante', 'Vuelta a (acompañante)']
];

const FORM_FIELDS = COLUMNS.map(([key]) => key).filter(key => key !== 'fecha');
const PARTITION = 'confirmacion';

const formatDate = value => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(value));

function table() {
  const connection = process.env.STORAGE_CONNECTION_STRING;
  if (!connection) throw new Error('Falta STORAGE_CONNECTION_STRING.');
  return TableClient.fromConnectionString(connection, 'respuestas');
}

// Solo guarda los campos conocidos del formulario, recortados.
export function cleanSubmission(body) {
  const data = {};
  for (const key of FORM_FIELDS) data[key] = String(body?.[key] ?? '').trim().slice(0, 1000);
  return data;
}

export async function saveSubmission(data) {
  const client = table();
  await client.createTable().catch(error => { if (error.statusCode !== 409) throw error; });
  const createdAt = new Date().toISOString();
  await client.createEntity({ partitionKey: PARTITION, rowKey: randomUUID(), createdAt, data: JSON.stringify(data) });
  return createdAt;
}

export function toRow(data, createdAt) {
  const row = { fecha: formatDate(createdAt) };
  for (const key of FORM_FIELDS) row[key] = data[key] || '';
  return row;
}

export async function fetchRows() {
  const client = table();
  const entities = [];
  try {
    for await (const entity of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}'` } })) entities.push(entity);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
  return entities
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(entity => toRow(JSON.parse(entity.data), entity.createdAt));
}

export function summarize(rows) {
  const attending = rows.filter(r => r.asistencia === 'Sí');
  const count = (field, value) => rows.filter(r => r[field] === value).length;
  return {
    respuestas: rows.length,
    asisten: attending.length,
    noAsisten: count('asistencia', 'No'),
    personas: attending.length + attending.filter(r => r.acompanante === 'Sí').length,
    idaGijon: count('bus-ida-origen', 'Gijón') + count('bus-ida-origen-acompanante', 'Gijón'),
    idaOviedo: count('bus-ida-origen', 'Oviedo') + count('bus-ida-origen-acompanante', 'Oviedo'),
    vueltaGijon: count('bus-vuelta-destino', 'Gijón') + count('bus-vuelta-destino-acompanante', 'Gijón'),
    vueltaOviedo: count('bus-vuelta-destino', 'Oviedo') + count('bus-vuelta-destino-acompanante', 'Oviedo')
  };
}

export function buildWorkbook(rows) {
  const sheetRows = rows.map(row => Object.fromEntries(COLUMNS.map(([key, label]) => [label, row[key]])));
  const sheet = XLSX.utils.json_to_sheet(sheetRows, { header: COLUMNS.map(([, label]) => label) });
  sheet['!cols'] = COLUMNS.map(([, label]) => ({ wch: Math.max(12, label.length + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Respuestas');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

const digest = value => createHash('sha256').update(value).digest();
export const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));

// La página privada manda "usuario:contraseña" en base64 en la cabecera x-admin-auth.
export function isAdmin(request) {
  const { ADMIN_USER, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USER || !ADMIN_PASSWORD) return false;
  const decoded = Buffer.from(request.headers.get('x-admin-auth') || '', 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  const userOk = safeEqual(decoded.slice(0, separator), ADMIN_USER);
  const passOk = safeEqual(decoded.slice(separator + 1), ADMIN_PASSWORD);
  return userOk && passOk;
}

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendEmail({ subject, html, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!apiKey || !to) throw new Error('Faltan RESEND_API_KEY o NOTIFY_EMAIL.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Boda Cris y Pela <onboarding@resend.dev>',
      to: to.split(',').map(e => e.trim()),
      subject,
      html,
      attachments
    })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
