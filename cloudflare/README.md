# Cobros: Lemon Squeezy + Cloudflare Worker + Firebase

Cómo encaja todo:

```
Caesar (app) ──"Suscribirme"──▶ Lemon Squeezy (pago, con el uid de la cuenta)
                                   │ webhook firmado
                                   ▼
                          Cloudflare Worker (worker.js)
                                   │ escribe users/<uid>/billing/status
                                   ▼
Caesar ◀──lee estado── Firestore ◀── las reglas exigen "active == true" para subir datos
```

La app no tiene ningún secreto: el Worker es el único que escribe el estado de la suscripción.

## 1. Clave de Google para el Worker

El Worker necesita una cuenta de servicio de Google con permiso solo sobre Firestore.

1. Abre <https://console.cloud.google.com/iam-admin/serviceaccounts?project=caesar-sync-app>.
2. **Crear cuenta de servicio** → nombre `caesar-billing` → **Crear y continuar**.
3. Rol: **Usuario de Cloud Datastore** (`Cloud Datastore User`) → **Listo**.
4. Entra en `caesar-billing` → pestaña **Claves** → **Agregar clave → Crear clave nueva → JSON**. Se descarga un archivo.
5. Guárdalo en un sitio seguro. **No lo subas a GitHub ni lo compartas por chat.**

## 2. Lemon Squeezy

1. Crea la cuenta y la tienda en <https://app.lemonsqueezy.com>. Para activar la tienda pide datos fiscales/bancarios y las
   direcciones de la política de privacidad y los términos (ver `docs/`, punto 5).
2. **Products → New product**: nombre `Caesar Sync`, tipo **Subscription**, el precio y la periodicidad que quieras. Publícalo.
3. En el producto, botón **Share** → copia el **enlace de compra** (algo como `https://TU-TIENDA.lemonsqueezy.com/buy/xxxxxxxx`).
   Ese enlace es público: pásamelo.
4. Trabaja primero en **Test mode** (interruptor de la esquina superior): crea ahí el producto y el webhook de prueba, y paga
   con la tarjeta `4242 4242 4242 4242` (cualquier fecha futura y CVC).
5. **Settings → Webhooks → +**:
   - **URL:** la del Worker (paso 3).
   - **Signing secret:** una cadena larga y aleatoria que inventes (por ejemplo, 40 caracteres). Guárdala: es el secreto `LS_WEBHOOK_SECRET`.
   - **Eventos:** `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_resumed`,
     `subscription_expired`, `subscription_paused`, `subscription_unpaused`, `subscription_payment_failed`,
     `subscription_payment_success`, `subscription_payment_recovered`.

## 3. Cloudflare Worker (plan gratuito)

1. Crea una cuenta en <https://dash.cloudflare.com> (gratis, sin tarjeta).
2. **Workers & Pages → Create → Create Worker** → nombre `caesar-billing` → **Deploy**.
3. **Edit code**: borra el contenido, pega todo `cloudflare/worker.js` y pulsa **Deploy**.
4. **Settings → Variables and Secrets → Add** (tres entradas):
   | Nombre | Tipo | Valor |
   | --- | --- | --- |
   | `FIREBASE_PROJECT` | Texto | `caesar-sync-app` |
   | `FIREBASE_SA` | **Secreto** | el contenido completo del JSON del paso 1 |
   | `LS_WEBHOOK_SECRET` | **Secreto** | el signing secret del paso 2.5 |
5. La URL del Worker (`https://caesar-billing.TU-USUARIO.workers.dev`) es la que va en el webhook de Lemon Squeezy.
   Si abres esa URL en el navegador debe responder `Caesar billing webhook`.

## 4. Activar el cobro en Caesar (lo hago yo)

Cuando tengas el enlace de compra:

1. Se pone en `src-tauri/sync_config.json` (`checkoutUrl`).
2. Se despliegan las reglas de pago: `firebase/firestore.paid.rules` en lugar de `firestore.rules`.
3. Se publica la versión nueva.

Hasta ese momento, la sincronización es gratuita y no se exige suscripción.

## 5. Páginas legales

`docs/privacy.html` y `docs/terms.html` son un borrador. Rellena `{{NOMBRE LEGAL}}`, `{{CORREO DE CONTACTO}}`, `{{FECHA}}` y
`{{CIUDAD}}` y **hazlas revisar por alguien** antes de cobrar: no sustituyen a un asesor legal. Después se publican con GitHub
Pages (carpeta `/docs` de `main`) y esas URLs son las que pide Lemon Squeezy.

