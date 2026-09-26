// Recibe el formulario de la web, lo guarda y avisa por email.
import { app } from '@azure/functions';
import { COLUMNS, cleanSubmission, escapeHtml, saveSubmission, sendEmail, toRow } from '../lib/respuestas.js';

app.http('confirmacion', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'confirmacion',
  handler: async (request, context) => {
    const body = await request.json().catch(() => null);
    if (!body) return { status: 400, jsonBody: { error: 'Datos no válidos.' } };
    if (body['bot-field']) return { status: 200, jsonBody: { ok: true } };

    const data = cleanSubmission(body);
    if (!data.nombre || !data.apellidos || !['Sí', 'No'].includes(data.asistencia)) {
      return { status: 400, jsonBody: { error: 'Faltan datos obligatorios.' } };
    }

    const createdAt = await saveSubmission(data);

    const row = toRow(data, createdAt);
    const who = `${row.nombre} ${row.apellidos}`;
    const status = row.asistencia === 'Sí' ? (row.acompanante === 'Sí' ? 'asiste con acompañante' : 'asiste') : 'no asiste';
    const lines = COLUMNS
      .filter(([key]) => row[key])
      .map(([key, label]) => `<tr><td style="padding:6px 14px 6px 0;color:#737b54;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0">${escapeHtml(row[key])}</td></tr>`)
      .join('');
    try {
      await sendEmail({
        subject: `Nueva respuesta: ${who} (${status})`,
        html: `<div style="font-family:Georgia,serif;color:#3d4a3a">
          <h2 style="font-weight:400;font-style:italic">${escapeHtml(who)} ${status}</h2>
          <table style="border-collapse:collapse;font-size:15px">${lines}</table>
        </div>`
      });
    } catch (error) {
      // La respuesta ya está guardada; un fallo del email no debe hacerla fallar.
      context.error(error);
    }
    return { status: 200, jsonBody: { ok: true } };
  }
});
