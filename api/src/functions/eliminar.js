// Elimina una respuesta (o solo el acompañante) desde la página privada.
import { app } from '@azure/functions';
import { deleteSubmission, isAdmin } from '../lib/respuestas.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.http('eliminar', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'respuestas/{id}',
  handler: async (request, context) => {
    if (!isAdmin(request)) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return { status: 401, jsonBody: { error: 'Usuario o contraseña incorrectos.' } };
    }
    const { id } = request.params;
    if (!UUID.test(id)) return { status: 400, jsonBody: { error: 'Identificador no válido.' } };
    try {
      await deleteSubmission(id, request.query.get('persona'));
      return { status: 200, jsonBody: { ok: true } };
    } catch (error) {
      if (error.statusCode === 404) return { status: 404, jsonBody: { error: 'Esa respuesta ya no existe.' } };
      context.error(error);
      return { status: 500, jsonBody: { error: 'No se ha podido eliminar.' } };
    }
  }
});
