-- =====================================================================
-- "El Docto. referencia / la orden está en el histórico de ODC pero no
-- trae la fecha real."
--
-- LO QUE MOSTRÓ EL DIAGNÓSTICO: de 209 documentos marcados en rojo, 199
-- "no están en el histórico" y NINGUNO tenía fecha anterior. Eso no
-- cuadraba con que órdenes como ODC-00064007 (C.O. 003, 28/10/2026) sí
-- estén en el ODC.
--
-- LA CAUSA: la corrección solo buscaba en el histórico por el campo
-- "Docto. referencia" -- es decir, solo resolvía las órdenes que son una
-- MODIFICACIÓN de otra anterior. Cuando el ERP pisa la fecha de la orden
-- con la fecha de entrada pero la orden NO es una modificación (no tiene
-- Docto. referencia), no había nada que buscar y la línea quedaba "por
-- revisar" para siempre... aunque el histórico de ODC sí sabe en qué
-- fecha se creó esa misma orden. Nunca se consultaba por su propio Nro
-- orden. Eso explica los 199.
--
-- QUÉ CAMBIA: ahora la búsqueda tiene cuatro intentos, en este orden:
--   1. Docto. referencia + C.O.      (la orden original, si es modificación)
--   2. Docto. referencia solo
--   3. Nro orden propio + C.O.       <-- NUEVO
--   4. Nro orden propio solo         <-- NUEVO
-- En todos los casos se exige que la fecha encontrada sea ANTERIOR a la
-- que tiene hoy la línea: así nunca se mueve una fecha hacia adelante y
-- la corrección se puede repetir sin efectos raros.
--
-- ⚠️  ESTO MUEVE EL INDICADOR: al tomar la fecha real de creación de la
-- orden, el tiempo de entrega de esas líneas se alarga y varias pasarán
-- de CUMPLIDO a INCUMPLIDO. Es lo correcto, pero el porcentaje va a
-- cambiar. Por eso el PASO 1 te deja ver el impacto ANTES de aplicar.
--
-- CÓMO EJECUTARLO: SQL Editor del proyecto ns-proveedores. Corre el PASO
-- 1 (selecciónalo y Run). Si el número te cuadra, corre el PASO 2 y el 3.
-- =====================================================================


-- =====================================================================
-- PASO 1 — VISTA PREVIA. No cambia nada.
-- =====================================================================
with entregas as (
  select yave, max(fecha) as f from entradas_ea where fecha is not null group by yave
),
cand as (
  select
    d.id, d.co, d.nro_orden, d.fecha_orden,
    coalesce(hrc.fecha, hr.fecha, hpc.fecha, hp.fecha) as fecha_odc,
    (hpc.fecha is not null or hp.fecha is not null)
      and hrc.fecha is null and hr.fecha is null                as resuelta_por_nro_propio
  from pedidos_detalle d
  join entregas e on e.yave = d.yave
  left join lateral (select h.fecha from odc_historico h
    where h.co = d.co and normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by h.fecha limit 1) hrc on true
  left join lateral (select h.fecha from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by h.fecha limit 1) hr on true
  left join lateral (select h.fecha from odc_historico h
    where h.co = d.co and normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
    order by h.fecha limit 1) hpc on true
  left join lateral (select h.fecha from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
    order by h.fecha limit 1) hp on true
  where d.fecha_orden is not null
)
select
  count(*) filter (where fecha_odc < fecha_orden)                                as lineas_que_se_corregirian,
  count(distinct nro_orden) filter (where fecha_odc < fecha_orden)               as documentos_afectados,
  count(*) filter (where fecha_odc < fecha_orden and resuelta_por_nro_propio)    as lineas_gracias_al_cambio_nuevo,
  count(*) filter (where fecha_odc is null)                                      as lineas_sin_nada_en_el_historico
from cand;


