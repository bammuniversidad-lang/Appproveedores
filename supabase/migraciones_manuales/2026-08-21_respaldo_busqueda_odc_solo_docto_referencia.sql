-- =====================================================================
-- Respaldo de búsqueda en odc_historico: si el cruce por C.O. + Docto
-- referencia no encuentra nada, intentar solo por Docto referencia.
--
-- CÓMO EJECUTAR ESTE ARCHIVO (mientras el conector de Supabase de Claude
-- no esté disponible):
--   1. Entra al Dashboard de Supabase: https://supabase.com/dashboard
--   2. Abre el proyecto "ns-proveedores".
--   3. Ve a "SQL Editor" (menú de la izquierda) > "New query".
--   4. Copia y pega TODO el contenido de este archivo.
--   5. Presiona "Run" (o Ctrl+Enter).
--   6. Debe decir "Success. No rows returned" -- eso confirma que la
--      función quedó actualizada.
--
-- Qué hace: la función corregir_fechas_orden_ns_proveedores() usaba un
-- solo cruce contra el histórico de ODC: C.O. + Docto referencia
-- (normalizado) contra C.O. + Nro orden (normalizado). Si ese cruce no
-- encontraba nada -- por ejemplo porque el C.O. quedó mal registrado en
-- el histórico para esa orden puntual -- la línea quedaba marcada para
-- revisión manual sin más intentos.
--
-- Ahora, si el cruce con C.O. no encuentra nada, se intenta un segundo
-- cruce SOLO por Docto referencia (normalizado) contra Nro orden
-- (normalizado), sin exigir que el C.O. coincida. Esto es seguro porque
-- odc_historico tiene una restricción `unique (nro_orden)` -- un Nro
-- orden solo puede corresponder a una fila en el histórico, así que este
-- cruce de respaldo nunca puede traer más de una coincidencia por línea.
-- =====================================================================
create or replace function corregir_fechas_orden_ns_proveedores()
returns table(filas_evaluadas int, filas_corregidas int, filas_pendientes_revision int)
language plpgsql
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
    coalesce(h_co.fecha, h_solo.fecha) as fecha_historica
  from pedidos_detalle d
  join (
    select yave, max(fecha) as fecha_entrega_real
    from entradas_ea
    where fecha is not null
    group by yave
  ) e on e.yave = d.yave
  left join odc_historico h_co
    on h_co.co = d.co
   and normalizar_nro_orden(h_co.nro_orden) = normalizar_nro_orden(d.docto_referencia)
  left join odc_historico h_solo
    on normalizar_nro_orden(h_solo.nro_orden) = normalizar_nro_orden(d.docto_referencia)
  where d.fecha_orden is not null
    and d.fecha_orden = e.fecha_entrega_real;

  select count(*) into v_evaluadas from tmp_candidatas_fecha_orden;

  -- Caso 1: se encontró la fecha real de la orden inicial en el histórico
  -- de ODC (cruzando C.O. + Docto referencia normalizado contra C.O. +
  -- Nro orden normalizado, o si eso no encontró nada, cruzando SOLO por
  -- Docto referencia normalizado contra Nro orden normalizado) y es
  -- distinta a la fecha de entrada -> se corrige "Fecha orden"
  -- automáticamente, guardando la fecha original para trazabilidad.
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
    and t.fecha_historica <> t.fecha_entrega_real;

  get diagnostics v_corregidas = row_count;

  -- Caso 2: no se encontró la orden original en el histórico de ODC
  -- (falta "Docto referencia", esa orden no está en el histórico ni por
  -- C.O.+Docto referencia ni solo por Docto referencia, o su fecha
  -- también coincide con la de entrada) -> no se puede resolver sola; se
  -- marca para que el usuario la revise manualmente.
  update pedidos_detalle d
  set necesita_revision = true
  from tmp_candidatas_fecha_orden t
  where d.id = t.id
    and (t.fecha_historica is null or t.fecha_historica = t.fecha_entrega_real);

  get diagnostics v_pendientes = row_count;

  -- Limpieza: filas marcadas "necesita_revision" en una corrida anterior
  -- que ya no aplican (por ejemplo, porque el usuario corrigió la fecha
  -- manualmente y ya no coincide con la fecha de entrada).
  update pedidos_detalle d
  set necesita_revision = false
  where d.necesita_revision = true
    and not exists (select 1 from tmp_candidatas_fecha_orden t where t.id = d.id);

  return query select v_evaluadas, v_corregidas, v_pendientes;
end;
$$;

-- =====================================================================
-- Después de correr esto, ve a la pantalla "Nivel de servicio" de la
-- app y presiona el botón "Corregir fechas de orden" para que la lógica
-- nueva se aplique a los datos que ya tienes cargados (la función no se
-- ejecuta sola con este cambio -- solo queda lista para la próxima vez
-- que se llame, ya sea por ese botón o por la próxima importación).
-- =====================================================================
