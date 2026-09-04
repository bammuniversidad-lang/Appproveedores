-- =====================================================================
-- ARREGLA: "En Novedades de incumplimiento ya no me muestra nada" --
-- pasó porque el cambio anterior (filtrar por "Fecha cumplido") dejó
-- fuera TODAS las líneas que todavía no tienen fecha_cumplido cargada
-- (que son casi todas, según lo que vimos: esa columna venía en blanco
-- por el problema de encabezado). Un filtro ">= / <=" contra una columna
-- vacía (null) en SQL nunca es verdadero, así que esas líneas
-- desaparecían del todo de Nivel de servicio, Novedades y Dashboard.
--
-- SOLUCIÓN: se agrega a la vista una columna nueva "fecha_referencia" =
-- fecha_cumplido si existe, y si no, fecha_orden (coalesce). Los 3
-- filtros "Desde/Hasta" ahora usan esa columna en vez de fecha_cumplido
-- directo. Resultado:
--   - Líneas que YA tienen fecha_cumplido (imports nuevos, con el
--     encabezado corregido): se filtran por fecha_cumplido, como pediste.
--   - Líneas que TODAVÍA no tienen fecha_cumplido (la mayoría de lo ya
--     cargado): se siguen viendo, filtradas por fecha_orden mientras
--     tanto -- en vez de desaparecer.
-- A medida que reimportes períodos con el encabezado ya corregido, esas
-- líneas van a ir quedando filtradas por fecha_cumplido automáticamente,
-- sin que haya que tocar nada más.
--
-- CÓMO EJECUTAR ESTE ARCHIVO:
--   1. Entra al Dashboard de Supabase: https://supabase.com/dashboard
--   2. Abre el proyecto "ns-proveedores".
--   3. Ve a "SQL Editor" > "New query".
--   4. Copia y pega TODO el contenido de este archivo.
--   5. Presiona "Run" (o Ctrl+Enter). Debe decir "Success".
--   6. Vuelve a Novedades y a Nivel de servicio y presiona "Actualizar"
--      para confirmar que ya vuelven a aparecer las líneas.
-- =====================================================================