## 6. Prueba completa (en modo test)

1. En Caesar: Ajustes → Sincronización → crea cuenta → **Suscribirme** → paga con la tarjeta de prueba.
2. En Cloudflare, el Worker debe mostrar peticiones con respuesta 200. En Firestore aparece `users/<uid>/billing/status`.
3. En Caesar pulsa **Ya he pagado, comprobar**: debe poner «Activa» y la sincronización sube datos.
4. Cancela desde **Gestionar suscripción** y comprueba que pone «Cancelada: activa hasta …».

## 7. Limpieza horaria de cuentas de prueba (Cron Trigger)

El Worker tiene un handler `scheduled` que se ejecuta cada hora (`[triggers] crons = ["0 * * * *"]` en
`wrangler.toml`; si pegas el código a mano en el panel, añade el Cron Trigger en **Settings → Triggers**).

Qué hace:

1. Lista todos los usuarios de Firebase Auth (`accounts:batchGet`, paginando de 1000 en 1000).
2. Para las cuentas creadas hace **más de 7 días** lee `users/<uid>` y `users/<uid>/billing/status` **en lote** (Firestore `documents:batchGet`, 100 usuarios por llamada).
3. Es **exenta** si `users/<uid>.isWhitelistMember == true` (la whitelist vive solo en Firestore, no hay emails en el código)
   o si `billing/status` tiene `active == true` (o `status == "active"`).
4. El resto se borra de Firebase Auth **en lote** (`accounts:batchDelete`, 500 por llamada), tras volver a leer billing y whitelist en lote justo antes (anti-carrera con un pago tardío).
5. Si una lectura falla con algo distinto de 404 (5xx, 403...), esa cuenta **no se borra** y se registra el error.

Límites: el plan gratis permite 50 subrequests por invocación (1000 en el de pago). El Worker lleva un contador interno y
usa como máximo `MAX_SUBREQUESTS` (por defecto 45; súbelo en el plan de pago). Con lotes caben unos 2000 usuarios por
ejecución; si se agota el presupuesto, para limpiamente y loguea `restantes` (se continúa en la siguiente ejecución horaria,
y ejecutar más veces es inocuo: solo se borra lo que ya pasó de 7 días). Máximo `MAX_DELETES` borrados por ejecución
(por defecto 2000). Log resumen `{revisados, exentos, borrados, errores[, restantes]}` visible en Workers → Logs.

El endpoint del webhook solo acepta GET/POST (otros métodos: 405), rechaza cuerpos > 100 KB (413) y no llama a Firebase
antes de validar la firma.

**Modo prueba (`DRY_RUN`)**: añade la variable de texto `DRY_RUN = 1` y el Worker solo loguea lo que borraría, sin borrar nada.
Haz una primera ejecución así y revisa el log antes de quitarla. Para lanzar el cron a mano: `wrangler dev --test-scheduled` y
`curl "http://localhost:8787/__scheduled"`.

Permisos IAM de la cuenta de servicio `caesar-billing` (además de **Cloud Datastore User**):
**Firebase Authentication Admin** (`roles/firebaseauth.admin`) para listar y borrar usuarios. El Worker pide el scope
`cloud-platform`.

Tests: `cd cloudflare && node --test` (fetch simulado; no toca Google).

## 8. Códigos de «Pro para siempre» (plan Compas)

Para compañeros: un código desbloquea Pro de por vida (sin Lemon Squeezy). Lo valida el mismo Worker en `POST /redeem`.

1. En el Worker añade la variable de texto `FIREBASE_API_KEY` (la `apiKey` de `src-tauri/sync_config.json`) y vuelve a pegar `worker.js`.
2. Pon la URL del Worker en `src-tauri/sync_config.json` → `workerUrl` (sin barra final) y publica versión nueva.
3. Despliega las reglas de `firebase/` (ahora `isPro` también acepta `users/{uid}.proForever`).
4. Genera un código: `node cloudflare/gen-code.mjs 6` y crea en Firestore el documento que indica (`codes/<CÓDIGO>` con `max` y `uses` numéricos).
   Para ampliar los usos basta con subir `max` desde la consola.
5. Pásale el código al compañero: en Caesar, Ajustes → Cuenta y suscripción → **Canjear código** (necesita haber iniciado sesión).

El canje es atómico (transacción): sube `uses` y escribe `users/<uid>.proForever`. Un mismo usuario no gasta dos usos, y el Cron de
limpieza no borra nunca estas cuentas. Los clientes no pueden leer `codes/` (las reglas lo bloquean).
