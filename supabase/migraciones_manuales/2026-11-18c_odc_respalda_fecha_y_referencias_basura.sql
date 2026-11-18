-- =====================================================================
-- RESULTADO DEL DIAGNÓSTICO (y por qué dio "564 evaluadas, 0 corregidas")
--
-- El histórico de ODC SÍ tiene esas órdenes -- incluida ODC-00064007 del
-- C.O. 003 (28/10/2026, archivo ODC.xlsx, cargado el 29/10). Lo que pasa
-- es que el histórico CONFIRMA EXACTAMENTE LA MISMA FECHA que ya tiene la
-- línea. Se ve clarísimo en la muestra:
--
--   nro_orden      fecha_orden   fecha_entrega_real   fecha_en_el_odc
--   ODC-00191142   2026-08-31    2026-08-31           2026-08-31
--   ODC-00191155   2026-08-31    2026-08-31           2026-08-31
--   ODC-00191311   2026-09-03    2026-09-03           2026-09-03
--
-- O sea: NO hay una fecha anterior que traer. Esas órdenes se pidieron y
-- se recibieron el mismo día, y hay dos fuentes independientes (Pedidos y
-- el ODC) que dicen lo mismo. El rojo era una falsa alarma: venía de la
-- regla "si la fecha de orden es igual a la de entrada, sospecha", que se
-- hizo para detectar cuando el ERP pisa la fecha, pero que no sabía
-- distinguir una fecha pisada de una entrega el mismo día.
--
-- QUÉ CAMBIA ESTE ARCHIVO (tres cosas):
--
-- 1. Si el histórico de ODC RESPALDA la fecha de la línea (esa misma
--    orden figura en el ODC con esa misma fecha), la línea deja de salir
--    en rojo y deja de contarse en "Por revisar". Son las 564.
--
-- 2. Guardia contra "Docto. referencia" basura. En los datos reales hay
--    valores como "mde1" (que al normalizar queda en "1") y "ECO 225"
--    (queda en "225"). Sin guardia, esos cruzan contra órdenes reales
--    como ODC-00000001 y le ponen a la línea la fecha de una orden que no
--    tiene nada que ver. Ahora se exigen al menos 4 dígitos.
--
-- 3. La tarjeta "Por revisar" cuenta con el mismo criterio que la
--    pantalla, para que no se contradigan.
--
-- ✅ ESTO NO MUEVE EL INDICADOR de nivel de servicio: esas líneas ya
-- contaban como cumplidas (se recibieron el mismo día). Lo único que
-- cambia es que dejan de aparecer como pendientes de revisión.
--
-- CÓMO EJECUTARLO: SQL Editor del proyecto ns-proveedores. Corre el PASO
-- 1 para ver el impacto, y luego los pasos 2, 3, 4 y 5.
-- =====================================================================


-- =====================================================================
-- PASO 1 — VISTA PREVIA. No cambia nada.
-- Cuántas de las que hoy salen en rojo las respalda el ODC (esas se
-- apagan) y cuántas quedarían realmente pendientes.
-- =====================================================================
with entregas as (
  select yave, max(fecha) as f from entradas_ea where fecha is not null group by yave
),
rojas as (
  select d.id, d.nro_orden, d.fecha_orden,
         exists (select 1 from odc_historico h
                 where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
                   and h.fecha = d.fecha_orden) as odc_respalda
  from pedidos_detalle d
  join entregas e on e.yave = d.yave
  where d.fecha_orden is not null
    and d.fecha_orden_original is null
    and d.fecha_orden = e.f
)
select
  count(*)                                             as lineas_hoy_en_rojo,
  count(*) filter (where odc_respalda)                 as dejan_de_estar_en_rojo,
  count(*) filter (where not odc_respalda)             as quedan_pendientes_de_verdad,
  count(distinct nro_orden) filter (where odc_respalda) as documentos_que_se_apagan
from rojas;


