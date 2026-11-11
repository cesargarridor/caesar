# Avisos de terceros y licencias de los temas

Caesar es software libre bajo la [licencia MIT](LICENSE). Este archivo recoge el origen y la licencia de los esquemas
de color que incluye el selector de temas (Ajustes → Tema). Solo se usan **paletas de colores** (valores hexadecimales);
no se copia código, iconos ni imágenes de esos proyectos.

## Temas con licencia MIT (comprobada en el repositorio oficial)

La licencia MIT permite usar, copiar, modificar y distribuir el material, incluso con fines comerciales, siempre que se
conserven el aviso de copyright y el texto de la licencia. Aquí se conservan:

| Tema en Caesar | Origen | Copyright |
| --- | --- | --- |
| Dracula | [dracula/dracula-theme](https://github.com/dracula/dracula-theme) | © 2023 Dracula Theme |
| Tokyo Night | [enkia/tokyo-night-vscode-theme](https://github.com/enkia/tokyo-night-vscode-theme) | © 2018-present Enkia |
| Nord | [nordtheme/nord](https://github.com/nordtheme/nord) | © 2016-present Sven Greb (Arctic Ice Studio) |
| One Dark | [atom/one-dark-syntax](https://github.com/atom/one-dark-syntax) | © 2016 GitHub Inc. |
| GitHub Light | [primer/primitives](https://github.com/primer/primitives) | © 2018 GitHub Inc. |

Texto de la licencia MIT, aplicable a cada uno de los proyectos de la tabla con su copyright respectivo:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Monokai (tema predeterminado)

- El tema **«Monokai»** de Caesar usa la paleta clásica de Monokai, creada por Wimer Hazenberg en 2006 y publicada en
  la wiki de TextMate. Es la misma paleta que incluye Visual Studio Code como tema integrado
  ([microsoft/vscode, `extensions/theme-monokai`](https://github.com/microsoft/vscode/tree/main/extensions/theme-monokai),
  licencia MIT) y que se ha redistribuido durante casi veinte años en editores y terminales.
- El autor original **no publicó una licencia de software explícita** para la paleta clásica. Los colores
  (`#272822`, `#f92672`, `#a6e22e`, `#66d9ef`, `#fd971f`, `#ae81ff`, `#e6db74`, `#75715e`…) son simples valores de color y
  Caesar no copia ningún archivo de tema, solo reproduce esos valores.
- **Monokai Pro** es un producto de pago distinto (paleta y diseño propios, [monokai.pro](https://monokai.pro)). Caesar **no
  incluye ni usa** Monokai Pro, ni su interfaz, ni sus iconos, ni sus colores.
- **«Monokai Light»** es una variante clara hecha por Caesar a partir de esos colores; no es un producto oficial de
  Monokai.
- Caesar no está afiliado ni respaldado por Monokai ni por Wimer Hazenberg. «Monokai» es el nombre de su esquema y se
  usa solo para indicar el estilo de color.

Si eres el autor y prefieres que se retire o se cambie el nombre, abre una incidencia y se hará.

## Tema Caesar

El tema «Caesar» (colores, gatito y degradados) es original del proyecto y se publica bajo la licencia MIT del repositorio.

## Otros componentes

- Iconos: [Lucide](https://lucide.dev) (licencia ISC).
- Interfaz: React (MIT), Tailwind CSS (MIT), Vite (MIT).
- Aplicación de escritorio: Tauri (MIT o Apache-2.0) y las bibliotecas de Rust indicadas en `src-tauri/Cargo.lock`, cada una
  con su propia licencia permisiva.
- La tipografía «PP Neue Montreal» **no se distribuye** con Caesar: solo se usa si ya está instalada en el equipo y, si no,
  se usa Inter o la fuente del sistema.
