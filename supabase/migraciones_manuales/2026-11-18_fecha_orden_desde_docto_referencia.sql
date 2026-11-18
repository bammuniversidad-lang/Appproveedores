-- =====================================================================
-- "Docto. referencia" está en el histórico de ODC pero NO se trae la
-- fecha real de la orden.
--
-- EL CASO QUE REPORTASTE: la línea ODC-00194115 (C.O. 001, FAMILIA
-- SANCELA) tiene fecha de orden 2026-10-30 y Docto. referencia 193933.
-- En el histórico, ODC-00193933 del C.O. 001 es del 2026-10-28. Esa es la
-- fecha real en que se pidió, pero la línea seguía con la del 30.
--
-- POR QUÉ PASABA: la corrección automática solo miraba UN caso -- el de
-- las líneas donde el ERP había dejado la fecha de la orden IGUAL a la
-- fecha de entrada. Esta línea tiene fecha de orden 2026-10-30 y fecha de
-- entrada 2026-11-03: como no coincidían, la línea ni siquiera entraba a
-- evaluarse, así que el Docto. referencia nunca se consultaba. (Lo
-- comprobé: con la función anterior, esta línea daba "0 evaluadas".)
--
-- QUÉ CAMBIA: ahora también se corrige la segunda situación -- la orden
-- fue MODIFICADA y su "Docto. referencia" apunta a una orden anterior que
-- sí está en el histórico. En los dos casos se exige que la fecha del
-- histórico sea ANTERIOR a la que tiene hoy la línea, lo que evita mover
-- fechas hacia adelante y hace que la corrección sea repetible.
--
-- ⚠️  IMPORTANTE — ESTO CAMBIA EL INDICADOR: al tomar la fecha real de la
-- orden original, el tiempo de entrega de esas líneas se vuelve más largo
-- y algunas pasarán de CUMPLIDO a INCUMPLIDO. Es el comportamiento
-- correcto (se mide desde que se pidió de verdad), pero el porcentaje de
-- nivel de servicio se va a mover. Por eso el PASO 1 es una consulta que
-- te deja ver cuántas líneas cambiarían ANTES de aplicar nada.
--
-- CÓMO EJECUTARLO: Dashboard de Supabase > proyecto ns-proveedores >
-- SQL Editor > New query. Corre primero el PASO 1 (selecciónalo y pulsa
-- Run). Si el impacto te cuadra, corre el PASO 2 y luego el PASO 3.
-- =====================================================================

-- =====================================================================
-- PASO 1 — VISTA PREVIA (no cambia nada). Cuántas líneas se corregirían
-- por el caso nuevo, y una muestra para revisar a ojo.
-- =====================================================================
with entregas as (
  select yave, max(fecha) as fecha_entrega_real
  from entradas_ea where fecha is not null group by yave
),
candidatas as (
  select d.id, d.co, d.nro_orden, d.proveedor, d.docto_referencia,
         d.fecha_orden as fecha_actual,
         h.fecha       as fecha_real_odc,
         e.fecha_entrega_real
  from pedidos_detalle d
  join entregas e on e.yave = d.yave
  left join lateral (
    select h2.fecha from odc_historico h2
    where normalizar_nro_orden(h2.nro_orden) = normalizar_nro_orden(d.docto_referencia)
      and (h2.co = d.co or true)
    order by (h2.co = d.co) desc, h2.fecha
    limit 1
  ) h on true
  where d.fecha_orden is not null
    and h.fecha is not null
    and h.fecha < d.fecha_orden
    and h.fecha <> e.fecha_entrega_real
    and d.fecha_orden <> e.fecha_entrega_real   -- el caso NUEVO (antes no se tocaban)
)
select count(*) as lineas_que_cambiarian,
       count(distinct nro_orden) as documentos_afectados,
       min(fecha_actual) as fecha_mas_antigua,
       max(fecha_actual) as fecha_mas_reciente
from candidatas;

-- Muestra de 25 líneas (descomenta y corre si quieres verlas en detalle):
-- ... repite el "with" de arriba y cambia el select final por:
--   select co, nro_orden, proveedor, docto_referencia, fecha_actual,
--          fecha_real_odc, fecha_entrega_real
--   from candidatas order by fecha_actual desc limit 25;

