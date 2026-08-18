import * as XLSX from 'xlsx';
import Papa from 'papaparse';

// Quita tildes, puntuación y espacios extra para poder comparar encabezados
// sin importar cómo vengan escritos en el archivo origen.
export function normalizarEncabezado(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function excelFechaAISO(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') {
    const fecha = XLSX.SSF.parse_date_code(valor);
    if (!fecha) return null;
    const mm = String(fecha.m).padStart(2, '0');
    const dd = String(fecha.d).padStart(2, '0');
    return `${fecha.y}-${mm}-${dd}`;
  }
  const texto = String(valor).trim();
  const m = texto.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  return texto;
}

// Convierte un texto con formato de número colombiano ("$ 12.543,050",
// "3.512.053,00", "180,00"...) a un Number de JS.
//
// La versión anterior asumía que "3 dígitos después de un separador =
// separador de miles" para distinguirlo del separador decimal. Eso rompía
// cualquier precio con 3 decimales (frecuente en costos unitarios,
// p.ej. "12.543,050"): el "," quedaba mal identificado como separador de
// miles, se borraba junto con el ".", y el resultado terminaba siendo
// 1000 veces más grande (12543050 en vez de 12543,05) -- el bug que
// reportaste como "el decimal deja de ser decimal".
//
// Ahora: el separador decimal es SIEMPRE el ÚLTIMO "." o "," que aparece
// en el texto (sin importar cuántos dígitos tenga detrás); todo separador
// ANTES de ese se trata como separador de miles y se elimina. Así "12.543,050"
// da 12543.050 (correcto) y "3.512.053,00" sigue dando 3512053.00.
function numeroDesdeTexto(texto) {
  const limpio = String(texto).replace(/[^0-9.,-]/g, '').trim();
  if (!limpio) return NaN;
  const posUltimoPunto = limpio.lastIndexOf('.');
  const posUltimaComa = limpio.lastIndexOf(',');
  const posDecimal = Math.max(posUltimoPunto, posUltimaComa);
  if (posDecimal === -1) return Number(limpio);
  const parteEntera = limpio.slice(0, posDecimal).replace(/[.,]/g, '');
  const parteDecimal = limpio.slice(posDecimal + 1);
  return Number(`${parteEntera}.${parteDecimal}`);
}

function numeroOCero(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  // Si Excel ya entrega un número nativo (lo normal en columnas numéricas
  // reales), se usa tal cual -- nunca se re-parsea como texto, que es
  // donde vivía el bug de arriba.
  if (typeof valor === 'number') return valor;
  const num = numeroDesdeTexto(valor);
  return isNaN(num) ? 0 : num;
}

function numeroONull(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor === 'number') return valor;
  const num = numeroDesdeTexto(valor);
  return isNaN(num) ? null : num;
}

// Lee un File (xlsx/xls/csv) y devuelve un arreglo de objetos {encabezadoOriginal: valor}
export async function leerArchivo(file) {
  const nombre = file.name.toLowerCase();
  if (nombre.endsWith('.csv')) {
    const texto = await file.text();
    const resultado = Papa.parse(texto, { header: true, skipEmptyLines: true });
    if (resultado.errors && resultado.errors.length > 0) {
      throw new Error(`Error leyendo CSV: ${resultado.errors[0].message}`);
    }
    return resultado.data;
  }
  const buffer = await file.arrayBuffer();
  const libro = XLSX.read(buffer, { type: 'array', cellDates: false });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return XLSX.utils.sheet_to_json(hoja, { defval: null, raw: true });
}

function mapearGenerico(filaCruda, mapeo) {
  const fila = {};
  for (const [encabezadoOriginal, valor] of Object.entries(filaCruda)) {
    const clave = mapeo[normalizarEncabezado(encabezadoOriginal)];
    if (clave) fila[clave] = valor;
  }
  return fila;
}

// ---------------------------------------------------------------------
// Pedidos (hoja "DETALLE" en tu Excel actual, base "ODC x Item")
// Llave de duplicado ("YAVE"): C.O. + Nro orden (ODC) + Referencia +
// Bodega -- confirmado por el usuario (no solo Nro orden + Referencia,
// que podía colisionar entre C.O./bodegas distintos).
// ---------------------------------------------------------------------
export const MAPEO_PEDIDOS = {
  fechadecumplido: 'fecha_cumplido',
  nroorden: 'nro_orden',
  ordendecompra: 'nro_orden',
  co: 'co',
  // El archivo real a veces trae el encabezado como "C.O. Docto." en vez
  // de simplemente "CO" -- se aceptan las dos variantes.
  codocto: 'co',
  ccodocto: 'co',
  bodega: 'bodega',
  proveedor: 'proveedor',
  referencia: 'referencia',
  descitem: 'desc_item',
  cantordenada: 'cant_ordenada',
  cantidadordenada: 'cant_ordenada',
  cantentradainv: 'cant_entrada_inv',
  cantidadentradainv: 'cant_entrada_inv',
  cantpendienteinv: 'cant_pendiente_inv',
  cantidadpendienteinv: 'cant_pendiente_inv',
  fechaorden: 'fecha_orden',
  preciounit: 'precio_unit',
  valorbruto: 'valor_bruto',
  doctoreferencia: 'docto_referencia',
  notasdocumento: 'notas_documento',
};

