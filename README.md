<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Caesar" width="160" height="160">
</p>

<h1 align="center">Caesar</h1>

<p align="center"><b>Cliente API de escritorio, rápido y seguro</b></p>

**Web del producto:** https://cesargarridor.github.io/caesar/ (también en [inglés](https://cesargarridor.github.io/caesar/en/))

Cliente API de escritorio, rápido y seguro (Tauri v2 + Rust + React). Importa y exporta colecciones (JSON, YAML y HAR), pega un
`cURL` en la barra de URL, scripts de Tests, varios temas y mucho más.

> **Proyecto de código abierto, de uso libre.** Caesar se ofrece tal cual, sin ninguna garantía, y el autor no se hace
> responsable de ningún daño, pérdida de datos o problema derivado de su uso. Puedes usarlo, copiarlo y modificarlo
> libremente según la [licencia MIT](LICENSE).

## Descargas

Página de descargas con requisitos, instalación y verificación: https://cesargarridor.github.io/caesar/download.html
(también en [inglés](https://cesargarridor.github.io/caesar/en/download.html)).

1. Entra en la página de versiones: **https://github.com/cesargarridor/caesar/releases/latest**
2. Baja el archivo de tu sistema (están en la sección **Assets**, al final de la página):

| Sistema | Archivo | Notas |
| --- | --- | --- |
| **Windows** | `Caesar_x.y.z_x64-setup.exe` | El instalador normal. También hay un `.msi`. |
| **macOS** (Intel y Apple Silicon) | `Caesar_x.y.z_universal.dmg` | Abre el `.dmg` y arrastra Caesar a Aplicaciones. |
| **Linux (Debian/Ubuntu)** | `Caesar_x.y.z_amd64.deb` | `sudo apt install ./Caesar_x.y.z_amd64.deb` |
| **Linux (cualquier distro)** | `Caesar_x.y.z_amd64.AppImage` | `chmod +x Caesar_*.AppImage && ./Caesar_*.AppImage` |

Los archivos `.sig` y `latest.json` son del actualizador: no hace falta descargarlos. GitHub muestra el SHA-256 de cada
archivo en la Release; compáralo con `sha256sum` / `shasum -a 256` / `Get-FileHash`.

### Primer arranque: avisos del sistema

- **Windows (SmartScreen):** el instalador no lleva firma de código todavía. Pulsa **Más información** y luego
  **Ejecutar de todos modos**.
- **macOS (Gatekeeper):** la app se firma y notariza con Apple, así que normalmente no avisa. Si aparece un aviso,
  clic derecho sobre Caesar → **Abrir** → **Abrir**; si no, en *Ajustes del Sistema → Privacidad y seguridad* pulsa
  **Abrir de todos modos**.

## Política de firma de código

Estado a 12 de noviembre de 2026:

- **macOS:** firmado y notarizado con Apple (ver `.github/workflows/release.yml`).
- **Windows y Linux:** sin firma de código por ahora (Windows puede mostrar SmartScreen o "editor desconocido").
- **Actualizaciones:** firmadas con minisign; la app verifica la firma antes de instalar.
- **Futuro:** se prevé solicitar firma gratuita para código abierto en Windows, sin garantías ni fecha.
- **Equipo:** una sola persona, Cesar Garrido, autor, revisor y aprobador de las versiones. Se activará MFA en las
  cuentas implicadas en la publicación (intención, no verificada públicamente).
- **Privacidad:** [política de privacidad](https://cesargarridor.github.io/caesar-legal/privacy.html). Detalle:
  [política de firma en la web](https://cesargarridor.github.io/caesar/download.html#politica-de-firma-de-codigo).

## Actualizaciones automáticas

Caesar se actualiza solo, así que solo tienes que instalarlo a mano la primera vez.

- Por defecto, al abrir la app busca una versión nueva; si la hay, la descarga, la instala y se reinicia sola.
  Tus pestañas y borradores se conservan.
- Se controla en **Ajustes → Actualizaciones**: puedes **desactivarlas** o pulsar **Buscar actualizaciones** cuando quieras.
- Cada paquete va firmado y la app comprueba la firma antes de instalarlo.
- En Linux, la actualización automática solo funciona con el **AppImage**; el `.deb` hay que reinstalarlo a mano.

## Licencia

[MIT](LICENSE): uso libre, sin garantía y sin responsabilidad del autor. Las contribuciones son bienvenidas.

Los temas de color (Monokai, Dracula, Tokyo Night, Nord, One Dark y GitHub Light) y otros componentes de terceros tienen su
origen y su licencia en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Caesar no usa Monokai Pro, que es de pago.

## Seguridad

- La interfaz nunca hace peticiones de red: todo pasa por Rust (`reqwest`) mediante IPC.
- Rust valida las URLs, solo permite `http`/`https` y limita el tamaño de respuestas y archivos.
- CSP estricta y permisos mínimos de Tauri.

## Sincronización cifrada de extremo a extremo (en desarrollo)

> **Estado:** el cifrado local, la cuenta (Firebase Auth, correo y contraseña), la base de datos (Firestore) y la
> sincronización en segundo plano están hechos (Ajustes → Sincronización). Faltan la vinculación con QR en pantalla y los
> pagos (Lemon Squeezy). Todo funciona en el plan gratuito (Spark) de Firebase, sin tarjeta.

### Cómo se sincroniza sin gastar cuota

1. **Debounce (React):** hasta que no pasan 2 s sin teclear, no se envía nada a Rust.
2. **Disco (Rust):** `local_save` escribe `datos.json` de forma atómica y levanta una bandera; no toca internet.
3. **Trabajador (Rust, tokio):** cada 30 s mira la bandera; si está levantada cifra el archivo y lo sube en una sola
   petición. Sin cambios no hace ninguna llamada. Cada 5 min comprueba si otro equipo ha subido algo.
   Conflictos: gana la última escritura; antes de aplicar lo remoto se guarda `datos.json.bak`.

Firebase: proyecto `caesar-sync-app`, reglas en [firebase/firestore.rules](firebase/firestore.rules) (cada persona solo
accede a `users/<su uid>/sync/*`). La `apiKey` de `src-tauri/sync_config.json` es un identificador público, no un secreto.
Límite: ~650 KB de colecciones (documento de 1 MiB de Firestore).

El objetivo es poder usar las mismas peticiones y colecciones en varios ordenadores sin que el servidor pueda leerlas.
Todo el cifrado ocurre en Rust, en tu equipo; la interfaz nunca ve la clave.

### Qué guarda y dónde

- **Clave de datos:** 32 bytes aleatorios generados con el generador seguro del sistema. Se guardan **solo en el llavero
  del sistema operativo** (Credential Manager en Windows, Keychain en macOS, Secret Service en Linux). Nunca se escriben
  en un archivo ni se envían en claro.
- **Cifrado:** AES-256-GCM. Cada bloque lleva un *nonce* nuevo y queda ligado a su contexto (por ejemplo el id de la
  colección), de modo que no se puede cambiar un bloque por otro ni alterarlo sin que falle el descifrado.
  Formato del bloque: `c1.<nonce>.<cifrado>` (base64 URL-safe).
- **Qué ve el servidor:** solo bloques cifrados, identificadores y fechas. Ni el autor de Caesar puede leer tus tokens.

### Pasos de cada operación

**1. Activar el cifrado en el primer ordenador** (`vault_create`)
1. Se genera la clave de datos y se guarda en el llavero.
2. Se muestra **una sola vez** la **clave de recuperación** (`CSR-XXXXX-XXXXX-…`): es la misma clave escrita en texto con una
   suma de comprobación que detecta errores al teclearla. Guárdala en un gestor de contraseñas.

**2. Vincular un ordenador nuevo con un código** (sin contraseña maestra)

| Paso | Equipo | Qué ocurre |
| --- | --- | --- |
| 1 | Nuevo | Genera un par de claves efímero (X25519) y muestra su clave pública como enlace/QR (`pairing_begin`). |
| 2 | Vinculado | Abre el enlace, genera su propio par efímero y muestra un **código de 6 cifras** (`pairing_approve_start`). |
| 3 | Nuevo | Recibe la clave pública del otro y muestra el mismo código (`pairing_code`). |
| 4 | Ambos | El usuario **comprueba que los dos códigos coinciden**. Si no, se cancela: alguien se ha interpuesto. |
| 5 | Vinculado | Cifra la clave de datos para el equipo nuevo (`pairing_approve_confirm`). |
| 6 | Nuevo | Descifra y guarda la clave en su llavero (`pairing_finish`). |

El secreto compartido sale del intercambio X25519 + HKDF-SHA256 ligado a ambas claves públicas. La vinculación caduca a los
10 minutos, es de un solo uso y las claves temporales solo existen en memoria. Por el servidor solo viajan claves públicas
y un bloque cifrado que no puede abrir.

**3. Recuperar si se pierden todos los equipos** (`vault_restore`): se pega la clave de recuperación y se guarda en el llavero.

**4. Quitar la clave de un equipo** (`vault_forget`): borra la clave local. Sin otro equipo vinculado ni clave de recuperación,
los datos cifrados no se pueden recuperar.

### Límites que conviene conocer

- Si pierdes todos los equipos **y** la clave de recuperación, los datos son irrecuperables. Es el precio de que nadie más
  pueda leerlos.
- El llavero protege contra el robo del archivo o del disco, no contra un programa malicioso que ya se ejecute con tu usuario.
- Revocar un equipo exigirá generar una clave nueva y volver a cifrar los datos (pendiente).

### Pantalla de bienvenida

La primera vez que se abre Caesar (y una sola vez al actualizar desde una versión sin ella) aparece una pantalla con tres
opciones: **iniciar sesión**, **registrarse** (correo y contraseña, o GitHub si está disponible) o **continuar como
invitado**. Como invitado los datos se guardan solo en ese dispositivo: si se borran o se cambia de equipo, se pierden. Se
puede crear la cuenta más tarde desde Ajustes → Sincronización sin perder lo local. Si ya hay una sesión iniciada, la
pantalla no sale. Se recuerda con `caesar.onboarded` en el almacenamiento local. Incluye enlaces a la política de privacidad y a los términos, publicados en el repositorio
[caesar-legal](https://github.com/cesargarridor/caesar-legal) (https://cesargarridor.github.io/caesar-legal/); las URLs
están en `src/lib/legal.ts`. Ahí también están el aviso legal, la página de seguridad (qué guarda la app y dónde) y cómo
borrar los datos, en español e inglés.

### Pendiente

1. Reglas de Firestore por usuario y TTL para los mensajes de vinculación (comprobar en la consola de Firebase).
2. Pantallas de vinculación con QR y de recuperación.
3. Suscripción con Lemon Squeezy y webhook (Cloud Function con verificación de firma), con Cloudflare, cuando se firme.

## Desarrollo

Requisitos: [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) y las
[dependencias de Tauri](https://tauri.app/start/prerequisites/) de tu sistema.

```bash
npm ci
npm run tauri dev      # modo desarrollo
npm run tauri build    # genera los instaladores en src-tauri/target/release/bundle
```

## Publicar una versión nueva

Cada cambio se publica como versión nueva y llega sola a quien tenga las actualizaciones activadas:

```bash
npm run release -- "qué ha cambiado" [patch|minor|major]
```

El script crea la rama `release/vX.Y.Z`, sube la versión, hace commit, la une a `main`, pone la etiqueta `vX.Y.Z` y la
sube. La etiqueta lanza el flujo **Release** de GitHub Actions, que compila Windows, Linux y macOS, firma los paquetes y
publica la Release con `latest.json`.

Hace falta el secreto de repositorio `TAURI_SIGNING_PRIVATE_KEY` (la clave privada del actualizador). Si se pierde esa
clave, las apps ya instaladas no podrán aceptar más actualizaciones.
