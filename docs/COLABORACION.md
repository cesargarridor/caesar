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
