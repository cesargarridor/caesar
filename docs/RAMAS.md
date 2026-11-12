# Flujo de ramas y versiones

| Rama | Para qué | Quién la recibe |
|---|---|---|
| `master` | Lo que ve el usuario final. Solo se publica con `npm run release` (tag `vX.Y.Z`). | Todos (actualización automática estable). |
| `develop` | Donde se prueban las novedades. Cada `push` compila y publica una pre-release fija llamada **dev**. | Solo quien activa el canal de desarrollo. |
| `feature/...` | Ramas de trabajo: salen de `develop` y vuelven a `develop` con un merge. | Nadie. |

## Día a día

```bash
git switch develop && git pull
git switch -c feature/mi-cambio          # sale de develop
# ...trabajar, commit...
git switch develop && git merge --no-ff feature/mi-cambio
git push origin develop                  # GitHub Actions publica la versión «dev»
```

Cuando lo probado en `develop` está bien: se pasa a `master` y se publica.

```bash
git switch master && git pull
git merge --no-ff develop
npm run release -- "mensaje" patch       # versión estable: la reciben todos
git switch develop && git merge master   # develop se queda al día
```

## Cómo recibir solo tú las versiones de desarrollo

En **Ajustes → Actualizaciones**, pulsa 5 veces sobre el recuadro «Versión instalada»: aparece la casilla
**Recibir versiones de desarrollo**. Con ella marcada, Caesar mira
`releases/download/dev/latest.json` en lugar de la última versión estable. Los demás no ven esa casilla, y aunque la
activaran, las versiones de desarrollo no se marcan nunca como «latest» en GitHub.

- Versión de una build de desarrollo: `X.Y.(Z+1)-N` (N = número de ejecución). Es mayor que la estable instalada y menor
  que la estable siguiente, así que al publicar la estable, el canal de desarrollo la recibe también.
- Para volver a estable: desmarca la casilla; la siguiente actualización estable te devuelve a ella.
