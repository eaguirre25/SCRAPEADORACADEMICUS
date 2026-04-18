const dashboardUrl = './data/dashboard.json';
let rawData = null;
let map;
let openLayer;
let permanentLayer;
let themeChart;
let countryChart;
let quartileChart;
let countdownInterval;

const palette = ['#00e5ff','#c44dff','#39ff88','#ffb020','#ff5c7a','#7aa2ff','#63e6be','#f783ac'];

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  rawData = await fetch(dashboardUrl, { cache: 'no-store' }).then(r => r.json());
  fillMetrics(rawData.metrics);
  buildFilterOptions(rawData.items, rawData.source_catalog || []);
  bindFilters();
  renderAll();
  registerSW();
}

function fillMetrics(m) {
  document.getElementById('metric-sources').textContent   = m.source_count ?? 0;
  document.getElementById('metric-scraped')?.textContent && (document.getElementById('metric-scraped').textContent = m.source_count_scraped ?? 0);
  document.getElementById('metric-total').textContent     = m.open_with_deadline ?? 0;
  const dossierTotal = (m.dossier_count ?? 0) + (m.especial_count ?? 0);
  document.getElementById('metric-dossier').textContent   = dossierTotal;
  document.getElementById('metric-permanent').textContent = m.permanent_sources ?? 0;
  document.getElementById('metric-closed').textContent    = m.cerrada_count ?? 0;
  document.getElementById('metric-sin-conv').textContent  = m.sin_convocatoria ?? 0;
  document.getElementById('metric-new').textContent       = m.new_items ?? 0;
  const dt = m.generated_at ? new Date(m.generated_at) : null;
  document.getElementById('metric-updated').textContent   = dt ? dt.toLocaleString('es-AR') : '—';
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

function uniqueValues(items, accessor) {
  return [...new Set(items.flatMap(accessor).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), 'es')
  );
}

function buildFilterOptions(items, catalog) {
  const regionSel = document.getElementById('filter-region');
  uniqueValues(items, i => [i.region]).forEach(v => {
    regionSel.appendChild(new Option(v, v));
  });

  const themeSel = document.getElementById('filter-theme');
  uniqueValues(items, i => i.themes || []).forEach(v => {
    themeSel.appendChild(new Option(v, v));
  });
}

function bindFilters() {
  ['filter-region','filter-theme','filter-mode','filter-quartile','filter-search'].forEach(id => {
    document.getElementById(id)?.addEventListener('input',  renderAll);
    document.getElementById(id)?.addEventListener('change', renderAll);
  });
  document.getElementById('btn-export-csv')?.addEventListener('click',   exportCSV);
  document.getElementById('btn-export-excel')?.addEventListener('click', exportExcel);
  // Buscador específico del catálogo
  document.getElementById('catalog-search')?.addEventListener('input', renderCatalogOnly);
}

function getFilters() {
  return {
    region:   document.getElementById('filter-region')?.value   || 'all',
    theme:    document.getElementById('filter-theme')?.value    || 'all',
    mode:     document.getElementById('filter-mode')?.value     || 'all',
    quartile: document.getElementById('filter-quartile')?.value || 'all',
    search:   (document.getElementById('filter-search')?.value || '').trim().toLowerCase(),
  };
}

function matchesQuartile(item, quartileFilter) {
  if (quartileFilter === 'all') return true;
  const NBRA_LABELS = ['NBRA', 'SciELO', 'RedALyC', 'DOAJ'];
  const LAT_LABELS  = ['Latindex'];
  if (quartileFilter === 'NBRA')    return NBRA_LABELS.includes(item.quality_label);
  if (quartileFilter === 'Latindex')return item.latindex_catalogada || LAT_LABELS.includes(item.quality_label);
  return item.quartile === quartileFilter;
}