-- =====================================================================
-- PASO 2 — Aplica la búsqueda ampliada.
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
    -- Orden de preferencia para la fecha real de la orden:
    --   1-2. La orden ORIGINAL, si esta es una modificación: se busca el
    --        "Docto. referencia" en el histórico (primero exigiendo el
    --        mismo C.O., y si no aparece, solo por el número).
    --   3-4. El PROPIO "Nro orden" de la línea en el histórico. Este era
    --        el paso que faltaba: cuando el ERP pisa la fecha de la orden
    --        con la de entrada y la orden NO es una modificación (no tiene
    --        Docto. referencia), el histórico de ODC igual sabe en qué
    --        fecha se creó esa orden. Antes no se consultaba nunca, así
    --        que esas líneas quedaban marcadas "por revisar" para siempre
    --        aunque el dato estuviera a la mano (caso real: ODC-00064007
    --        del C.O. 003, que en el histórico es del 2026-10-28).
    coalesce(h_ref_co.fecha, h_ref.fecha, h_propio_co.fecha, h_propio.fecha) as fecha_historica,
    (d.fecha_orden = e.fecha_entrega_real) as fecha_igual_a_entrada
  from pedidos_detalle d
  join (
    select yave, max(fecha) as fecha_entrega_real
    from entradas_ea
    where fecha is not null
    group by yave
  ) e on e.yave = d.yave
  -- Todos los cruces van como LATERAL con "limit 1": la restricción
  -- "unique (nro_orden)" de odc_historico es sobre el número CRUDO, pero
  -- el cruce se hace sobre el NORMALIZADO, y dos valores crudos distintos
  -- ("ODC-00189722" y "189722") normalizan al mismo texto. Con limit 1 se
  -- garantiza una sola coincidencia por línea, tomando la fecha más
  -- antigua, para que el resultado sea estable y repetible.
  left join lateral (
    select h.fecha from odc_historico h
    where h.co = d.co
      and normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by h.fecha limit 1
  ) h_ref_co on true
  left join lateral (
    select h.fecha from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by h.fecha limit 1
  ) h_ref on true
  left join lateral (
    select h.fecha from odc_historico h
    where h.co = d.co
      and normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
    order by h.fecha limit 1
  ) h_propio_co on true
  left join lateral (
    select h.fecha from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
    order by h.fecha limit 1
  ) h_propio on true
  where d.fecha_orden is not null
    and (
      -- (A) El ERP dejó la fecha de la orden igual a la fecha de entrada.
      d.fecha_orden = e.fecha_entrega_real
      -- (B) La orden fue modificada y la original es anterior.
      or coalesce(h_ref_co.fecha, h_ref.fecha, h_propio_co.fecha, h_propio.fecha) < d.fecha_orden
    );

  select count(*) into v_evaluadas from tmp_candidatas_fecha_orden;

  -- Caso 1: el histórico de ODC tiene una fecha ANTERIOR a la que hoy
  -- tiene la línea y distinta de la de entrada -> se corrige, guardando la
  -- original para trazabilidad. Exigir que sea anterior es lo que hace la
  -- corrección repetible: una vez aplicada, la línea deja de ser candidata.
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

  -- Caso 2: quedó con la fecha de orden igual a la de entrada y el
  -- histórico no aportó una fecha anterior -> revisión manual.
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

  update pedidos_detalle d
  set necesita_revision = false
  where d.necesita_revision = true
    and not exists (select 1 from tmp_candidatas_fecha_orden t where t.id = d.id);

  return query select v_evaluadas, v_corregidas, v_pendientes;
end;
$$;

-- =====================================================================
-- PASO 3 — Recalcula sobre los datos ya cargados.
-- (También sirve el botón "Corregir fechas de orden" en Nivel de servicio.)
-- =====================================================================
select * from corregir_fechas_orden_ns_proveedores();


-- =====================================================================
-- COMPROBACIÓN — tu caso del C.O. 003 debe quedar con fecha 2026-10-28:
-- =====================================================================
-- select distinct co, nro_orden, docto_referencia, fecha_orden,
--        fecha_orden_original, fecha_orden_corregida, necesita_revision
-- from pedidos_detalle
-- where normalizar_nro_orden(nro_orden) = '64007';
