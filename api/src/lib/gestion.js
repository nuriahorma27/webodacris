import { TableClient } from '@azure/data-tables';

// Secciones de la zona privada (invitados, mesas, presupuesto, proveedores, tareas).
// Cada sección es un documento JSON. Se guarda troceado en la tabla "gestion"
// (Azure Table limita cada texto a ~32.000 caracteres): partición = sección, filas 000, 001...
export const SECCIONES = ['invitados', 'mesas', 'presupuesto', 'proveedores', 'tareas'];
const CHUNK = 30000;
const MAX_TOTAL = 900000; // ~900 KB por sección

function table() {
  const connection = process.env.STORAGE_CONNECTION_STRING;
  if (!connection) throw new Error('Falta STORAGE_CONNECTION_STRING.');
  return TableClient.fromConnectionString(connection, 'gestion');
}

async function listChunks(client, seccion) {
  const rows = [];
  try {
    for await (const e of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${seccion}'` } })) rows.push(e);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
  return rows.sort((a, b) => a.rowKey.localeCompare(b.rowKey));
}

export async function readSeccion(seccion) {
  const rows = await listChunks(table(), seccion);
  if (!rows.length) return { rev: 0, data: null };
  return { rev: Number(rows[0].rev) || 0, data: JSON.parse(rows.map(r => r.json).join('')) };
}

// Escritura con control de versión: si otra persona guardó antes, devuelve conflicto.
export async function writeSeccion(seccion, data, baseRev) {
  const client = table();
  await client.createTable().catch(error => { if (error.statusCode !== 409) throw error; });
  const text = JSON.stringify(data);
  if (text.length > MAX_TOTAL) throw Object.assign(new Error('Demasiados datos.'), { status: 413 });
  const rows = await listChunks(client, seccion);
  const current = rows.length ? Number(rows[0].rev) || 0 : 0;
  if (Number(baseRev) !== current) return { conflict: true, rev: current };
  const rev = current + 1;
  const chunks = text.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) || ['null'];
  for (let i = 0; i < chunks.length; i++) {
    await client.upsertEntity({ partitionKey: seccion, rowKey: String(i).padStart(3, '0'), rev, json: chunks[i] }, 'Replace');
  }
  for (const row of rows) if (row.rowKey >= String(chunks.length).padStart(3, '0')) await client.deleteEntity(seccion, row.rowKey);
  return { rev };
}
