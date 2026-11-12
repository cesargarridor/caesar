# Colaboración local-first (diseño)

## La magia del «local-first» en colaboración

Para que la aplicación siga volando, la interfaz de React no debe saber que la colección está compartida en internet. Para React, sigue siendo un simple archivo en el ordenador.

1. **Edición instantánea:** tú o un miembro del equipo modificáis una petición (por ejemplo, cambiáis un header). Al guardar, Rust lo escribe en el disco local en 1 milisegundo. La interfaz se actualiza al instante, sin lag.
2. **Sincronización fantasma:** el hilo asíncrono de Rust (con `tokio`) detecta que ese archivo tiene la etiqueta «Compartido». En segundo plano, de forma invisible para el usuario, Rust sube esa modificación a Firebase.
3. **Recepción sin tirones:** en el ordenador del compañero, su trabajador de Rust consulta Firebase en silencio cada pocos segundos. Si detecta un cambio, descarga el nuevo JSON, actualiza el disco local y avisa a React: «hay datos nuevos». La petición se actualiza en su pantalla de forma fluida.

## Cómo estructurarlo en Firebase (el sistema de códigos)

El acceso por invitación mediante códigos es directo en Firestore y encaja con la regla de «cero mantenimiento»:

- **Generar el enlace:** cuando el usuario pulsa «Compartir», Rust genera un código aleatorio (p. ej. `TEAM-9A4X`). En Firebase, en lugar de guardar los datos en `/usuarios/{tu_uid}`, Rust crea un documento nuevo en `/equipos/TEAM-9A4X`.
- **Unirse con código:** el compañero pulsa «Acceder con código» e introduce `TEAM-9A4X`. Su aplicación en Rust va a esa ruta de Firebase, comprueba que existe, descarga el JSON y lo guarda en su disco local. A partir de ahí, los trabajadores de fondo de ambos ordenadores escuchan y actualizan ese mismo documento en la nube.
- **Reglas de seguridad:** en las reglas de Firebase, para leer o escribir en `/equipos/` el usuario debe tener ese código guardado en su perfil, bloqueando a cualquier intruso.

## El salto al modelo B2B (Business to Business)

(Pendiente de desarrollar.)

## Estado de la implementación (rama develop)

- **Código:** `TEAM-XXXX-XXXX-XXXX` (60 bits). El documento es `/teams/{hash(código)}` y el contenido va cifrado con una clave
  derivada del código (HKDF): el servidor no puede leer la colección ni conoce el código.
- **Crear / unirse:** «Nueva colección» → crear propia, o pegar un código para unirse. Una colección propia se comparte con
  el botón de equipo de su fila: antes sale un aviso (pasa a ser de todos; si el dueño elimina su cuenta se elimina para todos)
  con botones para guardar una copia en JSON, YAML o HAR.
- **Sincronización:** la edición es local e instantánea. Tras 2,5 s sin teclear se suben los cambios y cada 10 s se consultan los
  de los compañeros (Rust hace la red: `src-tauri/src/team.rs`). Conflictos: gana la última escritura (colección entera).
- **Dueño:** `owner` = quien la creó. Al eliminar la cuenta (`sync_delete_account`) se borran sus colecciones de equipo; si el
  dueño deja de compartir, los demás conservan su copia local ya sin vínculo.
- **Reglas de Firebase:** hay que desplegar `firebase/firestore.rules` (incluye `/teams`) para que funcione:
  `cd firebase && npx firebase-tools deploy --only firestore:rules --project caesar-sync-app`.
- Requiere haber iniciado sesión (no funciona como invitado).