function filterItems(items) {
  const f = getFilters();
  return items.filter(item => {
    if (f.region !== 'all' && item.region !== f.region) return false;
    if (f.theme  !== 'all' && !(item.themes || []).includes(f.theme)) return false;
    if (f.mode   !== 'all' && item.call_mode !== f.mode)  return false;
    if (!matchesQuartile(item, f.quartile))                return false;
    if (f.search) {
      const blob = [item.title, item.dossier_topic, item.source_name, item.country,
                    item.city, item.summary, ...(item.themes || []), ...(item.tags || [])]
        .join(' ').toLowerCase();
      if (!blob.includes(f.search)) return false;
    }
    return true;
  });
}

function filterCatalog(catalog) {
  const f = getFilters();
  const catSearch = (document.getElementById('catalog-search')?.value || '').trim().toLowerCase();
  return (catalog || []).filter(item => {
    if (f.region !== 'all' && item.region !== f.region)               return false;
    if (f.theme  !== 'all' && !(item.themes || []).includes(f.theme)) return false;
    if (f.mode === 'deadline'  && item.status !== 'activa hoy')        return false;
    if (f.mode === 'permanent' && item.status !== 'recepcion continua') return false;
    if (f.quartile !== 'all') {
      const pseudo = { quartile: item.quartile, quality_label: item.quality_label, latindex_catalogada: item.latindex_catalogada };
      if (!matchesQuartile(pseudo, f.quartile)) return false;
    }
    // Filtro global (barra superior)
    if (f.search) {
      const blob = [item.source_name, item.country, item.status, item.quality_label,
                    ...(item.themes || [])].join(' ').toLowerCase();
      if (!blob.includes(f.search)) return false;
    }
    // Buscador específico del catálogo (nombre + área temática + cuartil)
    if (catSearch) {
      const blob = [
        item.source_name,
        ...(item.themes || []),
        item.quartile || '',
        item.quality_label || '',
        item.quality_source || '',
        item.country || '',
      ].join(' ').toLowerCase();
      if (!blob.includes(catSearch)) return false;
    }
    return true;
  });
}

// ─── Render principal ─────────────────────────────────────────────────────────

function renderCatalogOnly() {
  const catalog = filterCatalog(rawData.source_catalog || []);
  renderCatalog(catalog);
}

function renderAll() {
  const items   = filterItems(rawData.items || []);
  const catalog = filterCatalog(rawData.source_catalog || []);
  renderMap(items);
  renderCountdown(items);
  renderCharts(items);
  renderStrategic(items);
  renderContinuousList(items);
  renderCatalog(catalog);
}

// ─── Mapa ─────────────────────────────────────────────────────────────────────

function markerHtml(type, urgency) {
  const color = type === 'permanent'
    ? '#00e5ff'
    : urgency === 'crítica' ? '#ff5c7a' : urgency === 'próxima' ? '#ffb020' : '#39ff88';
  const hollow = type === 'permanent';
  return `<div style="width:16px;height:16px;border-radius:50%;border:2px solid ${color};
    background:${hollow ? 'transparent' : color};box-shadow:0 0 12px ${color}"></div>`;
}

function renderMap(items) {
  if (!map) {
    map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([2, -40], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);
    openLayer      = L.layerGroup().addTo(map);
    permanentLayer = L.layerGroup().addTo(map);
    L.control.layers(null, {
      'Convocatorias abiertas': openLayer,
      'Recepción continua':     permanentLayer,
    }, { collapsed: false }).addTo(map);
  }
  openLayer.clearLayers();
  permanentLayer.clearLayers();

  const deadlineItems  = items.filter(i => i.status === 'abierta' && i.call_mode !== 'permanent');
  const permanentItems = dedupePermanent(items);

  [...deadlineItems, ...permanentItems].forEach(item => {
    if (typeof item.latitude !== 'number' || typeof item.longitude !== 'number') return;
    const icon = L.divIcon({
      className: 'custom-marker',
      html: markerHtml(item.call_mode, item.urgency),
      iconSize: [16,16], iconAnchor: [8,8],
    });
    const qualityLine = item.quartile
      ? `<span>SCImago <strong>${item.quartile}</strong>${item.sjr ? ' · SJR ' + item.sjr : ''}</span><br>`
      : item.quality_label ? `<span>${item.quality_label}${item.quality_source ? ' · ' + item.quality_source : ''}</span><br>` : '';

    const popup = `
      <strong>${escapeHtml(item.title)}</strong><br>
      <span>${escapeHtml(item.source_name)}</span><br>
      <span>${escapeHtml(item.country)}${item.city ? ' · ' + escapeHtml(item.city) : ''}</span><br>
      ${qualityLine}
      <span>${item.call_mode === 'permanent' ? 'Recepción continua' : 'Cierre ' + (item.deadline_iso || 'sin fecha')}</span><br>
      <span>Tema: ${escapeHtml(item.dossier_topic || item.title)}</span><br>
      <a href="${item.url}" target="_blank" rel="noopener noreferrer">Ir a la convocatoria</a>
    `;
    const marker = L.marker([item.latitude, item.longitude], { icon }).bindPopup(popup);
    if (item.call_mode === 'permanent') permanentLayer.addLayer(marker);
    else openLayer.addLayer(marker);
  });
}