export function mapearFilasPedidos(filasCrudas) {
  const filas = [];
  const erroresFilas = [];

  filasCrudas.forEach((filaCruda, indice) => {
    const fila = mapearGenerico(filaCruda, MAPEO_PEDIDOS);

    const faltantes = ['nro_orden', 'referencia'].filter((c) => !fila[c] && fila[c] !== 0);
    if (faltantes.length > 0) {
      erroresFilas.push({
        fila: indice + 2,
        error: `Faltan campos obligatorios: ${faltantes.join(', ')}`,
        nro_orden: fila.nro_orden ?? '', co: fila.co ?? '', proveedor: fila.proveedor ?? '',
        referencia: fila.referencia ?? '', desc_item: fila.desc_item ?? '',
      });
      return;
    }

    fila.nro_orden = String(fila.nro_orden).trim();
    fila.referencia = String(fila.referencia).trim();
    fila.co = fila.co !== undefined && fila.co !== null ? String(fila.co).trim() : '';

    // El archivo real trae varios campos de texto con espacios de relleno
    // (padding fijo del ERP, p.ej. bodega "9    "). Se recortan ANTES de
    // construir el YAVE, que ahora depende de C.O. + Nro orden + Referencia + Bodega.
    for (const campo of ['bodega', 'proveedor', 'desc_item', 'docto_referencia', 'notas_documento']) {
      if (fila[campo] !== undefined && fila[campo] !== null) fila[campo] = String(fila[campo]).trim();
    }

    fila.yave = `${fila.co}${fila.nro_orden}${fila.referencia}${fila.bodega || ''}`.trim();

    for (const campo of ['cant_ordenada', 'cant_entrada_inv', 'cant_pendiente_inv', 'precio_unit', 'valor_bruto']) {
      fila[campo] = numeroOCero(fila[campo]);
    }
    fila.fecha_orden = excelFechaAISO(fila.fecha_orden);
    fila.fecha_cumplido = excelFechaAISO(fila.fecha_cumplido);

    filas.push(fila);
  });

  return { filas, erroresFilas };
}

export function claveUnicaPedido(fila) {
  return fila.yave;
}

// ---------------------------------------------------------------------
// EA / Entradas (hoja "EA" - Evaluación de proveedores / Documentos de
// compra por ítem). Acumulativa: cada carga se agrega, no reemplaza.
// ---------------------------------------------------------------------
export const MAPEO_EA = {
  yave: 'yave',
  codocto: 'co_docto',
  ccodocto: 'co_docto',
  doctoorden: 'docto_orden',
  proveedor: 'proveedor',
  bodega: 'bodega',
  referencia: 'referencia',
  descitem: 'desc_item',
  documento: 'documento',
  cantidad: 'cantidad',
  valorsubtotallocal: 'valor_subtotal',
  valorsubtotal: 'valor_subtotal',
  doctocausacion: 'docto_causacion',
  doctoreferencia: 'docto_referencia',
  fecha: 'fecha',
  descmotivo: 'desc_motivo',
  doctobase: 'docto_base',
};

