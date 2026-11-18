-- =====================================================================
-- El Paso 3 dio: 564 evaluadas, 0 corregidas, 564 pendientes.
-- Es decir, NINGUNO de los cuatro intentos de búsqueda encontró una
-- fecha anterior. Como ODC-00064007 sí aparece en tu archivo de ODC, lo
-- más probable es que esa fila NO esté cargada en la tabla
-- "odc_historico" de la base (o que el histórico no cubra ese período).
--
-- Estas consultas solo LEEN. Córrelas una por una y mándame el resultado.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) ¿Está ODC-00064007 en la tabla del histórico? (lo esperado según tu
--    archivo: C.O. 003, 28/10/2026). Si devuelve 0 filas, ahí está todo
--    explicado: el dato está en el Excel pero no en la base.
-- ---------------------------------------------------------------------
select co, nro_orden, normalizar_nro_orden(nro_orden) as normalizado, fecha, archivo_origen, cargado_en
from odc_historico
where normalizar_nro_orden(nro_orden) = '64007';


-- ---------------------------------------------------------------------
-- 2) ¿Qué tan grande y qué tan actualizado está el histórico?
-- ---------------------------------------------------------------------
select count(*)                as filas_en_el_historico,
       min(fecha)              as orden_mas_antigua,
       max(fecha)              as orden_mas_reciente,
       count(distinct co)      as cantidad_de_co,
       max(cargado_en)         as ultima_carga
from odc_historico;


-- ---------------------------------------------------------------------
-- 3) Las últimas cargas del histórico de ODC: cuántas filas traía el
--    archivo y cuántas entraron de verdad.
-- ---------------------------------------------------------------------
select * from import_logs
where tipo = 'odc_historico'
order by id desc
limit 5;


-- ---------------------------------------------------------------------
-- 4) EL REPARTO REAL de las 564 líneas candidatas: por qué ninguna se
--    pudo corregir. Esta es la consulta que decide el siguiente paso.
-- ---------------------------------------------------------------------
with entregas as (
  select yave, max(fecha) as f from entradas_ea where fecha is not null group by yave
),
cand as (
  select d.id, d.co, d.nro_orden, d.docto_referencia, d.fecha_orden,
         hp.fecha as fecha_odc_propio,
         hr.fecha as fecha_odc_referencia
  from pedidos_detalle d
  join entregas e on e.yave = d.yave
  left join lateral (
    select h.fecha from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
    order by (h.co = d.co) desc, h.fecha limit 1) hp on true
  left join lateral (
    select h.fecha from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by (h.co = d.co) desc, h.fecha limit 1) hr on true
  where d.fecha_orden is not null
    and d.fecha_orden = e.f
)
select
  count(*)                                                                as lineas_candidatas,
  count(*) filter (where docto_referencia is null
                      or normalizar_nro_orden(docto_referencia) is null)  as sin_docto_referencia,
  count(*) filter (where fecha_odc_propio is null
                     and fecha_odc_referencia is null)                    as no_aparecen_en_el_historico,
  count(*) filter (where fecha_odc_propio is not null)                    as su_propio_nro_si_esta,
  count(*) filter (where fecha_odc_propio = fecha_orden)                  as propio_con_la_misma_fecha,
  count(*) filter (where fecha_odc_propio > fecha_orden)                  as propio_con_fecha_posterior,
  count(*) filter (where fecha_odc_propio < fecha_orden)                  as propio_con_fecha_anterior
from cand;


-- ---------------------------------------------------------------------
-- 5) Muestra de 15 líneas candidatas, para ver los números tal cual
--    están guardados y descartar un problema de formato.
-- ---------------------------------------------------------------------
with entregas as (
  select yave, max(fecha) as f from entradas_ea where fecha is not null group by yave
)
select distinct
  d.co,
  d.nro_orden,
  normalizar_nro_orden(d.nro_orden)        as nro_normalizado,
  d.docto_referencia,
  normalizar_nro_orden(d.docto_referencia) as ref_normalizada,
  d.fecha_orden,
  e.f as fecha_entrega_real,
  (select h.fecha from odc_historico h
   where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
   order by (h.co = d.co) desc, h.fecha limit 1) as fecha_odc_de_esa_orden
from pedidos_detalle d
join entregas e on e.yave = d.yave
where d.fecha_orden is not null and d.fecha_orden = e.f
order by d.co, d.nro_orden
limit 15;
