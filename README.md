# Web de la boda de Cris y Pela

Sitio web estático para la boda de Cris y Pela, publicado en Azure Static Web Apps.

## Desarrollo local

No requiere instalación ni proceso de compilación. Para verlo en local:

```bash
python3 -m http.server 4173
```

Después abre `http://localhost:4173`.

## Publicación

La web se publica en **Azure Static Web Apps**. Cada `push` a la rama `main` lanza el workflow `.github/workflows/azure-static-web-apps-*.yml`, que sube la raíz del repositorio (web) y la carpeta `api/` (funciones). No hay proceso de compilación.

## Respuestas del formulario (Azure)

La web se publica en Azure Static Web Apps. El formulario envía las respuestas a funciones de Azure (`api/`), que las guardan en Azure Table Storage.

- **Zona privada** (`/admin.html`, enlace «Acceso novios» en el pie): tabla con todas las respuestas, resumen y botón para exportar a Excel.
- **Email por cada respuesta**, enviado con [Resend](https://resend.com).
- **Excel semanal por email**, los lunes a las 08:00 UTC, lanzado por `.github/workflows/resumen-semanal.yml`. También se puede lanzar a mano desde la pestaña Actions de GitHub.

Variables de entorno de la Static Web App (**Settings → Environment variables**):

| Variable | Qué es |
| --- | --- |
| `STORAGE_CONNECTION_STRING` | Cadena de conexión de una cuenta de Azure Storage, donde se guardan las respuestas |
| `ADMIN_USER` | Usuario de la zona privada |
| `ADMIN_PASSWORD` | Contraseña de la zona privada |
| `RESEND_API_KEY` | API key de Resend |
| `NOTIFY_EMAIL` | Email (o varios separados por comas) que recibe los avisos y el Excel |
| `CRON_SECRET` | Clave inventada que protege el envío semanal |
| `EMAIL_FROM` | Opcional. Remitente, si se verifica un dominio en Resend |

En GitHub (**Settings → Secrets and variables → Actions**): el secreto `CRON_SECRET`, con el mismo valor, y la variable `SITE_URL` con la dirección de la web (sin barra final).

Sin dominio verificado, Resend solo entrega emails a la dirección con la que se creó la cuenta.

## Archivos principales

- `index.html`: estructura y contenido.
- `styles.css`: diseño responsive y textura de papel.
- `script.js`: filtros, menú y animaciones.
- `assets/`: fotografías e ilustraciones.
- `admin.html`: zona privada con las respuestas.
- `api/`: funciones de Azure para guardar las respuestas, leerlas y enviar los emails.

## Zona privada: gestión de la boda

`/admin.html` incluye, además de las respuestas del formulario, las pestañas **Invitados, Mesas, Presupuesto, Proveedores y Tareas**. Los datos se guardan en la tabla `gestion` de Azure Table Storage (función `api/src/functions/gestion.js`) con la misma cadena de conexión.

- **Invitados:** lista con filtros, importación/exportación de Excel, asociación con las respuestas del formulario y descarga de alergias.
- **Mesas:** plano de cada mesa y asignación de invitados.
- **Presupuesto:** partidas con pagos por mes; el aviso «Este mes toca pagar» sale en todas las pestañas.
- **Proveedores y Tareas:** seguimiento de proveedores y lista de tareas por fases.
