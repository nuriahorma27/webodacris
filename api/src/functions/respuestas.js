// Devuelve las respuestas a la página privada (/admin.html), en JSON o como Excel.
import { app } from '@azure/functions';
import { PERSON_COLUMNS, buildWorkbook, fetchRows, isAdmin, summarize, toPeople } from '../lib/respuestas.js';

app.http('respuestas', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'respuestas',
  handler: async (request, context) => {
    if (!isAdmin(request)) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return { status: 401, jsonBody: { error: 'Usuario o contraseña incorrectos.' } };
    }
    try {
      const rows = await fetchRows();
      if (request.query.get('format') === 'xlsx') {
        return {
          body: buildWorkbook(rows),
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="respuestas-boda.xlsx"',
            'Cache-Control': 'no-store'
          }
        };
      }
      return { jsonBody: { columns: PERSON_COLUMNS, rows: toPeople(rows), summary: summarize(rows) }, headers: { 'Cache-Control': 'no-store' } };
    } catch (error) {
      context.error(error);
      return { status: 500, jsonBody: { error: 'No se han podido cargar las respuestas.' } };
    }
  }
});