// ─── Countdown ────────────────────────────────────────────────────────────────

function renderCountdown(items) {
  const upcoming = items
    .filter(i => i.call_mode === 'deadline' && i.deadline_iso && i.status === 'abierta')
    .sort((a, b) => a.deadline_iso.localeCompare(b.deadline_iso));

  const next = upcoming[0];
  const el   = document.getElementById('countdown');
  const card = document.getElementById('next-call-card');
  clearInterval(countdownInterval);

  if (!next) {
    el.textContent = 'Sin convocatorias con cierre detectado';
    card.innerHTML = '<p>No hay convocatorias con fecha límite visibles en este momento.</p>';
  } else {
    const badgeClass = next.urgency === 'crítica' ? 'badge-critical'
                     : next.urgency === 'próxima' ? 'badge-next' : 'badge-open';
    const qualityBadge = next.quartile
      ? `<span class="call-badge badge-quartile">${next.quartile}</span>`
      : next.quality_label ? `<span class="call-badge badge-quality">${next.quality_label}</span>` : '';

    card.innerHTML = `
      <div>
        <span class="call-badge ${badgeClass}">${next.urgency}</span>
        <span class="call-badge badge-open">${next.country}</span>
        ${qualityBadge}
        ${next.open_access ? '<span class="call-badge badge-oa">Acceso abierto</span>' : ''}
      </div>
      <h3>${escapeHtml(next.title)}</h3>
      <p><strong>${escapeHtml(next.source_name)}</strong></p>
      <p>${escapeHtml(next.deadline_iso || 'sin fecha')} · ${escapeHtml((next.themes || []).join(', '))}</p>
      <p><small>Calidad: ${escapeHtml(qualityDetail(next))}</small></p>
      <p><small>Tema dossier: ${escapeHtml(next.dossier_topic || next.title)}</small></p>
      <a class="action-link" href="${next.url}" target="_blank" rel="noopener noreferrer">Abrir convocatoria</a>
    `;
    updateCountdown(next);
    countdownInterval = setInterval(() => updateCountdown(next), 1000);
  }

  // Tabla de próximos con botones de exportar
  const exportBar = document.getElementById('export-bar');
  if (exportBar) {
    exportBar.innerHTML = `
      <button id="btn-export-csv"   class="export-btn">⬇ Exportar CSV</button>
      <button id="btn-export-excel" class="export-btn">⬇ Exportar Excel</button>
    `;
    document.getElementById('btn-export-csv').addEventListener('click',   exportCSV);
    document.getElementById('btn-export-excel').addEventListener('click', exportExcel);
  }

  const tbody = document.getElementById('upcoming-body');
  tbody.innerHTML = upcoming.slice(0, 10).map(item => `
    <tr>
      <td>${escapeHtml(item.source_name)}</td>
      <td class="topic-cell">${escapeHtml(item.dossier_topic || item.title)}</td>
      <td>${escapeHtml(quartileDisplay(item))}</td>
      <td>${escapeHtml(item.deadline_iso || '—')}</td>
      <td>${typeof item.days_left === 'number' ? item.days_left + ' días' : '—'}</td>
      <td><a href="${item.url}" target="_blank" rel="noopener noreferrer">Ir</a></td>
    </tr>
  `).join('');
}

