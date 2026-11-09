// Lee y guarda las secciones de gestión de la página privada (/admin.html).
import { app } from '@azure/functions';
import { isAdmin } from '../lib/respuestas.js';
import { SECCIONES, readSeccion, writeSeccion } from '../lib/gestion.js';

app.http('gestion', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'gestion/{seccion}',
  handler: async (request, context) => {
    if (!isAdmin(request)) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return { status: 401, jsonBody: { error: 'Usuario o contraseña incorrectos.' } };
    }
    const { seccion } = request.params;
    if (!SECCIONES.includes(seccion)) return { status: 404, jsonBody: { error: 'Sección desconocida.' } };
    try {
      if (request.method === 'GET') return { jsonBody: await readSeccion(seccion), headers: { 'Cache-Control': 'no-store' } };
      const body = await request.json();
      const result = await writeSeccion(seccion, body?.data, body?.rev ?? 0);
      if (result.conflict) return { status: 409, jsonBody: { error: 'Otra persona ha guardado cambios antes. Recarga para verlos.', rev: result.rev } };
      return { jsonBody: { rev: result.rev } };
    } catch (error) {
      context.error(error);
      return { status: error.status || 500, jsonBody: { error: error.status === 413 ? 'Hay demasiados datos en esta sección.' : 'No se ha podido guardar.' } };
    }
  }
});
