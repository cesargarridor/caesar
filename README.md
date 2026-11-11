# Caesar

Cliente API de escritorio, rápido y seguro (Tauri v2 + Rust + React). Importa y exporta colecciones de Postman, pega un
`cURL` en la barra de URL, scripts de Tests al estilo Postman, varios temas y mucho más.

> **Proyecto de código abierto, de uso libre.** Caesar se ofrece tal cual, sin ninguna garantía, y el autor no se hace
> responsable de ningún daño, pérdida de datos o problema derivado de su uso. Puedes usarlo, copiarlo y modificarlo
> libremente según la [licencia MIT](LICENSE).

## Descargar

1. Entra en la página de versiones: **https://github.com/cesargarridor/caesar/releases/latest**
2. Baja el archivo de tu sistema (están en la sección **Assets**, al final de la página):

| Sistema | Archivo | Notas |
| --- | --- | --- |
| **Windows** | `Caesar_x.y.z_x64-setup.exe` | El instalador normal. También hay un `.msi`. |
| **macOS** (Intel y Apple Silicon) | `Caesar_x.y.z_universal.dmg` | Abre el `.dmg` y arrastra Caesar a Aplicaciones. |
| **Linux (Debian/Ubuntu)** | `Caesar_x.y.z_amd64.deb` | `sudo apt install ./Caesar_x.y.z_amd64.deb` |
| **Linux (cualquier distro)** | `Caesar_x.y.z_amd64.AppImage` | `chmod +x Caesar_*.AppImage && ./Caesar_*.AppImage` |

Los archivos `.sig` y `latest.json` son del actualizador: no hace falta descargarlos.

### Primer arranque: avisos del sistema

Los instaladores todavía no llevan certificado de Windows ni de Apple, así que el sistema avisa la primera vez:

- **Windows (SmartScreen):** pulsa **Más información** y luego **Ejecutar de todos modos**.
- **macOS (Gatekeeper):** clic derecho sobre Caesar → **Abrir** → **Abrir**. Si no aparece, en *Ajustes del Sistema →
  Privacidad y seguridad* pulsa **Abrir de todos modos**.

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

> **Estado:** la parte local (`src-tauri/src/vault.rs`) está hecha y probada. Aún faltan la cuenta y el almacenamiento en
> la nube (Firebase), los pagos (Lemon Squeezy) y las pantallas. Por ahora no hay ninguna sincronización activa.

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

### Pendiente

1. Proyecto de Firebase (Auth, Firestore con reglas por usuario, TTL para los mensajes de vinculación).
2. Subida y descarga de colecciones cifradas (un documento por colección, con retraso para ahorrar operaciones).
3. Pantallas de activación, vinculación y recuperación.
4. Suscripción con Lemon Squeezy y webhook (Cloud Function con verificación de firma).

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