function updateCountdown(item) {
  const target = new Date(item.deadline_iso + 'T23:59:59');
  const diff   = target.getTime() - Date.now();
  const el     = document.getElementById('countdown');
  if (diff <= 0) { el.textContent = 'Vencida. Se mostrará la siguiente al refrescar.'; return; }
  const s = Math.floor(diff / 1000);
  el.textContent = `${Math.floor(s/86400)}d ${String(Math.floor((s%86400)/3600)).padStart(2,'0')}h `
                 + `${String(Math.floor((s%3600)/60)).padStart(2,'0')}m ${String(s%60).padStart(2,'0')}s`;
}

// ─── Gráficos ─────────────────────────────────────────────────────────────────

function percentageLabels(labels, values) {
  const total = values.reduce((a, v) => a + v, 0) || 1;
  return labels.map((l, i) => `${l} (${Math.round((values[i] / total) * 100)}%)`);
}

function renderCharts(items) {
  const themeMap   = new Map();
  const countryMap = new Map();
  const quartileMap= new Map();

  const combined = [
    ...items.filter(i => i.status === 'abierta' && i.call_mode !== 'permanent'),
    ...dedupePermanent(items),
  ];

  combined.forEach(item => {
    (item.themes || []).forEach(t => themeMap.set(t, (themeMap.get(t) || 0) + 1));
    if (item.country) countryMap.set(item.country, (countryMap.get(item.country) || 0) + 1);
    const q = item.quartile || item.quality_label || 'Sin dato';
    quartileMap.set(q, (quartileMap.get(q) || 0) + 1);
  });

  const themeLabelsRaw  = [...themeMap.keys()];
  const themeValues     = themeLabelsRaw.map(l => themeMap.get(l));
  const themeLabels     = percentageLabels(themeLabelsRaw, themeValues);

  const countryLabels   = [...countryMap.keys()].slice(0, 10);
  const countryValues   = countryLabels.map(l => countryMap.get(l));

  const quartileLabels  = [...quartileMap.keys()];
  const quartileValues  = quartileLabels.map(l => quartileMap.get(l));

  // Conteos de tipo de convocatoria desde rawData.call_type_counts
  const ctCounts = rawData.call_type_counts || [];
  const ctLabels = ctCounts.map(x => ({
    dossier:'Dossier', especial:'Especial', convocatoria:'Conv. regular',
    continua:'Publicación continua', cerrada:'Cerrada'
  }[x.type] || x.type));
  const ctValues = ctCounts.map(x => x.count);

  if (themeChart)   themeChart.destroy();
  if (countryChart) countryChart.destroy();
  if (quartileChart) quartileChart.destroy();
  if (window._ctChart) window._ctChart.destroy();

  if (ctValues.length > 0) {
    const ctCtx = document.getElementById('callTypeChart');
    if (ctCtx) {
      window._ctChart = new Chart(ctCtx, {
        type: 'doughnut',
        data: {
          labels: percentageLabels(ctLabels, ctValues),
          datasets: [{ data: ctValues, backgroundColor: ['#c44dff','#7aa2ff','#00e5ff','#39ff88','#ff5c7a'], borderColor:'#0b1020', borderWidth:2 }],
        },
        options: {
          plugins: {
            legend: { labels: { color:'#e6f1ff', boxWidth:14 } },
            title: { display:true, text:'Tipo de convocatoria', color:'#8ea2c5', font:{size:13} },
          }
        }
      });
    }
  }

  themeChart = new Chart(document.getElementById('themeChart'), {
    type: 'doughnut',
    data: {
      labels: themeLabels,
      datasets: [{ data: themeValues, backgroundColor: palette, borderColor: '#0b1020', borderWidth: 2 }],
    },
    options: {
      plugins: {
        legend: { labels: { color: '#e6f1ff', boxWidth: 14 } },
        tooltip: { callbacks: { label: ctx => {
          const total = ctx.dataset.data.reduce((a,v) => a+v, 0) || 1;
          return `${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw/total*100)}%)`;
        }}}
      }
    }
  });

  countryChart = new Chart(document.getElementById('countryChart'), {
    type: 'bar',
    data: {
      labels: countryLabels,
      datasets: [{ label: 'Convocatorias', data: countryValues, backgroundColor: '#00e5ff' }],
    },
    options: {
      scales: {
        x: { ticks: { color: '#e6f1ff' }, grid: { color: 'rgba(142,162,197,0.08)' } },
        y: { ticks: { color: '#e6f1ff' }, grid: { color: 'rgba(142,162,197,0.08)' } },
      },
      plugins: { legend: { labels: { color: '#e6f1ff' } } },
    }
  });

  quartileChart = new Chart(document.getElementById('quartileChart'), {
    type: 'doughnut',
    data: {
      labels: percentageLabels(quartileLabels, quartileValues),
      datasets: [{ data: quartileValues, backgroundColor: palette.slice().reverse(), borderColor: '#0b1020', borderWidth: 2 }],
    },
    options: {
      plugins: {
        legend: { labels: { color: '#e6f1ff', boxWidth: 14 } },
        title: { display: true, text: 'Distribución por calidad/cuartil', color: '#8ea2c5', font: { size: 13 } },
      }
    }
  });
}

