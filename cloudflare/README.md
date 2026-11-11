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
