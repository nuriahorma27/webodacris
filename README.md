# Web de la boda de Cris y Pela

Sitio web estático para la boda de Cris y Pela, preparado para publicar en Netlify.

## Desarrollo local

No requiere instalación ni proceso de compilación. Para verlo en local:

```bash
python3 -m http.server 4173
```

Después abre `http://localhost:4173`.

## Publicación en Netlify

1. Sube este repositorio a GitHub.
2. En Netlify, selecciona **Add new site → Import an existing project**.
3. Conecta GitHub y elige este repositorio.
4. Netlify leerá automáticamente `netlify.toml`; no necesita comando de compilación y publicará la raíz del repositorio.

Cada nuevo `push` a la rama `main` generará una nueva publicación.

## Archivos principales

- `index.html`: estructura y contenido.
- `styles.css`: diseño responsive y textura de papel.
- `script.js`: filtros, menú y animaciones.
- `assets/`: fotografías e ilustraciones.

