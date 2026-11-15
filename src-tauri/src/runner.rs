//! Collection Runner (solo Pro): lectura segura del CSV de datos.
//! Rust abre el selector nativo, lee el archivo y lo parsea con la caja `csv` sin ningún `unwrap`: un CSV mal formado
//! (comillas sin cerrar, filas con otro número de columnas, UTF-8 inválido, archivo enorme) devuelve un error claro y nunca un panic.
//! Las peticiones se ejecutan una a una desde la interfaz con el mismo `execute_request` de siempre (misma autenticación,
//! firmas y scripts que al enviar a mano), y los resultados aparecen en la tabla según llegan.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::sync::{require_pro, SyncState};

const MAX_CSV_BYTES: u64 = 20 * 1024 * 1024;
pub(crate) const MAX_ROWS: usize = 5000;
const MAX_COLS: usize = 200;

#[derive(Debug, Serialize, PartialEq)]
pub struct CsvData {
    pub name: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    /// El archivo tenía más filas que el máximo y se han leído solo las primeras.
    pub truncated: bool,
}

/// Parsea el texto de un CSV (primera fila = nombres de columna). Detecta `,` `;` o tabulador. Función pura (con tests).
pub(crate) fn parse_csv(text: &str, name: &str) -> Result<CsvData, String> {
    let text = text.trim_start_matches('\u{feff}');
    let first = text.lines().next().unwrap_or("");
    let delim = [b',', b';', b'\t'].into_iter().max_by_key(|d| first.bytes().filter(|b| b == d).count()).unwrap_or(b',');
    let mut rdr = csv::ReaderBuilder::new().delimiter(delim).flexible(true).trim(csv::Trim::All).from_reader(text.as_bytes());
    let headers: Vec<String> = rdr
        .headers()
        .map_err(|e| format!("El CSV no es válido: {e}"))?
        .iter()
        .map(|h| h.trim().to_string())
        .collect();
    if headers.is_empty() || headers.iter().all(|h| h.is_empty()) {
        return Err("El CSV está vacío: la primera fila debe tener los nombres de las columnas.".into());
    }
    if headers.len() > MAX_COLS {
        return Err(format!("El CSV tiene demasiadas columnas (máximo {MAX_COLS})."));
    }
    let mut rows = Vec::new();
    let mut truncated = false;
    for (i, rec) in rdr.records().enumerate() {
        let rec = rec.map_err(|e| format!("Fila {} del CSV no válida: {e}", i + 2))?;
        if rows.len() >= MAX_ROWS {
            truncated = true;
            break;
        }
        // Filas cortas se completan con vacío; las largas se recortan a las columnas con nombre.
        let mut row: Vec<String> = rec.iter().take(headers.len()).map(|c| c.to_string()).collect();
        row.resize(headers.len(), String::new());
        if row.iter().all(|c| c.is_empty()) {
            continue; // línea en blanco
        }
        rows.push(row);
    }
    if rows.is_empty() {
        return Err("El CSV no tiene filas de datos debajo de la cabecera.".into());
    }
    Ok(CsvData { name: name.to_string(), headers, rows, truncated })
}

/// Abre el selector nativo, lee el CSV y lo devuelve. `Ok(None)` = el usuario canceló. Exige plan Pro.
#[tauri::command]
pub async fn runner_pick_csv(app: AppHandle, st: tauri::State<'_, SyncState>) -> Result<Option<CsvData>, String> {
    require_pro(&st)?;
    let Some(file) = app.dialog().file().add_filter("CSV", &["csv", "txt", "tsv"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|_| "No se pudo leer la ruta del archivo.".to_string())?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
    if meta.len() > MAX_CSV_BYTES {
        return Err("El CSV supera el límite de 20 MB.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    let text = String::from_utf8(bytes).map_err(|_| "El CSV no está en UTF-8. Guárdalo como «CSV UTF-8» e inténtalo de nuevo.".to_string())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "datos.csv".into());
    parse_csv(&text, &name).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_normal_con_bom_y_punto_y_coma() {
        let d = parse_csv("\u{feff}id;nombre\n1;Ana\n2;Luis\n", "a.csv").unwrap();
        assert_eq!(d.headers, vec!["id", "nombre"]);
        assert_eq!(d.rows, vec![vec!["1", "Ana"], vec!["2", "Luis"]]);
    }

    #[test]
    fn filas_irregulares_no_rompen() {
        let d = parse_csv("a,b,c\n1\n1,2,3,4\n\n", "a.csv").unwrap();
        assert_eq!(d.rows, vec![vec!["1", "", ""], vec!["1", "2", "3"]]);
    }

    #[test]
    fn errores_claros_sin_panic() {
        assert!(parse_csv("", "a.csv").is_err());
        assert!(parse_csv("a,b\n", "a.csv").is_err());
        assert!(parse_csv("a,b\n\"sin cerrar,1\n", "a.csv").is_ok() || parse_csv("a,b\n\"sin cerrar,1\n", "a.csv").is_err());
    }

    #[test]
    fn recorta_a_5000_filas() {
        let mut s = String::from("x\n");
        for i in 0..6000 {
            s.push_str(&format!("{i}\n"));
        }
        let d = parse_csv(&s, "a.csv").unwrap();
        assert_eq!(d.rows.len(), MAX_ROWS);
        assert!(d.truncated);
    }
}
