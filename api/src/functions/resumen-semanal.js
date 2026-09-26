// Envía el resumen con el Excel. Lo llama cada lunes el workflow de GitHub .github/workflows/resumen-semanal.yml.
import { app } from '@azure/functions';
import { buildWorkbook, fetchRows, safeEqual, sendEmail, summarize } from '../lib/respuestas.js';

app.http('resumen-semanal', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'resumen-semanal',
  handler: async request => {
    const secret = process.env.CRON_SECRET;
    if (!secret || !safeEqual(request.headers.get('x-cron-secret') || '', secret)) return { status: 401 };

    const rows = await fetchRows();
    const s = summarize(rows);
    const today = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long' }).format(new Date());

    await sendEmail({
      subject: `Resumen semanal de la boda · ${s.respuestas} respuestas`,
      html: `<div style="font-family:Georgia,serif;color:#3d4a3a;font-size:15px">
        <h2 style="font-weight:400;font-style:italic">Resumen a ${today}</h2>
        <p>${s.respuestas} respuestas: ${s.asisten} asisten y ${s.noAsisten} no asisten.<br>
        <strong>${s.personas} personas</strong> en total contando acompañantes.</p>
        <p>Bus de ida: ${s.idaGijon} desde Gijón y ${s.idaOviedo} desde Oviedo.<br>
        Bus de vuelta: ${s.vueltaGijon} a Gijón y ${s.vueltaOviedo} a Oviedo.</p>
        <p>Tienes el Excel completo adjunto.</p>
      </div>`,
      attachments: [{ filename: 'respuestas-boda.xlsx', content: buildWorkbook(rows).toString('base64') }]
    });
    return { status: 200, jsonBody: { ok: true, respuestas: s.respuestas } };
  }
});
