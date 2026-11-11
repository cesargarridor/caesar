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