-- =====================================================================
-- PASO 2 — Aplica la corrección nueva (reemplaza la función).
-- =====================================================================
create or replace function corregir_fechas_orden_ns_proveedores()
returns table(filas_evaluadas int, filas_corregidas int, filas_pendientes_revision int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evaluadas int;
  v_corregidas int;
  v_pendientes int;
begin
  drop table if exists tmp_candidatas_fecha_orden;
  create temporary table tmp_candidatas_fecha_orden on commit drop as
  select
    d.id,
    d.nro_orden,
    d.fecha_orden,
    e.fecha_entrega_real,
    coalesce(h_co.fecha, h_solo.fecha) as fecha_historica,
    (d.fecha_orden = e.fecha_entrega_real) as fecha_igual_a_entrada
  from pedidos_detalle d
  join (
    select yave, max(fecha) as fecha_entrega_real
    from entradas_ea
    where fecha is not null
    group by yave
  ) e on e.yave = d.yave
  -- Los dos cruces contra el histórico van como subconsultas LATERAL con
  -- "limit 1": la restricción "unique (nro_orden)" de odc_historico es sobre
  -- el Nro orden CRUDO, pero el cruce se hace sobre el NORMALIZADO, y dos
  -- valores crudos distintos ("ODC-00189722" y "189722") normalizan al mismo
  -- texto. Con LATERAL + limit 1 se garantiza como máximo una coincidencia
  -- por línea, tomando siempre la fecha más antigua (la de la orden
  -- original) para que el resultado sea estable y repetible.
  left join lateral (
    select h.fecha
    from odc_historico h
    where h.co = d.co
      and normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by h.fecha
    limit 1
  ) h_co on true
  left join lateral (
    select h.fecha
    from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by h.fecha
    limit 1
  ) h_solo on true
  where d.fecha_orden is not null
    and (
      -- (A) El ERP dejó la fecha de la orden igual a la fecha de entrada.
      d.fecha_orden = e.fecha_entrega_real
      -- (B) La orden fue MODIFICADA: "Docto. referencia" apunta a una orden
      -- anterior del histórico de ODC. La fecha que vale para medirle el
      -- tiempo de entrega al proveedor es la de esa orden original, no la de
      -- la modificación. Antes solo se miraba el caso (A), así que una línea
      -- como ODC-00194115 (fecha 2026-10-30, Docto. referencia 193933, que
      -- en el histórico es del 2026-10-28) nunca se corregía porque su fecha
      -- de orden no coincidía con la de entrada.
      or coalesce(h_co.fecha, h_solo.fecha) < d.fecha_orden
    );

  select count(*) into v_evaluadas from tmp_candidatas_fecha_orden;

  -- Caso 1: se encontró en el histórico de ODC la fecha de la orden
  -- original, es ANTERIOR a la que tiene hoy la línea y no es la misma
  -- fecha de entrada -> se corrige "Fecha orden", guardando la original
  -- para trazabilidad. Exigir que sea anterior es lo que hace la corrección
  -- repetible: una vez aplicada, la línea deja de ser candidata.
  update pedidos_detalle d
  set
    fecha_orden_original = coalesce(d.fecha_orden_original, t.fecha_orden),
    fecha_orden = t.fecha_historica,
    fecha_orden_corregida = true,
    fecha_orden_corregida_en = now(),
    necesita_revision = false
  from tmp_candidatas_fecha_orden t
  where d.id = t.id
    and t.fecha_historica is not null
    and t.fecha_historica < t.fecha_orden
    and t.fecha_historica <> t.fecha_entrega_real;

  get diagnostics v_corregidas = row_count;

  -- Caso 2: la línea quedó con la fecha de orden igual a la de entrada y NO
  -- se pudo resolver con el histórico -> se marca para revisión manual.
  -- Solo aplica al caso (A): las del caso (B) siempre tienen fecha del
  -- histórico, por definición.
  update pedidos_detalle d
  set necesita_revision = true
  from tmp_candidatas_fecha_orden t
  where d.id = t.id
    and t.fecha_igual_a_entrada
    and (
      t.fecha_historica is null
      or t.fecha_historica >= t.fecha_orden
      or t.fecha_historica = t.fecha_entrega_real
    );

  get diagnostics v_pendientes = row_count;

  -- Limpieza: filas marcadas "necesita_revision" en una corrida anterior
  -- que ya no aplican.
  update pedidos_detalle d
  set necesita_revision = false
  where d.necesita_revision = true
    and not exists (select 1 from tmp_candidatas_fecha_orden t where t.id = d.id);

  return query select v_evaluadas, v_corregidas, v_pendientes;
end;
$$;

-- =====================================================================
-- PASO 3 — Recalcula con la lógica nueva sobre los datos ya cargados.
-- Devuelve: líneas evaluadas, corregidas y pendientes de revisión.
-- (También puedes hacerlo desde la app con el botón "Corregir fechas de
-- orden" en Nivel de servicio.)
-- =====================================================================
select * from corregir_fechas_orden_ns_proveedores();

-- =====================================================================
-- COMPROBACIÓN — tu caso puntual debe quedar con fecha de orden
-- 2026-10-28 y la anterior guardada en "fecha_orden_original":
-- =====================================================================
-- select co, nro_orden, docto_referencia, fecha_orden, fecha_orden_original,
--        fecha_orden_corregida
-- from pedidos_detalle
-- where normalizar_nro_orden(docto_referencia) = normalizar_nro_orden('193933');
