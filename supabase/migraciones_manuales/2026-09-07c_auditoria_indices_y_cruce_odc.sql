-- =====================================================================
-- AUDITORÍA — Grupo 1: arreglos críticos y sin riesgo.
--
-- Este archivo NO cambia cómo se ve ni cómo se usa la aplicación. Son
-- tres cosas:
--
--   1. Quita dos índices que no servían para nada pero que había que
--      actualizar en CADA fila que se importa:
--        - odc_historico(nro_orden): la restricción "unique (nro_orden)"
--          ya crea un índice idéntico.
--        - entradas_ea(yave): el índice compuesto (yave, fecha desc) ya
--          lo cubre, porque yave es su primera columna. Y entradas_ea
--          recibe miles de filas en cada carga de EA.
--
--   2. Crea los dos índices que SÍ hacían falta: el cruce contra el
--      histórico compara normalizar_nro_orden(...) en los dos lados, y
--      no existía ningún índice sobre esa expresión -- así que la base
--      calculaba la función sobre todas las filas de las dos tablas, dos
--      veces (son dos cruces), en cada corrida. Y esa corrección corre
--      automáticamente después de CADA importación: Pedidos, EA y ODC.
--
--   3. Corrige un riesgo real de datos en corregir_fechas_orden_ns_proveedores():
--      el comentario del código decía que el cruce nunca podía traer más
--      de una coincidencia por la restricción "unique (nro_orden)", pero
--      esa restricción es sobre el Nro orden CRUDO y el cruce se hace
--      sobre el NORMALIZADO. "ODC-00189722" y "189722" son dos filas
--      válidas y distintas para la restricción, y normalizan al mismo
--      texto. Si el histórico llegaba a tener las dos, esa línea entraba
--      dos veces: se aplicaba una de las dos fechas de forma arbitraria y
--      el conteo de "líneas evaluadas" quedaba inflado. Ahora los dos
--      cruces usan LATERAL con "limit 1" y siempre toman la fecha más
--      antigua, así que el resultado es único y repetible.
--      De paso queda "security definer", para que la corrección siga
--      evaluando TODAS las líneas aunque quien importe sea un usuario
--      restringido por C.O. (ver el script 2026-09-07d).
--
-- CÓMO EJECUTAR ESTE ARCHIVO:
--   1. Entra al Dashboard de Supabase: https://supabase.com/dashboard
--   2. Abre el proyecto "ns-proveedores".
--   3. Ve a "SQL Editor" > "New query".
--   4. Copia y pega TODO el contenido de este archivo.
--   5. Presiona "Run" (o Ctrl+Enter). Debe decir "Success".
--
-- Nota: crear los índices puede tardar unos segundos si las tablas ya
-- están grandes. Es normal.
-- =====================================================================

-- 1. Quitar los dos índices redundantes -------------------------------
drop index if exists idx_odc_historico_nro_orden;
drop index if exists idx_entradas_ea_yave;

-- 2. Crear los dos índices de expresión que faltaban -------------------
create index if not exists idx_odc_historico_nro_orden_norm
  on odc_historico (normalizar_nro_orden(nro_orden));
create index if not exists idx_pedidos_detalle_docto_ref_norm
  on pedidos_detalle (normalizar_nro_orden(docto_referencia));

-- 3. Corrección de fechas: una sola coincidencia por línea -------------
-- "security definer": esta rutina de mantenimiento tiene que evaluar y
-- corregir TODAS las líneas, sin importar a qué C.O. tenga acceso quien
-- dispara la importación (ver la restricción por C.O. en la sección de RLS
-- más abajo). Si corriera con los permisos del usuario, un comprador
-- restringido a un C.O. dejaría el resto de las líneas sin corregir y sin
-- marcar. No recibe parámetros y su lógica es fija, así que no hay forma de
-- inyectarle nada.
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
    coalesce(h_co.fecha, h_solo.fecha) as fecha_historica
  from pedidos_detalle d
  join (
    select yave, max(fecha) as fecha_entrega_real
    from entradas_ea
    where fecha is not null
    group by yave
  ) e on e.yave = d.yave
  -- Los dos cruces contra el histórico van como subconsultas LATERAL con
  -- "limit 1" en vez de left join directo. Motivo (corregido en la
  -- auditoría): la restricción "unique (nro_orden)" de odc_historico es
  -- sobre el Nro orden CRUDO, pero el cruce se hace sobre el NORMALIZADO
  -- -- y dos valores crudos distintos y perfectamente válidos para esa
  -- restricción ("ODC-00189722" y "189722") normalizan al mismo texto.
  -- Si el histórico llegaba a tener los dos (p. ej. porque el ERP cambió
  -- el formato del archivo entre meses), la línea entraba DOS VECES en
  -- esta tabla temporal: el UPDATE de abajo aplicaba una de las dos
  -- fechas de forma arbitraria y el conteo de "líneas evaluadas" quedaba
  -- inflado. Con LATERAL + limit 1 se garantiza como máximo una
  -- coincidencia por línea, tomando siempre la fecha más antigua (que es
  -- la de la orden original) para que el resultado sea estable y
  -- repetible.
  left join lateral (
    select h.fecha
    from odc_historico h
    where h.co = d.co
      and normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by h.fecha
    limit 1
  ) h_co on true
  left join lateral (
    select h.fecha
    from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
    order by h.fecha
    limit 1
  ) h_solo on true
  where d.fecha_orden is not null
    and d.fecha_orden = e.fecha_entrega_real;

  select count(*) into v_evaluadas from tmp_candidatas_fecha_orden;

  -- Caso 1: se encontró la fecha real de la orden inicial en el histórico
  -- de ODC (cruzando C.O. + Docto referencia normalizado contra C.O. +
  -- Nro orden normalizado, o si eso no encontró nada, cruzando SOLO por
  -- Docto referencia normalizado contra Nro orden normalizado -- ver nota
  -- de "respaldo de búsqueda" arriba) y es distinta a la fecha de entrada
  -- -> se corrige "Fecha orden" automáticamente, guardando la fecha
  -- original para trazabilidad.
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
  -- (falta "Docto referencia", esa orden no está en el histórico, o su
  -- fecha también coincide con la de entrada) -> no se puede resolver
  -- sola; se marca para que el usuario la revise manualmente.
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
-- Opcional, para comprobar el punto 3: esta consulta lista los Nro orden
-- del histórico que comparten el mismo número normalizado (o sea, los
-- casos que causaban la doble coincidencia). Si devuelve 0 filas, el
-- problema nunca te llegó a pasar; si devuelve algo, ya quedó cubierto.
-- =====================================================================
-- select normalizar_nro_orden(nro_orden) as normalizado,
--        count(*) as veces,
--        string_agg(nro_orden, ' | ') as valores_crudos
-- from odc_historico
-- group by 1
-- having count(*) > 1
-- order by 2 desc;
