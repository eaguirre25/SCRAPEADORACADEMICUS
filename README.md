# Dossier Tracker Académico v4

Rastreador diario de convocatorias de revistas científicas en educación, ciencias sociales, humanidades, sociología, política y dirección escolar. Publica los resultados en un dashboard oscuro con mapa, contador de vencimiento, gráficos temáticos, radar estratégico y **enriquecimiento automático con SCImago, Latindex y CAICYT-CONICET**.

## Qué trae esta versión

- Rastreador diario en GitHub Actions
- **Enriquecimiento automático de calidad** desde los CSV de SCImago (Q1–Q4) y el catálogo Latindex (Indice de temas)
- **Filtro por cuartil** (Q1 / Q2 / Q3 / Q4 / NBRA / Latindex / todos) en el dashboard
- **Exportar a CSV y Excel** directamente desde el dashboard
- Issue automático en GitHub cuando aparecen novedades
- Alerta por email configurable (SMTP)
- Reporte Excel generado también en el servidor (`reports/`)
- Dashboard oscuro con mapa de dos capas, countdown, gráficos, radar estratégico
- Modo PWA para instalarlo como app en Chrome / Edge

---

## Estructura del repositorio

```
dossier-tracker/
├── .github/workflows/dossier_daily.yml   ← workflow de GitHub Actions
├── config/
│   ├── keywords.yml                      ← palabras clave y ponderación
│   ├── sources.yml                       ← lista de revistas a rastrear
│   └── rankings/                         ← ⚠ ponés aquí los CSV de SCImago y Latindex
│       ├── scimagojr_2024__Subject_Category__Education.csv
│       ├── scimagojr_2024__Subject_Category__Sociology_and_Political_Science.csv
│       ├── scimagojr_2024__Subject_Category__Social_Work.csv
│       ├── scimagojr_2024__Subject_Category__Cultural_Studies.csv
│       ├── scimagojr_2024__Subject_Category__Philosophy.csv
│       ├── scimagojr_2024__Subject_Category__Social_Sciences_miscellaneous.csv
│       ├── Indice_temas.csv
│       ├── Indice_temas_1.csv
│       ├── Indice_temas_2.csv
│       └── Indice_temas_3.csv
├── src/
│   └── dossier_tracker.py                ← script principal
├── docs/
│   ├── index.html                        ← dashboard
│   ├── app.js
│   ├── styles.css
│   ├── service-worker.js
│   ├── manifest.webmanifest
│   └── data/dashboard.json              ← generado por el tracker
├── data/                                ← generado por el tracker
├── reports/                             ← reportes Markdown y Excel generados
├── scripts/
│   ├── run_local_dashboard.py
│   └── run_local_dashboard.bat
└── requirements.txt
```

---

## Configuración en GitHub

### 1. Crear el repositorio
Subí todos los archivos respetando la estructura.

### 2. Copiar los CSV de rankings
Copiá los archivos CSV de SCImago y de Latindex (Indice de temas) a la carpeta `config/rankings/`. El tracker los lee automáticamente para enriquecer la calidad de cada revista.

### 3. Activar permisos de Actions
`Settings → Actions → General → Workflow permissions → Read and write permissions`

### 4. Configurar secretos para email (opcional)
`Settings → Secrets and variables → Actions → New repository secret`

| Secret | Valor |
|---|---|
| `SMTP_HOST` | p. ej. `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | tu dirección de email |
| `SMTP_PASSWORD` | contraseña de aplicación |
| `EMAIL_TO` | destinatario |

### 5. Correr por primera vez
`Actions → dossier-latam-diario → Run workflow`

### 6. Activar GitHub Pages
`Settings → Pages → Deploy from a branch → main → /docs`

---

## Agregar revistas

Editá `config/sources.yml`. Si la revista tiene ISSN, el tracker la busca automáticamente en los CSV de SCImago y Latindex y completa el cuartil.

```yaml
- name: Nombre de la revista
  url: https://...
  issn: "1234-5678"          # ← clave para el enriquecimiento automático
  region: Argentina
  language: es
  country: Argentina
  city: Buenos Aires
  latitude: -34.6037
  longitude: -58.3816
  source_kind: revista
  call_mode_hint: mixed      # mixed | deadline | permanent
  tags: [educación, dirección escolar]
  quality_label: NBRA        # solo si no tiene ISSN o no figura en SCImago
  quality_source: CAICYT-CONICET
```

### Valores de `call_mode_hint`

| Valor | Cuándo usarlo |
|---|---|
| `mixed` | la revista a veces tiene convocatoria con fecha y a veces no |
| `deadline` | siempre publica llamados con cierre explícito |
| `permanent` | recepción continua permanente |

---

## Ver el dashboard localmente

**Windows:** doble clic en `scripts/run_local_dashboard.bat`

**Python:**
```bash
python scripts/run_local_dashboard.py
```
Luego abrir `http://localhost:8000/docs/`

---

## Exportar datos

Desde el dashboard podés exportar la tabla filtrada a **CSV** o **Excel** con los botones de la sección "Próximo vencimiento". El tracker también genera un archivo Excel en `reports/dossier_YYYY-MM-DD.xlsx` en cada corrida.
