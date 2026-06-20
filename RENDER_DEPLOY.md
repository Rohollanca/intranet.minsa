# Despliegue en Render

Este proyecto ya esta preparado para Render como **Web Service Node**.

## Build y start

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Health Check Path: `/health`

## Variables de entorno

Configura estas variables en Render:

```txt
NODE_VERSION=22.22.0
VITE_VERIFICATION_BASE_URL=https://portalwebminsa-certificados.onrender.com
MEDICAL_API_BASE_URL=https://TU-BACKEND-MEDICO-PUBLICO
BOT_FILES_BASE_URL=https://TU-SERVIDOR-DE-ARCHIVOS-PUBLICO
API_SHARED_KEY=YOUR_API_KEY
API_ENABLE_DOCUMENT_GENERATION=false
API_ENABLE_DEMO_ENDPOINTS=false
API_USAGE_LOG_PATH=/var/data/api-usage.log
```

Valores actuales usados para este despliegue:

```txt
MEDICAL_API_BASE_URL=https://intranet-api.alisadata.lat
BOT_FILES_BASE_URL=https://intranet-files.alisadata.lat
```

## Importante

`MEDICAL_API_BASE_URL` debe apuntar a la API que atiende:

- `/from-whatsapp`
- `/last-result`
- `/convert-docx-to-pdf`

`BOT_FILES_BASE_URL` debe apuntar al servidor donde estan las fotos/archivos del bot, por ejemplo:

- `/files/imagen.jpg`

En local esos servicios son:

```txt
MEDICAL_API_BASE_URL=http://127.0.0.1:5055
BOT_FILES_BASE_URL=http://127.0.0.1:3000
```

En Render no sirven los `localhost`, por eso deben ser URLs publicas.

## API simple

La API privada usa una sola clave global:

```txt
Authorization: Bearer YOUR_API_KEY
```

No configures `DATABASE_URL`; esta version no usa PostgreSQL, clientes, planes ni creditos.
