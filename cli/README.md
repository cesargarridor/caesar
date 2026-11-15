# Caesar CLI

Ejecuta colecciones de Caesar (exportadas en JSON) o de Postman (v2.1) desde la terminal o CI/CD. Un único ejecutable en Rust: sin Node.js ni `npm install`.

```bash
cargo build --release          # dentro de esta carpeta → target/release/caesar (≈1,7 MB)
caesar run coleccion.json -e entorno.json --var token=abc --data usuarios.csv --reporter junit --out informe.xml
```

- `--folder NOMBRE` ejecuta solo una carpeta · `--bail` se detiene en el primer fallo · `--timeout SEG` (30 por defecto).
- Con `--data` se ejecuta toda la colección una vez por fila del CSV; las columnas son variables (`{{columna}}`).
- Salida: `0` todo bien · `1` alguna petición falló (HTTP ≥ 400 o error de red) · `2` uso incorrecto.
- Límite actual: los scripts de tests (`pm.test…`) no se ejecutan; una petición es correcta si responde con estado < 400.
