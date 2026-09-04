-- =====================================================================
-- 1. Las tarjetas de Nivel de servicio filtran ahora por "Fecha cumplido"
--    (en vez de "Fecha orden"), igual que ya quedó la tabla de abajo en
--    el código de la app. Sin este cambio, las tarjetas y la tabla
--    mostrarían totales distintos para el mismo rango de fechas.
--
-- CÓMO EJECUTAR ESTE ARCHIVO (mientras el conector de Supabase de Claude
-- siga apuntando a la cuenta equivocada):
--   1. Entra al Dashboard de Supabase: https://supabase.com/dashboard
--   2. Abre el proyecto "ns-proveedores".
--   3. Ve a "SQL Editor" (menú de la izquierda) > "New query".
--   4. Copia y pega TODO el contenido de este archivo.
--   5. Presiona "Run" (o Ctrl+Enter).
--   6. Debe decir "Success" -- eso confirma que quedó aplicado.
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
      and (fecha_inicio is null or v.fecha_cumplido >= fecha_inicio)
      and (fecha_fin is null or v.fecha_cumplido <= fecha_fin)
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

-- =====================================================================
-- 2. DIAGNÓSTICO -- "Fecha de cumplido" sale en blanco en el respaldo de
--    Cierre de mes. Corre esta consulta (selecciónala sola y presiona
--    Run) para ver si el dato ya existe en la base o si el problema es
--    que nunca se cargó:
--
--    - Si "con_fecha" da 0 (o muy bajo comparado con "total"): las
--      líneas que ya tienes cargadas NO tienen fecha de cumplido guardada
--      -- lo más probable es que el encabezado de esa columna en tu
--      archivo BASE.xlsx no calzaba exactamente con "Fecha de cumplido"
--      (ya agregué variantes en el código para la próxima carga: "Fecha
--      cumplido", "Fecha de cumplimiento", "Fecha cumplimiento"). Para
--      las líneas que YA están cargadas, no hay forma de completar ese
--      dato sin volver a importar el archivo original de ese período.
--    - Si "con_fecha" es alto: el dato SÍ está en la base, y el
--      problema estaba en otro lado (avísame para revisar más).
-- =====================================================================
select
  count(*) as total,
  count(*) filter (where fecha_cumplido is not null) as con_fecha,
  count(*) filter (where fecha_cumplido is null) as sin_fecha
from pedidos_detalle;