// ─── Radar estratégico ────────────────────────────────────────────────────────

function renderStrategic(items) {
  const strategic = [...items]
    .sort((a, b) =>
      (b.strategic_score || 0) - (a.strategic_score || 0) ||
      String(a.quartile || '').localeCompare(String(b.quartile || '')) ||
      (a.days_left ?? 999999) - (b.days_left ?? 999999)
    )
    .slice(0, 10);

  document.getElementById('strategic-list').innerHTML = strategic.map(item => {
    const badgeClass = item.call_mode === 'permanent' ? 'badge-perm'
                     : item.urgency === 'crítica' ? 'badge-critical'
                     : item.urgency === 'próxima' ? 'badge-next' : 'badge-open';
    const qBadge = item.quartile
      ? `<span class="call-badge badge-quartile">${item.quartile}</span>`
      : item.quality_label ? `<span class="call-badge badge-quality">${item.quality_label}</span>` : '';

    return `
      <article class="strategic-item">
        <div class="strategic-head">
          <div class="score-pill">${item.strategic_score || 0}</div>
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <div><strong>${escapeHtml(item.source_name)}</strong></div>
          </div>
        </div>
        <div class="meta-line">
          <span class="call-badge ${badgeClass}">${item.call_mode === 'permanent' ? 'continua' : item.urgency}</span>
          ${qBadge}
          ${item.open_access ? '<span class="call-badge badge-oa">OA</span>' : ''}
          <span>${escapeHtml(item.country)}</span>
          <span>${escapeHtml((item.themes || []).join(', '))}</span>
          <span>${item.deadline_iso ? 'Cierra ' + escapeHtml(item.deadline_iso) : 'Sin fecha visible'}</span>
        </div>
        <div class="meta-line"><span>Tema: ${escapeHtml(item.dossier_topic || item.title)}</span></div>
        <div class="meta-line"><span>Calidad: ${escapeHtml(qualityDetail(item))}</span></div>
        <a class="action-link" href="${item.url}" target="_blank" rel="noopener noreferrer">Ir a la convocatoria</a>
      </article>
    `;
  }).join('');
}

// ─── Lista continua ───────────────────────────────────────────────────────────

function renderContinuousList(items) {
  const tbody = document.getElementById('continuous-body');
  if (!tbody) return;
  tbody.innerHTML = dedupePermanent(items)
    .sort((a, b) => (b.strategic_score || 0) - (a.strategic_score || 0) || a.source_name.localeCompare(b.source_name, 'es'))
    .map(item => `
      <tr>
        <td>${escapeHtml(item.source_name)}</td>
        <td>${escapeHtml(item.country || '—')}</td>
        <td class="topic-cell">${escapeHtml((item.themes || []).join(', '))}<br><small>${escapeHtml(item.dossier_topic || item.title)}</small></td>
        <td>${escapeHtml(quartileDisplay(item))}</td>
        <td>Recepción continua</td>
        <td><a href="${item.url}" target="_blank" rel="noopener noreferrer">Ir</a></td>
      </tr>
    `).join('');
}

