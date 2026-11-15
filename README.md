> ## Caesar es Fair Source
>
> **Caesar es Fair Source. Puedes leer y usar el código libremente. He elegido este modelo para garantizar que el proyecto sea sostenible a largo plazo, protegiendo el negocio mientras mantengo una transparencia del 100% sobre cómo manejo tus datos locales y tokens.**
>
> Licencia: [FSL-1.1-MIT](LICENSE) · No es de código abierto · Prohibido venderlo ([detalles](#licencia))

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Caesar" width="160" height="160">
</p>

<h1 align="center">Caesar</h1>

<p align="center"><b>Cliente API de escritorio, rápido y seguro</b></p>

**Web del producto:** https://cesargarridor.github.io/caesar/ (también en [inglés](https://cesargarridor.github.io/caesar/en/))

Cliente API de escritorio, rápido y seguro (Tauri v2 + Rust + React). Importa y exporta colecciones (JSON, YAML y HAR), pega un
`cURL` en la barra de URL, scripts de Tests, varios temas y mucho más.

> **Licencia FSL (Functional Source License): código disponible, pero NO es de código abierto.** Caesar se publica bajo la
> [FSL-1.1-MIT](LICENSE). Puedes usarlo gratis, estudiarlo, modificarlo y compartir tus cambios, **pero está prohibido
> venderlo** y usarlo para ofrecer a otros un producto o servicio comercial que lo sustituya o tenga una funcionalidad
> similar (revenderlo, redistribuirlo de pago o alojarlo como servicio). Cada versión pasa a licencia MIT a los dos años de
> publicarse. Se ofrece tal cual, sin ninguna garantía, y el autor no se hace responsable de ningún daño, pérdida de datos o
> problema derivado de su uso.

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
- **Futuro:** se estudiará una opción de firma de código para Windows, sin garantías ni fecha. Los programas de firma gratuita para código abierto no valen para Caesar, porque su licencia FSL no es de código abierto.
- **Equipo:** una sola persona, Cesar Garrido, autor, revisor y aprobador de las versiones. Se activará MFA en las
  cuentas implicadas en la publicación (intención, no verificada públicamente).
- **Privacidad:** [política de privacidad](https://cesargarridor.github.io/caesar-legal/privacy.html). Caesar no incluye telemetría ni analítica. Detalle:
  [política de firma en la web](https://cesargarridor.github.io/caesar/download.html#politica-de-firma-de-codigo).

## Actualizaciones automáticas

Caesar se actualiza solo, así que solo tienes que instalarlo a mano la primera vez.

- Por defecto, al abrir la app busca una versión nueva; si la hay, la descarga, la instala y se reinicia sola.
  Tus pestañas y borradores se conservan.
- Se controla en **Ajustes → Actualizaciones**: puedes **desactivarlas** o pulsar **Buscar actualizaciones** cuando quieras.
- Cada paquete va firmado y la app comprueba la firma antes de instalarlo.
- En Linux, la actualización automática solo funciona con el **AppImage**; el `.deb` hay que reinstalarlo a mano.

## Licencia

Caesar usa la **[Functional Source License, versión 1.1, con licencia futura MIT (FSL-1.1-MIT)](LICENSE)**, una licencia
«Fair Source» ([fsl.software](https://fsl.software/)). **No es una licencia de código abierto** (no cumple la definición de la OSI)
ni de software libre: el código es público para que puedas leerlo y usarlo, con límites.

**Permitido** (cualquier uso que no sea un «Uso competidor»):

- Usarlo para tu trabajo y para uso interno, en tu empresa o por tu cuenta.
- Estudiarlo, usarlo en educación y en investigación no comercial.
- Modificarlo y compartir tus cambios (con una copia de la licencia), por ejemplo proponiéndolos aquí.
- Prestar servicios profesionales a quien use Caesar conforme a esta licencia.

**Prohibido:**

- **Venderlo**, revenderlo o redistribuirlo como producto de pago.
- Ofrecer a otros, de forma comercial, un producto o servicio que sustituya a Caesar o que tenga la misma funcionalidad o una
  muy parecida (incluido un servicio alojado o una versión modificada que se venda).
- Usar el nombre, marca o logotipo de Caesar más allá de indicar su origen.

**Pasados dos años**, cada versión se puede usar también bajo la licencia **MIT** (a partir del segundo aniversario de su
publicación). Las versiones publicadas hasta la v0.11.2 se distribuyeron bajo licencia MIT; los permisos ya concedidos sobre
esas copias no se pueden retirar, pero **todas las versiones nuevas son FSL**.

Las contribuciones son bienvenidas y quedan sujetas a esta misma licencia.

Los temas de color (Monokai, Dracula, Tokyo Night, Nord, One Dark y GitHub Light) y otros componentes de terceros tienen su
origen y su licencia en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Caesar no usa Monokai Pro, que es de pago.

## Planes y suscripción

- **Invitado:** gratis, uso local sin cuenta. Los datos se guardan solo en tu dispositivo.
- **Cuenta:** 7 días de prueba local; si no activas Pro, la cuenta se elimina.
- **Pro:** suscripción gestionada por Lemon Squeezy (Merchant of Record) con **renovación automática**. El precio y la periodicidad (mensual o anual) se muestran en el checkout antes de pagar, con impuestos incluidos y sin cargos ocultos.
- **Cancelar:** cuando quieras, en Ajustes → Cuenta y suscripción → Gestionar suscripción (Pro hasta el fin del periodo pagado). Borrar la cuenta también cancela la suscripción.
- **Reembolso:** 14 días desde cualquier cobro.
- Legal: [Términos](https://cesargarridor.github.io/caesar-legal/terms.html) · [Privacidad](https://cesargarridor.github.io/caesar-legal/privacy.html) · [Reembolsos](https://cesargarridor.github.io/caesar-legal/refunds.html) · [Aviso legal](https://cesargarridor.github.io/caesar-legal/legal.html) · [Borrar datos](https://cesargarridor.github.io/caesar-legal/delete.html) · [Seguridad](https://cesargarridor.github.io/caesar-legal/security.html).
- En modo Invitado/local tus datos no salen del equipo; con la sincronización solo se suben bloques cifrados de extremo a extremo.

## Seguridad

- La interfaz nunca hace peticiones de red: todo pasa por Rust (`reqwest`) mediante IPC.
- Rust valida las URLs, solo permite `http`/`https` y limita el tamaño de respuestas y archivos.
- CSP estricta y permisos mínimos de Tauri.

## Sincronización cifrada de extremo a extremo

Usa tus peticiones y colecciones en varios ordenadores sin que nadie más pueda leerlas, ni siquiera el autor de Caesar.

- **Cifrado de extremo a extremo:** tus datos se cifran en tu equipo con **AES-256-GCM** antes de salir. Solo se sincronizan
  bloques cifrados; nadie más tiene la clave.
- **La clave nunca sale de tu equipo:** se genera de forma aleatoria y se guarda solo en el llavero del sistema operativo
  (Credential Manager en Windows, Keychain en macOS, Secret Service en Linux). La interfaz nunca la ve.
- **Vincular un equipo nuevo:** se hace con un código de 6 cifras que compruebas en ambos equipos. La clave viaja cifrada
  entre ellos con un intercambio X25519 + HKDF-SHA256, y la vinculación caduca a los 10 minutos.
- **Clave de recuperación:** al activar el cifrado se te muestra una sola vez. Guárdala en un gestor de contraseñas: con ella
  recuperas tus datos si pierdes todos los equipos.
- **Solo cuando hay cambios:** la sincronización ocurre en segundo plano; si no has cambiado nada, no se envía nada.

> Si pierdes todos tus equipos **y** la clave de recuperación, los datos no se pueden recuperar. Es el precio de que nadie más
> pueda leerlos.

Qué guarda la app y cómo borrar tus datos: [Seguridad](https://cesargarridor.github.io/caesar-legal/security.html) ·
[Borrar datos](https://cesargarridor.github.io/caesar-legal/delete.html).

## Primer uso

La primera vez que abres Caesar puedes **iniciar sesión**, **registrarte** o **continuar como invitado**. Como invitado los
datos se guardan solo en ese dispositivo; puedes crear la cuenta más tarde desde Ajustes → Cuenta y suscripción sin perder
lo local.

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
