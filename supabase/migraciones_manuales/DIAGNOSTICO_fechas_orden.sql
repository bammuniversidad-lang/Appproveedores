-- =====================================================================
-- DIAGNÓSTICO — por qué algunas líneas siguen marcadas en rojo / "por
-- revisar" aunque su "Docto. referencia" exista en el histórico de ODC.
--
-- NINGUNA de estas consultas cambia datos: solo leen.
--
-- Cómo usarlo: Dashboard de Supabase > proyecto ns-proveedores > SQL
-- Editor. Corre las consultas UNA POR UNA (selecciona el bloque y pulsa
-- Run) y mándame el resultado de cada una. Con eso decidimos el arreglo
-- sobre datos reales y no sobre supuestos.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) ¿Quedó aplicada la lógica nueva? Debe decir "true".
-- ---------------------------------------------------------------------
select pg_get_functiondef('corregir_fechas_orden_ns_proveedores()'::regprocedure)
       like '%fecha_igual_a_entrada%' as logica_nueva_aplicada;


-- ---------------------------------------------------------------------
-- 1) TAMAÑO DEL PROBLEMA. De todas las líneas que hoy salen en rojo
--    (fecha de orden = fecha de entrada y nunca corregidas), ¿en qué
--    situación está cada una frente al histórico de ODC?
--
--    Esto es lo que más me sirve: me dice si el arreglo tiene que ser
--    "marcarlas como verificadas" o si hay fechas anteriores que no se
--    están aplicando.
-- ---------------------------------------------------------------------
with entregas as (
  select yave, max(fecha) as f from entradas_ea where fecha is not null group by yave
),
rojas as (
  select d.id, d.fecha_orden, e.f as entrega, d.docto_referencia, h.fecha as fecha_odc
  from pedidos_detalle d
  join entregas e on e.yave = d.yave
  left join lateral (
    select h2.fecha from odc_historico h2
    where normalizar_nro_orden(h2.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by (h2.co = d.co) desc, h2.fecha
    limit 1
  ) h on true
  where d.fecha_orden is not null
    and d.fecha_orden_original is null
    and d.fecha_orden = e.f
)
select
  count(*)                                                        as lineas_en_rojo,
  count(*) filter (where docto_referencia is null
                      or normalizar_nro_orden(docto_referencia) is null)
                                                                  as sin_docto_referencia,
  count(*) filter (where fecha_odc is null)                        as no_esta_en_el_historico,
  count(*) filter (where fecha_odc = fecha_orden)                  as odc_confirma_misma_fecha,
  count(*) filter (where fecha_odc < fecha_orden)                  as odc_tiene_fecha_anterior,
  count(*) filter (where fecha_odc > fecha_orden)                  as odc_tiene_fecha_posterior
from rojas;


-- ---------------------------------------------------------------------
-- 2) EL CASO PUNTUAL que me mostraste (194122 / 194124 / 194278).
--    Una fila por documento, con lo que dice Pedidos y lo que dice ODC.
-- ---------------------------------------------------------------------
select distinct
  d.co,
  d.nro_orden,
  d.docto_referencia,
  d.fecha_orden,
  e.f                    as fecha_entrega_real,
  h.nro_orden            as odc_encontrada,
  h.fecha                as fecha_en_odc,
  d.fecha_orden_original,
  d.fecha_orden_corregida,
  d.necesita_revision
from pedidos_detalle d
left join (
  select yave, max(fecha) as f from entradas_ea where fecha is not null group by yave
) e on e.yave = d.yave
left join lateral (
  select h2.nro_orden, h2.fecha from odc_historico h2
  where normalizar_nro_orden(h2.nro_orden) = normalizar_nro_orden(d.docto_referencia)
  order by (h2.co = d.co) desc, h2.fecha
  limit 1
) h on true
where normalizar_nro_orden(d.nro_orden) in ('194122','194124','194278')
order by d.nro_orden;


-- ---------------------------------------------------------------------
-- 3) ¿La orden REFERENCIADA (194095 / 194096) existe a su vez en
--    Pedidos, y apunta ella misma a otra orden anterior?
--    Si devuelve filas con "docto_referencia" lleno, hay una CADENA de
--    modificaciones y habría que seguirla hacia atrás.
-- ---------------------------------------------------------------------
select distinct co, nro_orden, docto_referencia, fecha_orden
from pedidos_detalle
where normalizar_nro_orden(nro_orden) in ('194095','194096');


-- ---------------------------------------------------------------------
-- 4) Qué tiene el histórico de ODC alrededor de esos números.
-- ---------------------------------------------------------------------
select co, nro_orden, fecha
from odc_historico
where normalizar_nro_orden(nro_orden) in
      ('194095','194096','194122','194124','194278','193933')
order by nro_orden;


-- ---------------------------------------------------------------------
-- 5) ¿Cuántos documentos distintos están en cada situación? (igual que
--    la consulta 1, pero contando ÓRDENES y no líneas, que es como se
--    revisa en pantalla.)
-- ---------------------------------------------------------------------
with entregas as (
  select yave, max(fecha) as f from entradas_ea where fecha is not null group by yave
),
rojas as (
  select distinct d.co, d.nro_orden, d.fecha_orden, e.f as entrega, h.fecha as fecha_odc
  from pedidos_detalle d
  join entregas e on e.yave = d.yave
  left join lateral (
    select h2.fecha from odc_historico h2
    where normalizar_nro_orden(h2.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by (h2.co = d.co) desc, h2.fecha
    limit 1
  ) h on true
  where d.fecha_orden is not null
    and d.fecha_orden_original is null
    and d.fecha_orden = e.f
)
select
  count(*)                                         as documentos_en_rojo,
  count(*) filter (where fecha_odc is null)        as no_estan_en_el_historico,
  count(*) filter (where fecha_odc = fecha_orden)  as odc_confirma_misma_fecha,
  count(*) filter (where fecha_odc < fecha_orden)  as odc_tiene_fecha_anterior
from rojas;
