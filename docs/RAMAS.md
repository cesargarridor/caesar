# Flujo de ramas y versiones

| Rama | Para qué | Quién la recibe |
|---|---|---|
| `master` | Lo que ve el usuario final. Solo se publica con `npm run release` (tag `vX.Y.Z`). | Todos (actualización automática). |
| `develop` | Donde se prueban las novedades. Cada `push` compila una **beta** y la publica en un repositorio privado. | Solo quien tú invites. |
| `feature/...` | Ramas de trabajo: salen de `develop` y vuelven a `develop` con un merge. | Nadie. |

## Día a día

```bash
git switch develop && git pull
git switch -c feature/mi-cambio          # sale de develop
# ...trabajar, commit...
git switch develop && git merge --no-ff feature/mi-cambio
git push origin develop                  # GitHub Actions compila la beta
```

Cuando lo probado en `develop` está bien, se pasa a `master` y se publica:

```bash
git switch master && git pull
git merge --no-ff --no-commit develop    # el script de release hace el commit
npm run release -- "mensaje" patch       # versión estable: la reciben todos
git switch develop && git merge master   # develop se queda al día
```

## La beta (privada)

Las betas se compilan en este repositorio (gratis) pero se publican en **`cesargarridor/caesar-beta`**, un repositorio
**privado**. Solo pueden descargarlas las personas que invites como colaboradoras de ese repositorio
(Settings → Collaborators → Add people, permiso *Read*). Cada beta es una Release `beta-N` con los instaladores de
Windows, macOS y Linux. **No se actualizan solas**: para probar una beta nueva se descarga e instala encima.

Configuración única (ya hecha si ves releases en `caesar-beta`):

1. Crear el repositorio privado `caesar-beta` (con un README, para que tenga rama por defecto).
2. Crear un token fino de GitHub (Settings → Developer settings → Fine-grained tokens) limitado a `caesar-beta`, con
   *Contents: Read and write*.
3. Guardarlo en este repositorio como secreto `BETA_TOKEN` (Settings → Secrets and variables → Actions).

Sin `BETA_TOKEN`, los pushes a `develop` no compilan nada (el flujo avisa y termina).

Versión de una beta: `X.Y.(Z+1)-N` (N = número de ejecución): mayor que la estable instalada y menor que la estable siguiente.