// ─── Catálogo ─────────────────────────────────────────────────────────────────

function qBadgeHtml(item) {
  const q = item.quartile;
  const ql = item.quality_label || '';
  const sjr = item.sjr ? `<span class="sjr-val">SJR ${item.sjr}</span>` : '';
  if (q) {
    const cls = {'Q1':'q1','Q2':'q2','Q3':'q3','Q4':'q4'}[q] || '';
    return `<td class="td-q"><span class="${cls}">${q}</span>${sjr}</td><td class="td-sjr">${item.sjr || '—'}</td>`;
  }
  if (ql) {
    const cls = ql === 'NBRA' ? 'nbra' : ql.startsWith('Latindex') ? 'lat' : '';
    return `<td class="td-q"><span class="${cls}">${escapeHtml(ql)}</span></td><td class="td-sjr">—</td>`;
  }
  return '<td class="td-q">—</td><td class="td-sjr">—</td>';
}

function renderCatalog(catalog) {
  const tbody = document.getElementById('catalog-body');
  if (!tbody) return;

  // Ordenar: primero activas, luego continua, luego resto; dentro de cada grupo por Q luego nombre
  const statusRank = s => s === 'activa hoy' ? 0 : s === 'recepcion continua' ? 1 : s === 'reapertura anunciada' ? 2 : 3;
  const qRank = q => ({'Q1':0,'Q2':1,'Q3':2,'Q4':3,'NBRA':4,'SciELO':5,'Latindex':6}[q] ?? 9);

  const sorted = [...catalog].sort((a, b) =>
    statusRank(a.status) - statusRank(b.status) ||
    qRank(a.quartile || a.quality_label) - qRank(b.quartile || b.quality_label) ||
    a.source_name.localeCompare(b.source_name, 'es')
  );

  const total = catalog.length;
  document.getElementById('catalog-count')
    && (document.getElementById('catalog-count').textContent = `${total} revista${total !== 1 ? 's' : ''}`);

  tbody.innerHTML = sorted.map(item => `
    <tr>
      <td class="td-name">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="rev-link">
          ${escapeHtml(item.source_name)}
        </a>
      </td>
      <td>${escapeHtml(item.country || '—')}</td>
      <td class="topic-cell">${escapeHtml((item.themes || []).join(' · '))}</td>
      ${qBadgeHtml(item)}
      <td>${item.latindex_catalogada ? '<span class="lat-check">✔</span>' : '—'}</td>
      <td>${statusBadge(item.status)}</td>
      <td>${callTypeBadge(item.call_type_detected)}</td>
      <td><a href="${item.url}" target="_blank" rel="noopener noreferrer">→</a></td>
    </tr>
  `).join('');
}

function statusBadge(status) {
  if (status === 'activa hoy')         return '<span class="ct-badge ct-conv">Activa</span>';
  if (status === 'recepcion continua') return '<span class="ct-badge ct-perm">Continua</span>';
  if (status === 'reapertura anunciada') return '<span class="ct-badge ct-especial">Reapertura</span>';
  return '<span style="color:var(--muted);font-size:12px">Sin conv.</span>';
}

// ─── Exportar CSV ─────────────────────────────────────────────────────────────

