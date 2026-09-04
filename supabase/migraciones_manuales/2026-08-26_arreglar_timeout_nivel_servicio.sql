-- =====================================================================
-- Arreglar "Error cargando datos: canceling statement due to statement
-- timeout" en la pantalla Nivel de servicio.
--
-- CÓMO EJECUTAR ESTE ARCHIVO (mientras el conector de Supabase de Claude
-- siga apuntando a la cuenta equivocada):
--   1. Entra al Dashboard de Supabase: https://supabase.com/dashboard
--   2. Abre el proyecto "ns-proveedores".
--   3. Ve a "SQL Editor" (menú de la izquierda) > "New query".
--   4. Copia y pega TODO el contenido de este archivo.
--   5. Presiona "Run" (o Ctrl+Enter).
--   6. Debe decir "Success. No rows returned" -- eso confirma que quedó
--      aplicado. Después vuelve a la pantalla de Nivel de servicio y
--      presiona "Actualizar" para confirmar que ya carga sin el error.
--
-- QUÉ CAUSA EL TIMEOUT: la función dias_habiles_entre() se llama una vez
-- POR CADA LÍNEA que muestra la pantalla (para calcular "diferencia" en
-- días hábiles, excluyendo fines de semana y festivos). Desde que se le
-- agregó la exclusión de festivos, cada llamada hace una subconsulta
-- adicional; multiplicado por miles de líneas, eso puede superar el
-- límite de tiempo que Supabase le da por defecto a las consultas que
-- vienen de la aplicación (normalmente 8 segundos). Además, la
-- agregación "última fecha de entrada por línea" (que también se usa en
-- cada consulta) no tenía un índice óptimo para agruparse rápido a
-- medida que la tabla de entradas crece con cada carga.
--
-- Qué hace este archivo:
--   1. Optimiza dias_habiles_entre(): usa "not exists" en vez de
--      "not in" (se comporta igual, pero Postgres lo planifica más
--      rápido), se marca "parallel safe" para que la consulta pueda
--      repartirse en varios núcleos, y se agrega un límite de seguridad:
--      si el rango entre las dos fechas es mayor a ~10 años, seguramente
--      hay una fecha mal cargada -- se devuelve null en vez de recorrer
--      miles de días innecesariamente para esa fila.
--   2. Agrega un índice compuesto en entradas_ea(yave, fecha desc) para
--      que buscar "la fecha de entrada más reciente de cada línea" sea
--      mucho más rápido, sobre todo a medida que la tabla crece (es
--      acumulativa, nunca se borra).
--   3. Sube el límite de tiempo (statement_timeout) de las consultas que
--      hace la aplicación de 8 segundos (el valor por defecto de
--      Supabase) a 30 segundos, como alivio inmediato mientras las
--      optimizaciones anteriores hacen efecto. Esto es un margen de
--      seguridad, no una solución por sí sola -- si la consulta sigue
--      siendo lenta por otra razón (por ejemplo si la base de datos
--      crece mucho más), puede volver a pasar.
-- =====================================================================

-- 1. Función optimizada -------------------------------------------------
create or replace function dias_habiles_entre(fecha_inicio date, fecha_fin date)
returns int
language sql
stable
parallel safe
set search_path = public
as $$
  select case
    when fecha_inicio is null or fecha_fin is null then null
    when abs(fecha_fin - fecha_inicio) > 3660 then null
    when fecha_fin >= fecha_inicio then (
      select count(*)::int from generate_series(fecha_inicio, fecha_fin, interval '1 day') d
      where extract(isodow from d) < 6
        and not exists (select 1 from dias_festivos_colombia f where f.fecha = d::date)
    )
    else -(
      select count(*)::int from generate_series(fecha_fin, fecha_inicio, interval '1 day') d
      where extract(isodow from d) < 6
        and not exists (select 1 from dias_festivos_colombia f where f.fecha = d::date)
    )
  end;
$$;

-- 2. Índice para acelerar "última fecha de entrada por línea" ----------
create index if not exists idx_entradas_ea_yave_fecha on entradas_ea(yave, fecha desc);

-- 3. Subir el límite de tiempo de las consultas de la aplicación -------
alter role authenticated set statement_timeout = '30s';
alter role anon set statement_timeout = '30s';
select pg_reload_conf();

-- =====================================================================
-- Después de correr esto: entra a "Nivel de servicio" en la app y
-- presiona "Actualizar". Si el rango de fechas es muy amplio (varios
-- meses o años), es normal que tarde un poco más -- si sigue fallando,
-- prueba con un rango más corto primero para confirmar que el error ya
-- no es el timeout, y avísame para revisar más a fondo (probablemente
-- haya que precalcular la "diferencia" al momento de importar, en vez de
-- calcularla cada vez que se consulta).
-- =====================================================================
