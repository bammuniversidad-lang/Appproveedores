-- =====================================================================
-- ARREGLA: Nivel de servicio (y Novedades, que usa la misma vista) se
-- demoran demasiado en cargar, y a veces sale "canceling statement due
-- to statement timeout" -- aunque el panel de Supabase muestre CPU,
-- memoria y disco en buen estado (el problema no es de recursos del
-- servidor, es de cuántas filas tiene que recorrer cada consulta).
--
-- DOS CAUSAS ENCONTRADAS:
--
-- 1. La vista v_ns_proveedores agregaba TODA la tabla entradas_ea
--    ("group by yave, max(fecha)") en cada consulta, sin importar el
--    rango de fechas pedido. entradas_ea es acumulativa (crece con cada
--    carga y solo se vacía en Cierre de mes), así que esa agregación se
--    va poniendo más lenta con el tiempo. Se reemplazó por una búsqueda
--    LATERAL con "order by fecha desc limit 1" por cada línea, que usa
--    el índice idx_entradas_ea_yave_fecha para resolver cada una en vez
--    de recorrer toda la tabla.
--
-- 2. El cambio de la vez pasada (filtrar por "fecha_referencia" =
--    coalesce(fecha_cumplido, fecha_orden), para no perder líneas sin
--    fecha_cumplido) tuvo un efecto secundario: como coalesce(a, b) no
--    calza con el índice normal de una sola columna, Postgres dejó de
--    poder usar el índice de fechas y pasó a recorrer TODA la tabla
--    pedidos_detalle en cada consulta, sin importar el rango pedido. Se
--    agrega un índice de expresión sobre exactamente ese coalesce() para
--    que vuelva a poder usar un índice.
--
-- CÓMO EJECUTAR ESTE ARCHIVO:
--   1. Entra al Dashboard de Supabase: https://supabase.com/dashboard
--   2. Abre el proyecto "ns-proveedores".
--   3. Ve a "SQL Editor" > "New query".
--   4. Copia y pega TODO el contenido de este archivo.
--   5. Presiona "Run" (o Ctrl+Enter). Debe decir "Success".
--   6. Vuelve a Nivel de servicio / Novedades y presiona "Actualizar"
--      para confirmar que ya carga más rápido.
-- =====================================================================

-- 1. Índice de expresión para el filtro de fechas (arregla la causa 2).
create index if not exists idx_pedidos_detalle_fecha_referencia
  on pedidos_detalle (coalesce(fecha_cumplido, fecha_orden));

-- 2. Vista recreada con LATERAL en vez de agregar toda entradas_ea
--    (arregla la causa 1). El resto de la vista queda exactamente igual
--    a como estaba (mismas columnas, mismo orden).
create or replace view v_ns_proveedores
  with (security_invoker = true) as
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
    coalesce(c.fecha_cumplido, c.fecha_orden) as fecha_referencia
  from con_diferencia c
  left join motivos m on m.id = c.motivo_id
  left join motivos mf on mf.id = c.motivo_faltante_id;

-- =====================================================================
-- Nota: si después de correr esto SIGUE lenta o sigue saliendo el
-- timeout, avísame con el rango de fechas exacto que estabas probando --
-- puede que necesitemos revisar cuántas filas tiene ya cada tabla
-- (pedidos_detalle / entradas_ea) para decidir si hace falta un Cierre
-- de mes (vaciar el período ya cerrado) o algo más.
-- =====================================================================