export function mapearFilasEA(filasCrudas) {
  const filas = [];
  const erroresFilas = [];

  filasCrudas.forEach((filaCruda, indice) => {
    const fila = mapearGenerico(filaCruda, MAPEO_EA);

    // El archivo real trae varios campos de texto con espacios de relleno
    // (padding fijo del ERP, p.ej. "15377        "). Se recortan para que
    // no afecten comparaciones/joins ni se vean mal en pantalla.
    for (const campo of ['referencia', 'proveedor', 'bodega', 'docto_orden', 'docto_referencia', 'co_docto']) {
      if (fila[campo] !== undefined && fila[campo] !== null) fila[campo] = String(fila[campo]).trim();
    }

    // El archivo real que se descarga del ERP ("EA.xlsx") NO trae una
    // columna "YAVE" (a diferencia de la hoja "EA" del xlsb original) --
    // se calcula igual que en Pedidos: C.O. (columna "C.O. Docto.") +
    // Docto. orden (= Nro orden / ODC) + Referencia + Bodega. Si el
    // archivo sí trae YAVE (por ejemplo, una carga histórica desde el
    // Excel viejo), se respeta el valor que venga.
    if (!fila.yave) {
      if (fila.docto_orden && fila.referencia) {
        fila.yave = `${fila.co_docto || ''}${fila.docto_orden}${fila.referencia}${fila.bodega || ''}`;
      }
    }

    if (!fila.yave) {
      erroresFilas.push({
        fila: indice + 2,
        error: 'No se pudo calcular YAVE (falta "Docto. orden" y/o "Referencia")',
        proveedor: fila.proveedor ?? '',
        referencia: fila.referencia ?? '',
      });
      return;
    }
    fila.yave = String(fila.yave).trim();
    fila.docto_orden = fila.docto_orden !== undefined && fila.docto_orden !== null ? String(fila.docto_orden).trim() : fila.docto_orden;
    fila.cantidad = numeroONull(fila.cantidad);
    fila.valor_subtotal = numeroONull(fila.valor_subtotal);
    fila.fecha = excelFechaAISO(fila.fecha);
    filas.push(fila);
  });

  return { filas, erroresFilas };
}

// ---------------------------------------------------------------------
// Histórico de ODC (hoja "ODC"). Acumulativa, con upsert por Nro orden
// (si la orden ya existía, se actualiza la fecha con la más reciente que
// traiga el archivo).
// ---------------------------------------------------------------------
export const MAPEO_ODC = {
  co: 'co',
  nroorden: 'nro_orden',
  fecha: 'fecha',
};

export function mapearFilasODC(filasCrudas) {
  const filas = [];
  const erroresFilas = [];

  filasCrudas.forEach((filaCruda, indice) => {
    const fila = mapearGenerico(filaCruda, MAPEO_ODC);
    if (!fila.nro_orden) {
      erroresFilas.push({ fila: indice + 2, error: 'Falta Nro orden' });
      return;
    }
    fila.nro_orden = String(fila.nro_orden).trim();
    fila.co = fila.co !== undefined && fila.co !== null ? String(fila.co).trim() : null;
    fila.fecha = excelFechaAISO(fila.fecha);
    if (!fila.fecha) {
      erroresFilas.push({ fila: indice + 2, error: 'Falta o no se pudo leer la fecha', nro_orden: fila.nro_orden });
      return;
    }
    filas.push(fila);
  });

  return { filas, erroresFilas };
}

// ---------------------------------------------------------------------
// Tiempo de entrega por proveedor (hoja "TIEMPO DE ENTREGA"). Reemplaza
// la data existente en cada carga. Llave: C.O. + Proveedor.
// ---------------------------------------------------------------------
export const MAPEO_TIEMPO_ENTREGA = {
  co: 'co',
  proveedor: 'proveedor',
  tipodeentrega: 'tipo_entrega',
  tiempodeentrega: 'dias_entrega',
  nit: 'nit',
  condiciondepago: 'condicion_pago',
  sucursal: 'sucursal',
  pedidominimovalor: 'pedido_minimo_valor',
  pedidominimopeso: 'pedido_minimo_peso',
  pedidominimokl: 'pedido_minimo_peso',
  pedidominimovolumen: 'pedido_minimo_volumen',
  pedidominimom3: 'pedido_minimo_volumen',
  pedidominimocajas: 'pedido_minimo_cajas',
  pedidominimoum: 'pedido_minimo_cajas',
  pedidominimounidades: 'pedido_minimo_unidades',
};

export function mapearFilasTiempoEntrega(filasCrudas) {
  const filas = [];
  const erroresFilas = [];

  filasCrudas.forEach((filaCruda, indice) => {
    const fila = mapearGenerico(filaCruda, MAPEO_TIEMPO_ENTREGA);
    if (!fila.co || !fila.proveedor) {
      erroresFilas.push({ fila: indice + 2, error: 'Falta C.O. o Proveedor', proveedor: fila.proveedor ?? '' });
      return;
    }
    fila.co = String(fila.co).trim();
    fila.proveedor = String(fila.proveedor).trim();
    fila.dias_entrega = numeroOCero(fila.dias_entrega);
    for (const campo of ['pedido_minimo_valor', 'pedido_minimo_peso', 'pedido_minimo_volumen', 'pedido_minimo_cajas', 'pedido_minimo_unidades']) {
      fila[campo] = numeroONull(fila[campo]);
    }
    filas.push(fila);
  });

  return { filas, erroresFilas };
}
