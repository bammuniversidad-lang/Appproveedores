-- =====================================================================
-- ARREGLA: "Solo por revisar" a veces trae líneas que no debería (donde
-- Fecha orden YA NO es igual a Fecha entrega real, o que ya tienen Fecha
-- orden original guardada).
--
-- CAUSA: la columna "necesita_revision" que se guarda en pedidos_detalle
-- solo se recalcula cuando corre la corrección automática (al importar,
-- o con el botón "Corregir fechas de orden"). Si DESPUÉS de esa corrida
-- llega una entrada nueva en EA que cambia la "fecha de entrega real" de
-- una línea, esa columna guardada puede quedar desactualizada -- sigue
-- diciendo "necesita revisión" aunque ya no sea cierto con los datos
-- actuales.
--
-- SOLUCIÓN: se agrega a la vista una columna "necesita_revision_actual"
-- que recalcula la condición EN VIVO con los datos de ahora mismo (nunca
-- se ha corregido Y la fecha de orden sigue siendo igual a la fecha de
-- entrega real actual) -- nunca queda desactualizada. El filtro "Solo
-- por revisar", el resaltado en rojo, el campo de corrección manual, el
-- Excel y la tarjeta "Por revisar" ahora usan esta columna.
--
-- (Esto es un complemento al arreglo de rendimiento del script anterior,
-- 2026-09-07_rendimiento_entregas_y_fecha_referencia.sql -- si ya lo
-- corriste, corre este igual, no hay problema en correr los dos.)
--
-- CÓMO EJECUTAR ESTE ARCHIVO:
--   1. Entra al Dashboard de Supabase: https://supabase.com/dashboard
--   2. Abre el proyecto "ns-proveedores".
--   3. Ve a "SQL Editor" > "New query".
--   4. Copia y pega TODO el contenido de este archivo.
--   5. Presiona "Run" (o Ctrl+Enter). Debe decir "Success".
--   6. Vuelve a Nivel de servicio y presiona "Actualizar".
-- =====================================================================

-- 1. Vista con la columna nueva "necesita_revision_actual".
create or replace view v_ns_proveedores
  with (security_invoker = true) as
  -- "base" busca la fecha de entrega real de cada línea con un LATERAL +
  -- "order by fecha desc limit 1" (en vez de agrupar TODA entradas_ea con
  -- "group by yave" como antes). Con el índice idx_entradas_ea_yave_fecha
  -- (yave, fecha desc), esto se resuelve con un Index Scan acotado a cada
  -- yave -- muy rápido y NO depende del tamaño total de entradas_ea. La
  -- versión anterior agregaba la tabla completa de entradas en cada
  -- consulta (tarjetas, tabla, novedades, dashboard), sin importar cuántas
  -- filas pidiera el rango de fechas -- esa era la causa principal de la
  -- lentitud y de los "statement timeout".
  with base as (
    select
      d.*,
      ea.fecha_entrega_real,
      case when d.cant_pendiente_inv = 0 then 'COMPLETA' else 'INCOMPLETA' end as observaciones,
      (d.cant_pendiente_inv * d.precio_unit) as v_pendiente
    from pedidos_detalle d
    left join lateral (
      select e.fecha as fecha_entrega_real
      from entradas_ea e
      where e.yave = d.yave and e.fecha is not null
      order by e.fecha desc
      limit 1
    ) ea on true
  ),
  con_diferencia as (
    select
      b.*,
      te.dias_entrega as dias_entrega_esperados,
      case
        when b.fecha_entrega_real is null then null
        else dias_habiles_entre(b.fecha_orden, b.fecha_entrega_real) - coalesce(te.dias_entrega, 0)
      end as diferencia
    from base b
    left join tiempo_entrega te on te.co = b.co and te.proveedor = b.proveedor
  )
  select
    c.*,
    case
      when c.fecha_entrega_real is null then 'REVISAR'
      when c.diferencia <= 1 then 'CUMPLIDO'
      else 'INCUMPLIDO'
    end as observacion2,
    m.nombre as motivo_nombre,
    m.responsable as motivo_responsable,
    mf.nombre as motivo_faltante_nombre,
    mf.responsable as motivo_faltante_responsable,
    -- Columna que usan los filtros "Desde/Hasta" de Nivel de servicio,
    -- Novedades y Dashboard: fecha_cumplido cuando existe, y si no,
    -- fecha_orden. Necesaria porque muchas líneas ya cargadas NO tienen
    -- fecha_cumplido (ver nota de "Fecha de cumplido en blanco") -- si el
    -- filtro exigiera fecha_cumplido directamente, esas líneas
    -- desaparecerían por completo de las 3 pantallas en vez de solo faltarles
    -- ese dato puntual. Cuando termines de reimportar y fecha_cumplido quede
    -- poblado para todo, este coalesce sigue funcionando igual (usa
    -- fecha_cumplido apenas exista).
    coalesce(c.fecha_cumplido, c.fecha_orden) as fecha_referencia,
    -- "necesita_revision" (columna guardada en pedidos_detalle) se
    -- calcula la última vez que corrió corregir_fechas_orden_ns_proveedores()
    -- (al importar, o con el botón "Corregir fechas de orden") y se queda
    -- ahí tal cual hasta la próxima corrida -- si después llega una nueva
    -- entrada de EA que cambia fecha_entrega_real, la columna guardada
    -- puede quedar "vencida" (todavía en true aunque fecha_orden ya no sea
    -- igual a la fecha_entrega_real actual). Esta columna recalcula la
    -- condición EN VIVO con los datos actuales, así que nunca se desfasa:
    -- solo es true cuando de verdad sigue sin resolverse (nunca se corrigió
    -- Y la fecha de orden sigue siendo igual a la fecha de entrega real).
    (
      c.fecha_orden_original is null
      and c.fecha_entrega_real is not null
      and c.fecha_orden = c.fecha_entrega_real
    ) as necesita_revision_actual
  from con_diferencia c
  left join motivos m on m.id = c.motivo_id
  left join motivos mf on mf.id = c.motivo_faltante_id;

-- 2. Tarjetas: "Por revisar" ahora cuenta con necesita_revision_actual.
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
    count(*) filter (where necesita_revision_actual) as lineas_por_revisar,
    count(*) filter (where fecha_orden_corregida) as lineas_corregidas_automaticamente
  from base;
$$;