function exportCSV() {
  const items = filterItems(rawData.items || []);
  const headers = [
    'Revista','País','Ciudad','Temas','Tema dossier','Cuartil',
    'Calidad','Fuente calidad','SJR','H-index','Acceso abierto',
    'Latindex','Estado','Modo','Urgencia','Cierre','Días restantes',
    'Puntaje estratégico','URL',
  ];
  const rows = items.map(i => [
    i.source_name, i.country, i.city, (i.themes||[]).join('; '),
    i.dossier_topic || i.title, i.quartile||'', i.quality_label||'',
    i.quality_source||'', i.sjr||'', i.h_index||'',
    i.open_access ? 'Sí' : 'No',
    i.latindex_catalogada ? 'Sí' : 'No',
    i.status, i.call_mode, i.urgency,
    i.deadline_iso||'', i.days_left ?? '', i.strategic_score, i.url,
  ]);

  const csvContent = [headers, ...rows]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const bom = '\uFEFF'; // BOM para Excel
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `dossier_${today()}.csv`);
}

// ─── Exportar Excel (SheetJS) ─────────────────────────────────────────────────

function exportExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Cargando SheetJS, intentá de nuevo en unos segundos.');
    return;
  }
  const items = filterItems(rawData.items || []);
  const headers = [
    'Revista','País','Ciudad','Temas','Tema dossier','Cuartil',
    'Calidad','Fuente calidad','SJR','H-index','Acceso abierto',
    'Latindex cat.','Estado','Modo','Urgencia','Cierre','Días rest.',
    'Puntaje','URL',
  ];
  const rows = items.map(i => [
    i.source_name, i.country, i.city, (i.themes||[]).join('; '),
    i.dossier_topic || i.title, i.quartile||'', i.quality_label||'',
    i.quality_source||'', i.sjr||'', i.h_index||'',
    i.open_access ? 'Sí':'No', i.latindex_catalogada ? 'Sí':'No',
    i.status, i.call_mode, i.urgency,
    i.deadline_iso||'', i.days_left ?? '', i.strategic_score, i.url,
  ]);

  const wb  = XLSX.utils.book_new();
  const ws  = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((_, i) => ({ wch: [32,12,14,28,38,9,12,20,8,9,10,10,14,12,12,16,10,10,50][i] || 16 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Convocatorias');
  XLSX.writeFile(wb, `dossier_${today()}.xlsx`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function normalizeKey(v) {
  return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
}

function permanentKey(item) {
  return [normalizeKey(item.source_name), normalizeKey(item.country), normalizeKey(item.city), 'permanent'].join('|');
}

function dedupePermanent(items) {
  const best = new Map();
  items.filter(i => i.call_mode === 'permanent').forEach(item => {
    const key = permanentKey(item);
    const cur = best.get(key);
    if (!cur || (item.strategic_score||0) > (cur.strategic_score||0)) best.set(key, item);
  });
  return [...best.values()];
}

function qualityDetail(item) {
  return [item.quartile, item.sjr ? `SJR ${item.sjr}` : null,
          item.quality_label, item.quality_source].filter(Boolean).join(' · ') || 'Sin dato visible';
}

function quartileDisplay(item) {
  if (item.quartile) return `${item.quartile}${item.sjr ? ' · SJR ' + item.sjr : ''}`;
  return item.quality_label || '—';
}

function confidenceBadge(c) {
  if (!c || c === '')      return '<span style="color:var(--muted);font-size:11px">curada</span>';
  if (c === 'high')        return '<span class="conf-badge conf-high">✓ alta</span>';
  if (c === 'medium')      return '<span class="conf-badge conf-med">~ media</span>';
  if (c === 'low')         return '<span class="conf-badge conf-low">! baja</span>';
  return '—';
}

function callTypeBadge(ct) {
  if (!ct || ct === 'convocatoria') return '<span class="ct-badge ct-conv">Conv.</span>';
  if (ct === 'dossier')    return '<span class="ct-badge ct-dossier">Dossier</span>';
  if (ct === 'especial')   return '<span class="ct-badge ct-especial">Especial</span>';
  if (ct === 'continua')   return '<span class="ct-badge ct-perm">Continua</span>';
  if (ct === 'cerrada')    return '<span class="ct-badge ct-closed">Cerrada</span>';
  return '—';
}

function escapeHtml(value) {
  return String(value||'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

init().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    `<div style="padding:16px;color:#ff5c7a">No se pudo cargar el dashboard: ${err.message}</div>`);
});
