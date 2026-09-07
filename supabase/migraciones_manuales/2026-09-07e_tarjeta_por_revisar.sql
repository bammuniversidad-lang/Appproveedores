-- =====================================================================
-- "Solo por revisar" seguía listando líneas de LATEXPORT (fecha de orden
-- 2026-08-05, fecha de entrega real 2026-08-13 -- distintas).
--
-- QUÉ SE HIZO: la pantalla ya NO depende de ninguna columna calculada de
-- la base para decidir qué es "por revisar". Ahora lo calcula con las tres
-- fechas que la propia fila ya muestra (Fecha orden, Fecha entrega real y
-- Fecha orden original), así que es imposible que liste una línea cuyas
-- fechas no coincidan, sin importar el estado de la vista o si el
-- navegador tiene una versión vieja en caché.
--
-- ESTE ARCHIVO solo ajusta la TARJETA "Por revisar" para que cuente
-- exactamente lo mismo que se lista (antes contaba con la columna
-- calculada). Si no lo corres, la aplicación funciona igual de bien: solo
-- que el número de la tarjeta puede no cuadrar con las líneas que ves.
--
-- CÓMO EJECUTAR: Dashboard de Supabase > proyecto ns-proveedores >
-- SQL Editor > New query > pegar todo > Run.
-- =====================================================================
create or replace function get_ns_proveedores_cards(
  co_list text[] default null,
  fecha_inicio date default null,
  fecha_fin date default null
)
returns table (
  lineas_totales bigint,
  lineas_cumplidas bigint,
  lineas_incumplidas bigint,
  ns_lineas numeric,
  valor_total numeric,
  valor_pendiente numeric,
  ns_valor numeric,
  lineas_por_revisar bigint,
  lineas_corregidas_automaticamente bigint
)
language sql
stable
set search_path = public
as $$
  with base as (
    select * from v_ns_proveedores v
    where (co_list is null or v.co = any(co_list))
      and (fecha_inicio is null or v.fecha_referencia >= fecha_inicio)
      and (fecha_fin is null or v.fecha_referencia <= fecha_fin)
  )
  select
    count(*) as lineas_totales,
    count(*) filter (where observacion2 = 'CUMPLIDO') as lineas_cumplidas,
    count(*) filter (where observacion2 = 'INCUMPLIDO') as lineas_incumplidas,
    case when count(*) = 0 then 0
      else round(count(*) filter (where observacion2 = 'CUMPLIDO')::numeric / count(*), 4) end as ns_lineas,
    coalesce(sum(valor_bruto), 0) as valor_total,
    coalesce(sum(v_pendiente), 0) as valor_pendiente,
    case when coalesce(sum(valor_bruto), 0) = 0 then 0
      else round(1 - (coalesce(sum(v_pendiente), 0) / sum(valor_bruto)), 4) end as ns_valor,
    -- Misma condición que usa la pantalla (esPorRevisar en nivel-servicio.js),
    -- escrita con las columnas base en vez de con necesita_revision_actual:
    -- así la tarjeta cuenta exactamente lo mismo que se lista, y no depende
    -- de que la columna calculada de la vista esté al día.
    count(*) filter (
      where fecha_orden_original is null
        and fecha_entrega_real is not null
        and fecha_orden = fecha_entrega_real
    ) as lineas_por_revisar,
    count(*) filter (where fecha_orden_corregida) as lineas_corregidas_automaticamente
  from base;
$$;

-- =====================================================================
-- DIAGNÓSTICO (opcional pero útil): corre esta consulta seleccionándola y
-- presionando Run. Muestra, para las líneas de LATEXPORT, qué dice la
-- base. Con eso confirmamos de una vez qué estaba pasando:
--
--   - "marca_guardada" en true con fechas DISTINTAS  = la marca guardada
--     quedó vencida (es lo que esperamos ver: ese era el problema).
--   - Si la columna "marca_en_vivo" da error al correr esto, significa que
--     el script 2026-09-07b nunca se aplicó -- avísame.
-- =====================================================================
-- select
--   co, nro_orden, referencia,
--   fecha_orden,
--   fecha_entrega_real,
--   fecha_orden_original,
--   (fecha_orden = fecha_entrega_real) as fechas_iguales,
--   necesita_revision        as marca_guardada,
--   necesita_revision_actual as marca_en_vivo
-- from v_ns_proveedores
-- where proveedor ilike '%LATEXPORT%'
-- order by nro_orden, referencia
-- limit 20;