-- =====================================================================
-- PASO 2 — Corrección de fechas: guardia contra referencias basura y no
-- marcar lo que el ODC respalda.
-- =====================================================================
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
    -- Orden de preferencia para la fecha real de la orden:
    --   1-2. La orden ORIGINAL, si esta es una modificación: se busca el
    --        "Docto. referencia" en el histórico (primero exigiendo el
    --        mismo C.O., y si no aparece, solo por el número).
    --   3-4. El PROPIO "Nro orden" de la línea en el histórico. Este era
    --        el paso que faltaba: cuando el ERP pisa la fecha de la orden
    --        con la de entrada y la orden NO es una modificación (no tiene
    --        Docto. referencia), el histórico de ODC igual sabe en qué
    --        fecha se creó esa orden. Antes no se consultaba nunca, así
    --        que esas líneas quedaban marcadas "por revisar" para siempre
    --        aunque el dato estuviera a la mano (caso real: ODC-00064007
    --        del C.O. 003, que en el histórico es del 2026-10-28).
    coalesce(h_ref_co.fecha, h_ref.fecha, h_propio_co.fecha, h_propio.fecha) as fecha_historica,
    (d.fecha_orden = e.fecha_entrega_real) as fecha_igual_a_entrada
  from pedidos_detalle d
  join (
    select yave, max(fecha) as fecha_entrega_real
    from entradas_ea
    where fecha is not null
    group by yave
  ) e on e.yave = d.yave
  -- Todos los cruces van como LATERAL con "limit 1": la restricción
  -- "unique (nro_orden)" de odc_historico es sobre el número CRUDO, pero
  -- el cruce se hace sobre el NORMALIZADO, y dos valores crudos distintos
  -- ("ODC-00189722" y "189722") normalizan al mismo texto. Con limit 1 se
  -- garantiza una sola coincidencia por línea, tomando la fecha más
  -- antigua, para que el resultado sea estable y repetible.
  -- El "length(...) >= 4" NO es un capricho: "Docto. referencia" trae de
  -- todo. En los datos reales hay valores como "mde1" (que al normalizar
  -- queda en "1") o "ECO 225" (queda en "225"), y sin el guardia esos
  -- cruzarían contra órdenes reales como ODC-00000001 u ODC-00000225 y
  -- le pondrían a la línea una fecha de otra orden sin nada que ver.
  left join lateral (
    select h.fecha from odc_historico h
    where h.co = d.co
      and normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
      and length(normalizar_nro_orden(d.docto_referencia)) >= 4
    order by h.fecha limit 1
  ) h_ref_co on true
  left join lateral (
    select h.fecha from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
      and length(normalizar_nro_orden(d.docto_referencia)) >= 4
    order by h.fecha limit 1
  ) h_ref on true
  left join lateral (
    select h.fecha from odc_historico h
    where h.co = d.co
      and normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
    order by h.fecha limit 1
  ) h_propio_co on true
  left join lateral (
    select h.fecha from odc_historico h
    where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
    order by h.fecha limit 1
  ) h_propio on true
  where d.fecha_orden is not null
    -- Guardia: si el histórico de ODC dice que ESA MISMA orden se creó justo
    -- en la fecha que la línea ya tiene, la fecha de orden es correcta y la
    -- línea no se toca: ni se corrige ni se marca para revisión. Esto apaga
    -- las falsas alarmas (564 líneas en la base real: órdenes pedidas y
    -- recibidas el mismo día) y, sobre todo, evita que un "Docto. referencia"
    -- con basura pero largo (en los datos reales hay "ELEC 156457", que
    -- normaliza a "156457") cruce contra una orden ajena y le cambie la fecha
    -- a una línea que estaba bien.
    and not exists (
      select 1 from odc_historico h
      where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.nro_orden)
        and h.fecha = d.fecha_orden
    )
    and (
      -- (A) El ERP dejó la fecha de la orden igual a la fecha de entrada.
      d.fecha_orden = e.fecha_entrega_real
      -- (B) La orden fue modificada y la original es anterior.
      or coalesce(h_ref_co.fecha, h_ref.fecha, h_propio_co.fecha, h_propio.fecha) < d.fecha_orden
    );

  select count(*) into v_evaluadas from tmp_candidatas_fecha_orden;

  -- Caso 1: el histórico de ODC tiene una fecha ANTERIOR a la que hoy
  -- tiene la línea y distinta de la de entrada -> se corrige, guardando la
  -- original para trazabilidad. Exigir que sea anterior es lo que hace la
  -- corrección repetible: una vez aplicada, la línea deja de ser candidata.
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
    and t.fecha_historica < t.fecha_orden
    and t.fecha_historica <> t.fecha_entrega_real;

  get diagnostics v_corregidas = row_count;

  -- Caso 2: quedó con la fecha de orden igual a la de entrada y el
  -- histórico no aportó una fecha anterior -> revisión manual. Las líneas
  -- que el ODC respalda ya quedaron fuera de las candidatas más arriba, así
  -- que la limpieza final les apaga la marca.
  update pedidos_detalle d
  set necesita_revision = true
  from tmp_candidatas_fecha_orden t
  where d.id = t.id
    and t.fecha_igual_a_entrada
    and (
      t.fecha_historica is null
      or t.fecha_historica >= t.fecha_orden
      or t.fecha_historica = t.fecha_entrega_real
    );

  get diagnostics v_pendientes = row_count;

  update pedidos_detalle d
  set necesita_revision = false
  where d.necesita_revision = true
    and not exists (select 1 from tmp_candidatas_fecha_orden t where t.id = d.id);

  return query select v_evaluadas, v_corregidas, v_pendientes;
