// Exportación del Dashboard a Excel y PowerPoint — mismo patrón que en la
// aplicación de Compras (Aplicación Abastecimiento): usa los cuadros que ya
// están calculados en pantalla, así que es casi instantáneo (no vuelve a
// consultar la base de datos).

const ESTILO_ENCABEZADO = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } },
  alignment: { horizontal: 'center', vertical: 'middle' },
};

const FORMATO_MONEDA = '#,##0';
const FORMATO_PORCENTAJE = '0.0%';

function agregarHoja(libro, nombre, columnas, filas) {
  const hoja = libro.addWorksheet(nombre.slice(0, 31));
  hoja.columns = columnas.map((c) => ({ header: c.etiqueta, key: c.clave, width: c.ancho || 22 }));
  hoja.getRow(1).eachCell((celda) => { Object.assign(celda, ESTILO_ENCABEZADO); });
  (filas || []).forEach((f) => {
    const fila = hoja.addRow(f);
    columnas.forEach((c, i) => {
      if (c.formato) fila.getCell(i + 1).numFmt = c.formato;
    });
  });
  hoja.autoFilter = { from: 'A1', to: `${String.fromCharCode(65 + columnas.length - 1)}1` };
  return hoja;
}

export async function exportarDashboardExcel({ tarjetas, cuadros, nombreArchivo }) {
  const ExcelJS = (await import('exceljs')).default;
  const libro = new ExcelJS.Workbook();
  libro.creator = 'NS Proveedores';
  libro.created = new Date();

  // Resumen
  const hojaResumen = libro.addWorksheet('Resumen');
  hojaResumen.columns = [{ header: 'Indicador', key: 'a', width: 34 }, { header: 'Valor', key: 'b', width: 20 }];
  hojaResumen.getRow(1).eachCell((c) => Object.assign(c, ESTILO_ENCABEZADO));
  const filasResumen = [
    ['Cantidad solicitada', tarjetas.cantidad_solicitada, false],
    ['Cantidad pendiente', tarjetas.cantidad_pendiente, false],
    ['Cantidad entregada', tarjetas.cantidad_entregada, false],
    ['Indicador de cantidad (entregada/solicitada)', tarjetas.indicador_cantidad, true],
    ['Órdenes emitidas', tarjetas.ordenes_emitidas, false],
    ['Órdenes sin pendientes (in full)', tarjetas.ordenes_sin_pendientes, false],
    ['Órdenes completas (OTIF)', tarjetas.ordenes_completas, false],
    ['Órdenes a tiempo', tarjetas.ordenes_a_tiempo, false],
    ['Órdenes incumplidas', tarjetas.ordenes_incumplidas, false],
    ['On time', tarjetas.on_time, true],
    ['In full', tarjetas.in_full, true],
    ['OTIF', tarjetas.otif, true],
    ['Valor solicitado', tarjetas.valor_solicitado, false],
    ['Valor pendiente', tarjetas.valor_pendiente, false],
    ['Valor entregado', tarjetas.valor_entregado, false],
    ['NS Valor', tarjetas.ns_valor, true],
    ['Líneas solicitadas', tarjetas.lineas_totales, false],
    ['Líneas con pendiente', tarjetas.lineas_con_pendiente, false],
    ['Líneas entregadas', tarjetas.lineas_entregadas, false],
    ['Indicador de líneas (entregadas/solicitadas)', tarjetas.indicador_lineas, true],
  ];
  filasResumen.forEach(([a, b, esPorcentaje]) => {
    const fila = hojaResumen.addRow({ a, b });
    fila.getCell(2).numFmt = esPorcentaje ? FORMATO_PORCENTAJE : FORMATO_MONEDA;
  });

  agregarHoja(libro, 'Por proveedor', [
    { clave: 'proveedor', etiqueta: 'Proveedor', ancho: 34 },
    { clave: 'clasificacion', etiqueta: 'Clase ABCD', ancho: 12 },
    { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', formato: FORMATO_MONEDA },
    { clave: 'pct_pendiente', etiqueta: '% Pendiente', formato: FORMATO_PORCENTAJE },
    { clave: 'otif', etiqueta: 'OTIF', formato: FORMATO_PORCENTAJE },
    { clave: 'ns_valor', etiqueta: 'NS Valor', formato: FORMATO_PORCENTAJE },
    { clave: 'on_time', etiqueta: 'On time', formato: FORMATO_PORCENTAJE },
    { clave: 'in_full', etiqueta: 'In full', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_proveedor);

  agregarHoja(libro, 'Proveedores por clase', [
    { clave: 'clasificacion', etiqueta: 'Clase ABCD', ancho: 12 },
    { clave: 'cantidad_proveedores', etiqueta: '# Proveedores', ancho: 16 },
    { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', formato: FORMATO_MONEDA },
    { clave: 'ns_valor', etiqueta: 'NS Valor', formato: FORMATO_PORCENTAJE },
    { clave: 'ns_cantidad', etiqueta: 'NS Cantidad', formato: FORMATO_PORCENTAJE },
    { clave: 'ns_lineas', etiqueta: 'NS Líneas', formato: FORMATO_PORCENTAJE },
    { clave: 'on_time', etiqueta: 'On time', formato: FORMATO_PORCENTAJE },
    { clave: 'in_full', etiqueta: 'In full', formato: FORMATO_PORCENTAJE },
    { clave: 'otif', etiqueta: 'OTIF', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_proveedor_clase);

  agregarHoja(libro, 'Por item (ABCD)', [
    { clave: 'desc_item', etiqueta: 'Descripción ítem', ancho: 34 },
    { clave: 'clasificacion', etiqueta: 'Clase ABCD', ancho: 12 },
    { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', formato: FORMATO_MONEDA },
    { clave: 'ns_cantidad', etiqueta: 'NS Cantidad', formato: FORMATO_PORCENTAJE },
    { clave: 'ns_valor', etiqueta: 'NS Valor', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_item);

  agregarHoja(libro, 'Referencias por clase', [
    { clave: 'clasificacion', etiqueta: 'Clase ABCD', ancho: 12 },
    { clave: 'cantidad_referencias', etiqueta: '# Referencias', ancho: 16 },
    { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', formato: FORMATO_MONEDA },
    { clave: 'ns_valor', etiqueta: 'NS Valor', formato: FORMATO_PORCENTAJE },
    { clave: 'ns_cantidad', etiqueta: 'NS Cantidad', formato: FORMATO_PORCENTAJE },
    { clave: 'ns_lineas', etiqueta: 'NS Líneas', formato: FORMATO_PORCENTAJE },
    { clave: 'on_time', etiqueta: 'On time (por línea)', formato: FORMATO_PORCENTAJE },
    { clave: 'in_full', etiqueta: 'In full (por línea)', formato: FORMATO_PORCENTAJE },
    { clave: 'otif', etiqueta: 'OTIF (por línea)', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_referencia_clase);

  agregarHoja(libro, 'Motivos por faltante', [
    { clave: 'motivo', etiqueta: 'Motivo (faltante de ítem)', ancho: 30 },
    { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', formato: FORMATO_MONEDA },
    { clave: 'participacion', etiqueta: '% del total pendiente', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_motivo_faltante);

  agregarHoja(libro, 'Motivos por incumplimiento', [
    { clave: 'motivo', etiqueta: 'Motivo (incumplimiento en tiempo)', ancho: 30 },
    { clave: 'valor_orden', etiqueta: 'Valor de la orden', formato: FORMATO_MONEDA },
    { clave: 'participacion', etiqueta: '% del total', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_motivo_incumplimiento);

  agregarHoja(libro, 'Por C.O.', [
    { clave: 'co', etiqueta: 'C.O.', ancho: 14 },
    { clave: 'cantidad_solicitada', etiqueta: 'Cant. solicitada', formato: '#,##0.00' },
    { clave: 'cantidad_pendiente', etiqueta: 'Cant. pendiente', formato: '#,##0.00' },
    { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', formato: FORMATO_MONEDA },
    { clave: 'ns_valor', etiqueta: 'NS Valor', formato: FORMATO_PORCENTAJE },
    { clave: 'ns_cantidad', etiqueta: 'NS Cantidad', formato: FORMATO_PORCENTAJE },
    { clave: 'on_time', etiqueta: 'On time', formato: FORMATO_PORCENTAJE },
    { clave: 'in_full', etiqueta: 'In full', formato: FORMATO_PORCENTAJE },
    { clave: 'otif', etiqueta: 'OTIF', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_co);

  const buffer = await libro.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------
// Nota sobre el bug de tablas "distorsionadas": pptxgenjs, si no se le da
// una altura de fila explícita, escribe <a:tr h="0"> (que es válido -- le
// dice a PowerPoint "autoajusta la fila al contenido") pero el marco de la
// tabla (graphicFrame) sí queda con una altura fija y pequeña. Algunos
// visores (y a veces PowerPoint en el primer render) no auto-expanden bien
// esa combinación, así que el texto queda apretado/superpuesto. La solución
// es fijar SIEMPRE una altura de fila (rowH) calculada según cuántas filas
// tiene la tabla, para que quede bien desde el primer render.

function moneda(v) {
  return Math.round(Number(v || 0)).toLocaleString('es-CO');
}

function porcentaje(v) {
  return `${(Number(v || 0) * 100).toFixed(1)}%`;
}

// Forma compacta para tablas anchas (muchas columnas de dinero), donde no
// hay espacio para el número completo sin que se desborde o se envuelva.
function monedaCompacta(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

export async function exportarDashboardPowerPoint({ tarjetas, cuadros, medidaGrafico, resumenFiltros, nombreArchivo }) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'DASH', width: 10, height: 5.63 });
  pres.layout = 'DASH';

  const azul = '1565C0';
  const MARGEN_X = 0.4;
  const ANCHO_UTIL = 9.2; // 10 - 2*0.4, para que ninguna tabla se salga del margen
  const Y_TABLA = 0.85;
  const ALTO_DISPONIBLE = 5.63 - Y_TABLA - 0.4; // deja espacio para la nota al pie

  // Altura de fila explícita: evita el bug de filas "h=0" que se ve
  // distorsionado en algunos visores. Entre 0.22" (mínimo legible) y 0.5"
  // (para que tablas con pocas filas no queden con renglones gigantes).
  function altoFila(numFilas) {
    return Math.max(0.22, Math.min(0.5, ALTO_DISPONIBLE / numFilas));
  }

  const MARGEN_CELDA = [0.03, 0.06, 0.03, 0.06]; // top, right, bottom, left (in)

  // Portada
  const portada = pres.addSlide();
  portada.background = { color: 'F4F7FB' };
  portada.addText('Dashboard — Nivel de servicio de proveedores', {
    x: MARGEN_X, y: 1.8, w: ANCHO_UTIL, h: 1, fontSize: 26, bold: true, color: azul,
  });
  portada.addText(resumenFiltros || 'Todos los datos', {
    x: MARGEN_X, y: 2.7, w: ANCHO_UTIL, h: 0.8, fontSize: 13, color: '444444',
  });
  portada.addText(new Date().toLocaleDateString('es-CO'), {
    x: MARGEN_X, y: 5.0, w: ANCHO_UTIL, h: 0.4, fontSize: 10, color: '888888',
  });

  // KPIs
  const kpis = pres.addSlide();
  kpis.addText('Indicadores generales', { x: MARGEN_X, y: 0.3, fontSize: 20, bold: true, color: azul });
  const datosKpi = [
    ['Cantidades', `${Math.round(tarjetas.cantidad_solicitada).toLocaleString('es-CO')} solicitada / ${Math.round(tarjetas.cantidad_pendiente).toLocaleString('es-CO')} pendiente`, `${(tarjetas.indicador_cantidad * 100).toFixed(1)}%`],
    ['Órdenes de compra', `${tarjetas.ordenes_emitidas} emitidas / ${tarjetas.ordenes_sin_pendientes} sin pendientes`, `${(tarjetas.in_full * 100).toFixed(1)}%`],
    ['Tiempo de entrega', `${tarjetas.ordenes_a_tiempo} a tiempo / ${tarjetas.ordenes_incumplidas} incumplidas`, `${(tarjetas.on_time * 100).toFixed(1)}%`],
    ['Valor', `${Math.round(tarjetas.valor_solicitado).toLocaleString('es-CO')} solicitado / ${Math.round(tarjetas.valor_pendiente).toLocaleString('es-CO')} pendiente`, `${(tarjetas.ns_valor * 100).toFixed(1)}%`],
    ['Líneas', `${tarjetas.lineas_totales} solicitadas / ${tarjetas.lineas_con_pendiente} con pendiente`, `${(tarjetas.indicador_lineas * 100).toFixed(1)}%`],
    ['OTIF', '', `${(tarjetas.otif * 100).toFixed(1)}%`],
  ];
  const tablaKpi = [
    [{ text: 'Indicador', options: { bold: true, fill: { color: azul }, color: 'FFFFFF' } },
     { text: 'Detalle', options: { bold: true, fill: { color: azul }, color: 'FFFFFF' } },
     { text: '%', options: { bold: true, fill: { color: azul }, color: 'FFFFFF' } }],
    ...datosKpi.map((f) => f.map((v) => ({ text: String(v) }))),
  ];
  kpis.addTable(tablaKpi, {
    x: MARGEN_X, y: Y_TABLA, w: ANCHO_UTIL, fontSize: 12,
    border: { type: 'solid', color: 'CCCCCC', pt: 1 }, margin: MARGEN_CELDA,
    autoPage: false, rowH: altoFila(tablaKpi.length), valign: 'middle',
  });

  // ---- Gráfico nativo de PowerPoint (editable, no es una imagen) ----
  const porCoGrafico = cuadros.por_co || [];
  if (porCoGrafico.length) {
    const s = pres.addSlide();
    const etiquetaMedida = medidaGrafico?.etiqueta || 'OTIF';
    s.addText(`Gráfico: ${etiquetaMedida} por C.O. — periodo seleccionado`, { x: MARGEN_X, y: 0.3, fontSize: 16, bold: true, color: azul });
    s.addChart(pres.ChartType.bar, [
      { name: etiquetaMedida, labels: porCoGrafico.map((g) => g.co), values: porCoGrafico.map((g) => Math.round(Number(g[medidaGrafico?.valor || 'otif'] || 0) * 1000) / 10) },
    ], { x: MARGEN_X, y: 0.9, w: ANCHO_UTIL, h: 4.3, showLegend: true, legendPos: 'b', showValAxisTitle: false, catAxisLabelFontSize: 10, dataLabelFontSize: 9, showTitle: false, valAxisLabelFormatCode: '0"%"' });
  }

  // TOPE bajo (10) para tablas "detalle" que pueden tener muchas filas
  // (proveedor/ítem) -- así cada fila queda con una altura cómoda de leer.
  // Los cuadros "por clase" (A/B/C/D) tienen siempre 4 filas, no aplica.
  const TOPE_DETALLE = 10;

  function agregarSlideTabla(titulo, encabezados, filas, opciones = {}) {
    const slide = pres.addSlide();
    slide.addText(titulo, { x: MARGEN_X, y: 0.3, fontSize: 16, bold: true, color: azul });
    const tope = opciones.tope ?? TOPE_DETALLE;
    const totalFilas = (filas || []).length;
    const filasLimitadas = (filas || []).slice(0, tope);
    const fontSize = opciones.fontSize || (encabezados.length >= 8 ? 8 : 9);
    const tabla = [
      encabezados.map((h) => ({ text: h, options: { bold: true, fill: { color: azul }, color: 'FFFFFF', fontSize } })),
      ...filasLimitadas.map((fila) => fila.map((v) => ({ text: String(v ?? ''), options: { fontSize } }))),
    ];
    slide.addTable(tabla, {
      x: MARGEN_X, y: Y_TABLA, w: ANCHO_UTIL, fontSize,
      border: { type: 'solid', color: 'DDDDDD', pt: 0.5 }, margin: MARGEN_CELDA,
      autoPage: false, rowH: altoFila(tabla.length), valign: 'middle',
    });
    const nota = totalFilas > tope
      ? `Mostrando el top ${tope} de ${totalFilas} registros (ordenado de mayor a menor). Descarga el Excel para verlos todos.`
      : `Mostrando los ${totalFilas} registro(s) de este cuadro.`;
    slide.addText(opciones.nota || nota, { x: MARGEN_X, y: 5.3, w: ANCHO_UTIL, fontSize: 9, italic: true, color: '888888' });
  }

  agregarSlideTabla('Detalle por proveedor — Pareto ABCD (top 10 por valor solicitado)', ['Proveedor', 'Clase', 'Valor solicitado', 'Valor pendiente', 'OTIF'],
    (cuadros.por_proveedor || []).map((f) => [f.proveedor, f.clasificacion, moneda(f.valor_solicitado), moneda(f.valor_pendiente), porcentaje(f.otif)]));

  agregarSlideTabla('Proveedores por clasificación (resumen A/B/C/D)',
    ['Clase', '# Prov.', 'V. solicitado', 'V. pendiente', 'NS Valor', 'OTIF'],
    (cuadros.por_proveedor_clase || []).map((f) => [f.clasificacion, f.cantidad_proveedores, monedaCompacta(f.valor_solicitado), monedaCompacta(f.valor_pendiente), porcentaje(f.ns_valor), porcentaje(f.otif)]),
    { tope: 4, nota: 'Ver el Excel exportado para NS Cantidad, NS Líneas, On time e In full de cada clase.' });

  agregarSlideTabla('Detalle por ítem — Pareto ABCD (top 10 por valor solicitado)', ['Descripción ítem', 'Clase', 'Valor solicitado', 'Valor pendiente', 'NS Valor'],
    (cuadros.por_item || []).map((f) => [f.desc_item, f.clasificacion, moneda(f.valor_solicitado), moneda(f.valor_pendiente), porcentaje(f.ns_valor)]));

  agregarSlideTabla('Referencias por clasificación (resumen A/B/C/D)',
    ['Clase', '# Ref.', 'V. solicitado', 'V. pendiente', 'NS Valor', 'OTIF'],
    (cuadros.por_referencia_clase || []).map((f) => [f.clasificacion, f.cantidad_referencias, monedaCompacta(f.valor_solicitado), monedaCompacta(f.valor_pendiente), porcentaje(f.ns_valor), porcentaje(f.otif)]),
    { tope: 4, nota: 'OTIF de referencias es por línea, no por orden completa. Ver el Excel para el detalle completo.' });

  agregarSlideTabla('Detalle por C.O.',
    ['C.O.', 'Valor solicitado', 'Valor pendiente', 'NS Valor', 'OTIF'],
    (cuadros.por_co || []).map((f) => [f.co, moneda(f.valor_solicitado), moneda(f.valor_pendiente), porcentaje(f.ns_valor), porcentaje(f.otif)]),
    { tope: 20, nota: 'Ver el Excel exportado para cantidades, NS Cantidad, On time e In full de cada C.O.' });

  agregarSlideTabla('Motivos por faltante de ítem — valor pendiente y participación (top 10)', ['Motivo', 'Valor pendiente', '% del total'],
    (cuadros.por_motivo_faltante || []).map((f) => [f.motivo, moneda(f.valor_pendiente), porcentaje(f.participacion)]));

  agregarSlideTabla('Motivos por incumplimiento en tiempo de entrega — valor de la orden (top 10)', ['Motivo', 'Valor de la orden', '% del total'],
    (cuadros.por_motivo_incumplimiento || []).map((f) => [f.motivo, moneda(f.valor_orden), porcentaje(f.participacion)]));

  await pres.writeFile({ fileName: nombreArchivo });
}
