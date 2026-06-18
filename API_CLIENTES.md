# API de clientes

API base:

```txt
https://intranet-portalwebminsa.onrender.com
```

API key inicial:

```txt
sk_medico_090558
```

Cada cliente tiene 50 creditos diarios. Cada consulta demo descuenta 1 credito.

## Consultar saldo

```bash
curl -H "Authorization: Bearer sk_medico_090558" \
  https://intranet-portalwebminsa.onrender.com/api/v1/saldo
```

Respuesta:

```json
{
  "ok": true,
  "cliente": "medico-demo",
  "creditos_diarios": 50,
  "creditos_restantes": 50,
  "ultima_recarga": "2026-06-18"
}
```

## Descontar 1 credito para prueba

```bash
curl -X POST \
  -H "Authorization: Bearer sk_medico_090558" \
  -H "Content-Type: application/json" \
  -d "{\"dni\":\"75481714\",\"tipo\":\"prueba\"}" \
  https://intranet-portalwebminsa.onrender.com/api/v1/consulta-demo
```

Respuesta:

```json
{
  "ok": true,
  "tipo": "consulta_demo",
  "mensaje": "Credito descontado correctamente. Endpoint demo para integracion autorizada.",
  "entrada": {
    "dni": "75481714",
    "tipo": "prueba"
  },
  "creditos_restantes": 49
}
```

## Errores

Sin API key:

```json
{ "ok": false, "error": "API key requerida" }
```

Sin creditos:

```json
{ "ok": false, "error": "Sin creditos disponibles" }
```