end;
$$;

-- =====================================================================
-- PASO 3 — La vista gana la columna "fecha_orden_confirmada_odc", que es
-- la que usa la pantalla para no pintar en rojo esas líneas. Se agrega al
-- final, así que "create or replace view" funciona sin recrear nada más.
-- =====================================================================
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
    -- Tampoco es true cuando el histórico de ODC respalda la fecha (ver la
    -- columna fecha_orden_confirmada_odc, más abajo): ahí la coincidencia
    -- con la fecha de entrada no es un error de datos.
    (
      c.fecha_orden_original is null
      and c.fecha_entrega_real is not null
      and c.fecha_orden = c.fecha_entrega_real
      and not exists (
        select 1 from odc_historico h
        where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(c.nro_orden)
          and h.fecha = c.fecha_orden
      )
    ) as necesita_revision_actual,
    -- ¿El histórico de ODC respalda la fecha de orden que tiene la línea?
    -- Si esa misma orden figura en el ODC con esa misma fecha, entonces la
    -- fecha es correcta aunque coincida con la de entrada (se pidió y se
    -- recibió el mismo día) y no hay nada que revisar. Se usa en la
    -- pantalla para no pintar de rojo esas líneas y en la tarjeta "Por
    -- revisar" para no contarlas.
    exists (
      select 1 from odc_historico h
      where normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(c.nro_orden)
        and h.fecha = c.fecha_orden
    ) as fecha_orden_confirmada_odc
  from con_diferencia c
  left join motivos m on m.id = c.motivo_id
  left join motivos mf on mf.id = c.motivo_faltante_id;

-- =====================================================================
-- PASO 4 — La tarjeta "Por revisar" cuenta con el mismo criterio.
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
        and not fecha_orden_confirmada_odc
    ) as lineas_por_revisar,
    count(*) filter (where fecha_orden_corregida) as lineas_corregidas_automaticamente
  from base;
$$;

-- =====================================================================
-- PASO 5 — Recalcula sobre los datos ya cargados.
-- =====================================================================
select * from corregir_fechas_orden_ns_proveedores();


-- =====================================================================
-- COMPROBACIÓN — tu caso del C.O. 003 debe quedar en 2026-10-28:
-- =====================================================================
-- select distinct co, nro_orden, fecha_orden, fecha_orden_original,
--        fecha_orden_confirmada_odc, necesita_revision_actual
-- from v_ns_proveedores where normalizar_nro_orden(nro_orden) = '64007';