-- 1. Vista: agrega la columna fecha_referencia (no quita ni reordena
--    columnas existentes, así que CREATE OR REPLACE VIEW funciona sin
--    problema).
create or replace view v_ns_proveedores
  with (security_invoker = true) as
  with entregas as (
    select yave, max(fecha) as fecha_entrega_real
    from entradas_ea
    where fecha is not null
    group by yave
  ),
  base as (
    select
      d.*,
      e.fecha_entrega_real,
      case when d.cant_pendiente_inv = 0 then 'COMPLETA' else 'INCOMPLETA' end as observaciones,
      (d.cant_pendiente_inv * d.precio_unit) as v_pendiente
    from pedidos_detalle d
    left join entregas e on e.yave = d.yave
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
    coalesce(c.fecha_cumplido, c.fecha_orden) as fecha_referencia
  from con_diferencia c
  left join motivos m on m.id = c.motivo_id
  left join motivos mf on mf.id = c.motivo_faltante_id;

-- 2. Tarjetas de Nivel de servicio: filtran por fecha_referencia.
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
    count(*) filter (where necesita_revision) as lineas_por_revisar,
    count(*) filter (where fecha_orden_corregida) as lineas_corregidas_automaticamente
  from base;
$$;

-- 3. Dashboard: filtra por fecha_referencia (la función es larga porque
--    arma todas las tarjetas y tablas del Dashboard, pero el único
--    cambio real son las dos líneas del filtro de fechas).
--   - en_full (sin pendientes) = la orden completa (todas sus líneas)
--     quedó con cantidad pendiente = 0.
--   - a_tiempo (on time) = TODAS las líneas de la orden tienen
--     diferencia <= 1 día hábil (si alguna línea no tiene fecha de
--     entrega real todavía, la orden cuenta como NO a tiempo -- igual
--     que en el cálculo de NS de líneas/valor).
--   - completas = sin pendientes Y a tiempo (OTIF a nivel de orden).
--   - OTIF = (órdenes a tiempo / total) * (órdenes sin pendientes / total),
--     tal como lo definiste.
--
-- El rango "Desde/Hasta" filtra por fecha_cumplido (no por fecha_orden),
-- igual que Nivel de servicio y Novedades -- para que los tres cuadren
-- con el mismo período.
-- =====================================================================
create or replace function get_ns_proveedores_dashboard(
  co_list text[] default null,
  fecha_inicio date default null,
  fecha_fin date default null,
  cross_campo text default null,
  cross_valor text default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select v.*
    from v_ns_proveedores v
    where (co_list is null or v.co = any(co_list))
      and (fecha_inicio is null or v.fecha_referencia >= fecha_inicio)
      and (fecha_fin is null or v.fecha_referencia <= fecha_fin)
      and (
        cross_campo is null or cross_valor is null or
        case cross_campo
          when 'proveedor' then v.proveedor
          when 'desc_item' then v.desc_item
          when 'referencia' then v.referencia
          when 'motivo' then coalesce(v.motivo_nombre, 'Sin motivo')
          when 'motivo_faltante' then coalesce(v.motivo_faltante_nombre, 'Sin motivo')
          when 'co' then v.co
          else null
        end = cross_valor
      )
  ),
  por_orden as (
    select
      nro_orden,
      co,
      sum(cant_pendiente_inv) as pendiente_cantidad_orden,
      bool_and(coalesce(diferencia, 999) <= 1) as a_tiempo
    from base
    group by nro_orden, co
  ),
  por_orden_proveedor as (
    select
      nro_orden,
      co,
      proveedor,
      sum(cant_pendiente_inv) as pendiente_cantidad_orden,
      bool_and(coalesce(diferencia, 999) <= 1) as a_tiempo
    from base
    group by nro_orden, co, proveedor
  ),
  cards_cantidad as (
    select
      coalesce(sum(cant_ordenada), 0) as cantidad_solicitada,
      coalesce(sum(cant_pendiente_inv), 0) as cantidad_pendiente,
      coalesce(sum(cant_entrada_inv), 0) as cantidad_entregada,
      coalesce(sum(valor_bruto), 0) as valor_solicitado,
      coalesce(sum(v_pendiente), 0) as valor_pendiente
    from base
  ),
  cards_lineas as (
    select
      count(*) as lineas_totales,
      count(*) filter (where coalesce(cant_pendiente_inv, 0) > 0) as lineas_con_pendiente,
      count(*) filter (where coalesce(cant_pendiente_inv, 0) <= 0) as lineas_entregadas
    from base
  ),
  cards_ordenes as (
    select
      count(*) as ordenes_emitidas,
      count(*) filter (where pendiente_cantidad_orden = 0) as ordenes_sin_pendientes,
      count(*) filter (where a_tiempo) as ordenes_a_tiempo,
      count(*) filter (where pendiente_cantidad_orden = 0 and a_tiempo) as ordenes_completas
    from por_orden
  ),
  tarjetas as (
    select jsonb_build_object(
      'cantidad_solicitada', cc.cantidad_solicitada,
      'cantidad_pendiente', cc.cantidad_pendiente,
      'cantidad_entregada', cc.cantidad_entregada,
      'indicador_cantidad', case when cc.cantidad_solicitada = 0 then 0
        else round(cc.cantidad_entregada / cc.cantidad_solicitada, 4) end,
      'ordenes_emitidas', co_.ordenes_emitidas,
      'ordenes_sin_pendientes', co_.ordenes_sin_pendientes,
      'ordenes_completas', co_.ordenes_completas,
      'ordenes_a_tiempo', co_.ordenes_a_tiempo,
      'ordenes_incumplidas', co_.ordenes_emitidas - co_.ordenes_a_tiempo,
      'on_time', case when co_.ordenes_emitidas = 0 then 0
        else round(co_.ordenes_a_tiempo::numeric / co_.ordenes_emitidas, 4) end,
      'in_full', case when co_.ordenes_emitidas = 0 then 0
        else round(co_.ordenes_sin_pendientes::numeric / co_.ordenes_emitidas, 4) end,
      'otif', case when co_.ordenes_emitidas = 0 then 0
        else round(
          (co_.ordenes_a_tiempo::numeric / co_.ordenes_emitidas)
          * (co_.ordenes_sin_pendientes::numeric / co_.ordenes_emitidas)
        , 4) end,
      'valor_solicitado', cc.valor_solicitado,
      'valor_pendiente', cc.valor_pendiente,
      'valor_entregado', cc.valor_solicitado - cc.valor_pendiente,
      'ns_valor', case when cc.valor_solicitado = 0 then 0
        else round(1 - (cc.valor_pendiente / cc.valor_solicitado), 4) end,
      'lineas_totales', cl.lineas_totales,
      'lineas_con_pendiente', cl.lineas_con_pendiente,
      'lineas_entregadas', cl.lineas_entregadas,
      'indicador_lineas', case when cl.lineas_totales = 0 then 0
        else round(cl.lineas_entregadas::numeric / cl.lineas_totales, 4) end
    ) as datos
    from cards_cantidad cc, cards_ordenes co_, cards_lineas cl
  ),
  -- Grano documento+proveedor+C.O. -- para el cuadro "Por C.O." (item 5).
  por_proveedor_ordenes_co as (
    select
      co, proveedor,
      count(*) as ordenes_totales,
      count(*) filter (where a_tiempo) as ordenes_a_tiempo,
      count(*) filter (where pendiente_cantidad_orden = 0) as ordenes_sin_pendientes
    from por_orden_proveedor
    group by co, proveedor
  ),
  -- Grano proveedor solamente (sumado entre todos sus C.O.) -- para la tabla
  -- deduplicada por proveedor y su resumen por clase (items 1 y 2).
  por_proveedor_ordenes as (
    select
      proveedor,
      count(*) as ordenes_totales,
      count(*) filter (where a_tiempo) as ordenes_a_tiempo,
      count(*) filter (where pendiente_cantidad_orden = 0) as ordenes_sin_pendientes
    from por_orden_proveedor
    group by proveedor
  ),
  por_proveedor_base as (
    select
      proveedor,
      coalesce(sum(valor_bruto), 0) as valor_solicitado,
      coalesce(sum(v_pendiente), 0) as valor_pendiente,
      coalesce(sum(cant_ordenada), 0) as cantidad_solicitada,
      coalesce(sum(cant_pendiente_inv), 0) as cantidad_pendiente,
      count(*) as lineas_totales,
      count(*) filter (where coalesce(cant_pendiente_inv, 0) <= 0) as lineas_entregadas
    from base
    group by proveedor
  ),
  por_proveedor_rankeado as (
    select
      b.*, o.ordenes_totales, o.ordenes_a_tiempo, o.ordenes_sin_pendientes,
      sum(b.valor_solicitado) over (order by b.valor_solicitado desc rows between unbounded preceding and current row)
        / nullif(sum(b.valor_solicitado) over (), 0) * 100 as pct_acumulado
    from por_proveedor_base b
    left join por_proveedor_ordenes o on o.proveedor = b.proveedor
  ),
  por_proveedor_clasificado as (
    select r.*, case
        when r.pct_acumulado <= 80 then 'A'
        when r.pct_acumulado <= 95 then 'B'
        when r.pct_acumulado <= 99 then 'C'
        else 'D' end as clasificacion
    from por_proveedor_rankeado r
  ),
  por_proveedor as (
    select jsonb_agg(jsonb_build_object(
      'proveedor', r.proveedor,
      'valor_solicitado', r.valor_solicitado,
      'valor_pendiente', r.valor_pendiente,
      'pct_pendiente', case when r.valor_solicitado = 0 then 0
        else round(r.valor_pendiente / r.valor_solicitado, 4) end,
      'clasificacion', r.clasificacion,
      'ns_valor', case when r.valor_solicitado = 0 then 0
        else round(1 - (r.valor_pendiente / r.valor_solicitado), 4) end,
      'on_time', case when r.ordenes_totales = 0 then 0
        else round(r.ordenes_a_tiempo::numeric / r.ordenes_totales, 4) end,
      'in_full', case when r.ordenes_totales = 0 then 0
        else round(r.ordenes_sin_pendientes::numeric / r.ordenes_totales, 4) end,
      'otif', case when r.ordenes_totales = 0 then 0
        else round(
          (r.ordenes_a_tiempo::numeric / r.ordenes_totales)
          * (r.ordenes_sin_pendientes::numeric / r.ordenes_totales)
        , 4) end
    ) order by r.valor_solicitado desc) as datos
    from por_proveedor_clasificado r
  ),
  por_proveedor_clase as (
    select jsonb_agg(jsonb_build_object(
      'clasificacion', g.clasificacion,
      'cantidad_proveedores', g.cantidad_proveedores,
      'valor_solicitado', g.valor_solicitado,
      'valor_pendiente', g.valor_pendiente,
      'ns_valor', case when g.valor_solicitado = 0 then 0
        else round(1 - (g.valor_pendiente / g.valor_solicitado), 4) end,
      'ns_cantidad', case when g.cantidad_solicitada = 0 then 0
        else round(1 - (g.cantidad_pendiente / g.cantidad_solicitada), 4) end,
      'ns_lineas', case when g.lineas_totales = 0 then 0
        else round(g.lineas_entregadas::numeric / g.lineas_totales, 4) end,
      'on_time', case when g.ordenes_totales = 0 then 0
        else round(g.ordenes_a_tiempo::numeric / g.ordenes_totales, 4) end,
      'in_full', case when g.ordenes_totales = 0 then 0
        else round(g.ordenes_sin_pendientes::numeric / g.ordenes_totales, 4) end,
      'otif', case when g.ordenes_totales = 0 then 0
        else round(
          (g.ordenes_a_tiempo::numeric / g.ordenes_totales)
          * (g.ordenes_sin_pendientes::numeric / g.ordenes_totales)
        , 4) end
    ) order by g.clasificacion) as datos
    from (
      select
        clasificacion,
        count(*) as cantidad_proveedores,
        sum(valor_solicitado) as valor_solicitado,
        sum(valor_pendiente) as valor_pendiente,
        sum(cantidad_solicitada) as cantidad_solicitada,
        sum(cantidad_pendiente) as cantidad_pendiente,
        sum(lineas_totales) as lineas_totales,
        sum(lineas_entregadas) as lineas_entregadas,
        sum(ordenes_totales) as ordenes_totales,
        sum(ordenes_a_tiempo) as ordenes_a_tiempo,
        sum(ordenes_sin_pendientes) as ordenes_sin_pendientes
      from por_proveedor_clasificado
      group by clasificacion
    ) g
  ),
  por_co as (
    select jsonb_agg(jsonb_build_object(
      'co', po.co,
      'on_time', case when po.ordenes_totales = 0 then 0
        else round(po.ordenes_a_tiempo::numeric / po.ordenes_totales, 4) end,
      'in_full', case when po.ordenes_totales = 0 then 0
        else round(po.ordenes_sin_pendientes::numeric / po.ordenes_totales, 4) end,
      'otif', case when po.ordenes_totales = 0 then 0
        else round(
          (po.ordenes_a_tiempo::numeric / po.ordenes_totales)
          * (po.ordenes_sin_pendientes::numeric / po.ordenes_totales)
        , 4) end,
      'cantidad_solicitada', cc.cantidad_solicitada,
      'cantidad_pendiente', cc.cantidad_pendiente,
      'ns_cantidad', case when cc.cantidad_solicitada = 0 then 0
        else round(1 - (cc.cantidad_pendiente / cc.cantidad_solicitada), 4) end,
      'valor_solicitado', cc.valor_solicitado,
      'valor_pendiente', cc.valor_pendiente,
      'ns_valor', case when cc.valor_solicitado = 0 then 0
        else round(1 - (cc.valor_pendiente / cc.valor_solicitado), 4) end
    ) order by po.co) as datos
    from (select co, sum(ordenes_totales) as ordenes_totales, sum(ordenes_a_tiempo) as ordenes_a_tiempo,
                 sum(ordenes_sin_pendientes) as ordenes_sin_pendientes
          from por_proveedor_ordenes_co group by co) po
    left join (select co, sum(cant_ordenada) as cantidad_solicitada, sum(cant_pendiente_inv) as cantidad_pendiente,
                      sum(valor_bruto) as valor_solicitado, sum(v_pendiente) as valor_pendiente
               from base group by co) cc on cc.co = po.co
  ),
  -- Motivos por FALTANTE de ítem: cant_pendiente_inv > 0 (columna
  -- "Observaciones" = INCOMPLETA), valorado por Valor pendiente. Usa
  -- motivo_faltante_nombre -- INDEPENDIENTE del motivo de incumplimiento
  -- en tiempo de entrega de abajo (una línea puede tener cantidad
  -- pendiente sin haber incumplido el tiempo de entrega, o viceversa).
  por_motivo_faltante as (
    select jsonb_agg(jsonb_build_object(
      'motivo', mf.motivo,
      'valor_pendiente', mf.valor_pendiente,
      'participacion', case when tot.total = 0 then 0 else round(mf.valor_pendiente / tot.total, 4) end
    ) order by mf.valor_pendiente desc) as datos
    from (
      select coalesce(motivo_faltante_nombre, 'Sin motivo') as motivo, coalesce(sum(v_pendiente), 0) as valor_pendiente
      from base
      where coalesce(cant_pendiente_inv, 0) > 0
      group by motivo_faltante_nombre
    ) mf,
    (
      select coalesce(sum(v_pendiente), 0) as total from base where coalesce(cant_pendiente_inv, 0) > 0
    ) tot
  ),
  -- Motivos por INCUMPLIMIENTO EN TIEMPO DE ENTREGA: columna
  -- "Cumplimiento" = INCUMPLIDO, valorado por el Valor de la orden de
  -- compra completa (valor_bruto) -- no solo la porción pendiente, porque
  -- una orden incumplida en tiempo puede llegar completa en cantidad.
  por_motivo_incumplimiento as (
    select jsonb_agg(jsonb_build_object(
      'motivo', mi.motivo,
      'valor_orden', mi.valor_orden,
      'participacion', case when tot.total = 0 then 0 else round(mi.valor_orden / tot.total, 4) end
    ) order by mi.valor_orden desc) as datos
    from (
      select coalesce(motivo_nombre, 'Sin motivo') as motivo, coalesce(sum(valor_bruto), 0) as valor_orden
      from base
      where observacion2 = 'INCUMPLIDO'
      group by motivo_nombre
    ) mi,
    (
      select coalesce(sum(valor_bruto), 0) as total from base where observacion2 = 'INCUMPLIDO'
    ) tot
  ),
  por_item_valor as (
    select
      desc_item,
      coalesce(sum(cant_ordenada), 0) as cantidad_solicitada,
      coalesce(sum(cant_pendiente_inv), 0) as cantidad_pendiente,
      coalesce(sum(valor_bruto), 0) as valor_solicitado,
      coalesce(sum(v_pendiente), 0) as valor_pendiente
    from base
    group by desc_item
  ),
  por_item_rankeado as (
    select
      i.*,
      sum(i.valor_solicitado) over (order by i.valor_solicitado desc rows between unbounded preceding and current row)
        / nullif(sum(i.valor_solicitado) over (), 0) * 100 as pct_acumulado
    from por_item_valor i
  ),
  por_item as (
    select jsonb_agg(jsonb_build_object(
      'desc_item', r.desc_item,
      'clasificacion', case
        when r.pct_acumulado <= 80 then 'A'
        when r.pct_acumulado <= 95 then 'B'
        when r.pct_acumulado <= 99 then 'C'
        else 'D' end,
      'valor_solicitado', r.valor_solicitado,
      'valor_pendiente', r.valor_pendiente,
      'ns_cantidad', case when r.cantidad_solicitada = 0 then 0
        else round(1 - (r.cantidad_pendiente / r.cantidad_solicitada), 4) end,
      'ns_valor', case when r.valor_solicitado = 0 then 0
        else round(1 - (r.valor_pendiente / r.valor_solicitado), 4) end
    ) order by r.valor_solicitado desc) as datos
    from por_item_rankeado r
  ),
  -- Clasificación ABCD por REFERENCIA (no por descripción de ítem). on_time/
  -- in_full aquí se calculan a nivel de LÍNEA porque una referencia puede
  -- estar repartida en muchas órdenes distintas (no es dueña de una orden
  -- completa como sí lo es un proveedor).
  por_referencia_base as (
    select
      referencia,
      coalesce(sum(valor_bruto), 0) as valor_solicitado,
      coalesce(sum(v_pendiente), 0) as valor_pendiente,
      coalesce(sum(cant_ordenada), 0) as cantidad_solicitada,
      coalesce(sum(cant_pendiente_inv), 0) as cantidad_pendiente,
      count(*) as lineas_totales,
      count(*) filter (where coalesce(cant_pendiente_inv, 0) <= 0) as lineas_entregadas,
      count(*) filter (where coalesce(diferencia, 999) <= 1) as lineas_a_tiempo
    from base
    group by referencia
  ),
  por_referencia_rankeado as (
    select
      b.*,
      sum(b.valor_solicitado) over (order by b.valor_solicitado desc rows between unbounded preceding and current row)
        / nullif(sum(b.valor_solicitado) over (), 0) * 100 as pct_acumulado
    from por_referencia_base b
  ),
  por_referencia_clasificado as (
    select r.*, case
        when r.pct_acumulado <= 80 then 'A'
        when r.pct_acumulado <= 95 then 'B'
        when r.pct_acumulado <= 99 then 'C'
        else 'D' end as clasificacion
    from por_referencia_rankeado r
  ),
  por_referencia_clase as (
    select jsonb_agg(jsonb_build_object(
      'clasificacion', g.clasificacion,
      'cantidad_referencias', g.cantidad_referencias,
      'valor_solicitado', g.valor_solicitado,
      'valor_pendiente', g.valor_pendiente,
      'ns_valor', case when g.valor_solicitado = 0 then 0
        else round(1 - (g.valor_pendiente / g.valor_solicitado), 4) end,
      'ns_cantidad', case when g.cantidad_solicitada = 0 then 0
        else round(1 - (g.cantidad_pendiente / g.cantidad_solicitada), 4) end,
      'ns_lineas', case when g.lineas_totales = 0 then 0
        else round(g.lineas_entregadas::numeric / g.lineas_totales, 4) end,
      'on_time', case when g.lineas_totales = 0 then 0
        else round(g.lineas_a_tiempo::numeric / g.lineas_totales, 4) end,
      'in_full', case when g.lineas_totales = 0 then 0
        else round(g.lineas_entregadas::numeric / g.lineas_totales, 4) end,
      'otif', case when g.lineas_totales = 0 then 0
        else round(
          (g.lineas_a_tiempo::numeric / g.lineas_totales) * (g.lineas_entregadas::numeric / g.lineas_totales)
        , 4) end
    ) order by g.clasificacion) as datos
    from (
      select
        clasificacion,
        count(*) as cantidad_referencias,
        sum(valor_solicitado) as valor_solicitado,
        sum(valor_pendiente) as valor_pendiente,
        sum(cantidad_solicitada) as cantidad_solicitada,
        sum(cantidad_pendiente) as cantidad_pendiente,
        sum(lineas_totales) as lineas_totales,
        sum(lineas_entregadas) as lineas_entregadas,
        sum(lineas_a_tiempo) as lineas_a_tiempo
      from por_referencia_clasificado
      group by clasificacion
    ) g
  )
  select jsonb_build_object(
    'tarjetas', (select datos from tarjetas),
    'por_proveedor', coalesce((select datos from por_proveedor), '[]'::jsonb),
    'por_proveedor_clase', coalesce((select datos from por_proveedor_clase), '[]'::jsonb),
    'por_referencia_clase', coalesce((select datos from por_referencia_clase), '[]'::jsonb),
    'por_co', coalesce((select datos from por_co), '[]'::jsonb),
    'por_motivo_faltante', coalesce((select datos from por_motivo_faltante), '[]'::jsonb),
    'por_motivo_incumplimiento', coalesce((select datos from por_motivo_incumplimiento), '[]'::jsonb),
    'por_item', coalesce((select datos from por_item), '[]'::jsonb)
  );
$$;
