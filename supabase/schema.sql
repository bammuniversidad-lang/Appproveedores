-- =====================================================================
-- NS PROVEEDORES - Esquema de base de datos (Supabase / PostgreSQL)
-- Etapa 1
-- =====================================================================
-- Proyecto de Supabase INDEPENDIENTE del de "Compras" (usuarios propios,
-- mismo diseño visual). Cómo usarlo:
--   1. Crea un proyecto nuevo en https://supabase.com
--   2. Ve a SQL Editor y pega/ejecuta este archivo completo, de un solo
--      pegado (no por partes).
--   3. Copia la URL y las llaves (anon y service_role) a .env.local
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PERFILES DE USUARIO (extiende auth.users) - igual que en Compras
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  correo text not null,
  celular text,
  rol text not null default 'usuario' check (rol in ('administrador', 'comprador', 'usuario')),
  cos_permitidos text[] not null default '{}',
  ve_todos_co boolean not null default false,
  -- Módulos visibles: 'importar','nivel_servicio','configuracion_usuarios','configuracion_motivos'
  modulos_permitidos text[] not null default '{}',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table profiles is 'Perfil extendido de cada usuario, referenciado a auth.users';

-- ---------------------------------------------------------------------
-- 2. MOTIVOS (catálogo de causales de incumplimiento / novedades)
--    Tomados de la hoja GUIA de tu Excel actual, editables desde la app.
-- ---------------------------------------------------------------------
create table if not exists motivos (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  responsable text,
  created_at timestamptz not null default now()
);

insert into motivos (nombre, responsable)
values
  ('DESCODIFICADO', ''),
  ('NEGOCIACION FIN DE MES', ''),
  ('CAMBIO DE FACTURA', ''),
  ('RECOGE JUAN D HOYOS', ''),
  ('BAJO PEDIDO', ''),
  ('VIENE DE OTRO LUGAR', ''),
  ('ORDEN PUBLICO', ''),
  ('BLOQUEO POR CARTERA', ''),
  ('INCUMPLIDO', ''),
  ('CONSOLIDACION DE CARGA', ''),
  ('NO SE ENVIO ORDEN DE COMPRA', ''),
  ('PROMOCIONES', '')
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------
-- 3. TIEMPO DE ENTREGA POR PROVEEDOR - maestro editable (agregar
--    proveedores nuevos, modificar registros existentes uno a uno desde
--    Configuración > Tiempo de entrega). La carga inicial desde Excel
--    hace upsert por C.O. + Proveedor (no borra lo que ya esté cargado).
--    Llave: C.O. + Proveedor
-- ---------------------------------------------------------------------
create table if not exists tiempo_entrega (
  id bigint generated always as identity primary key,
  co text not null,
  proveedor text not null,
  tipo_entrega text,
  dias_entrega numeric not null default 0,
  nit text,
  condicion_pago text,
  sucursal text,
  pedido_minimo_valor numeric,
  pedido_minimo_peso numeric,
  pedido_minimo_volumen numeric,
  pedido_minimo_cajas numeric,
  pedido_minimo_unidades numeric,
  archivo_origen text,
  cargado_por uuid references profiles(id),
  cargado_en timestamptz not null default now(),
  constraint tiempo_entrega_unico unique (co, proveedor)
);

create index if not exists idx_tiempo_entrega_cargado_por on tiempo_entrega(cargado_por);

-- ---------------------------------------------------------------------
-- 4. HISTÓRICO DE ODC (hoja "ODC" de tu Excel) - acumulativa, upsert por
--    Nro orden. Esta es la tabla que resuelve la fecha real de la orden
--    de compra inicial cuando "Fecha orden" quedó igual a la fecha de
--    entrada.
-- ---------------------------------------------------------------------
create table if not exists odc_historico (
  id bigint generated always as identity primary key,
  co text,
  nro_orden text not null,
  fecha date not null,
  archivo_origen text,
  cargado_por uuid references profiles(id),
  cargado_en timestamptz not null default now(),
  constraint odc_historico_unico unique (nro_orden)
);

create index if not exists idx_odc_historico_nro_orden on odc_historico(nro_orden);
create index if not exists idx_odc_historico_cargado_por on odc_historico(cargado_por);

-- ---------------------------------------------------------------------
-- 5. ENTRADAS / EVALUACIÓN DE PROVEEDORES (hoja "EA") - acumulativa.
--    yave = C.O. (co_docto) + Docto. orden (Nro orden/ODC) + Referencia +
--    Bodega. Puede repetirse si un mismo pedido tuvo varias entradas
--    parciales; para "fecha de entrega real" se usa la fecha MÁS RECIENTE
--    registrada para ese yave (ver v_ns_proveedores).
-- ---------------------------------------------------------------------
create table if not exists entradas_ea (
  id bigint generated always as identity primary key,
  yave text not null,
  co_docto text,
  docto_orden text,
  proveedor text,
  bodega text,
  referencia text,
  desc_item text,
  documento text,
  cantidad numeric,
  valor_subtotal numeric,
  docto_causacion text,
  docto_referencia text,
  fecha date,
  desc_motivo text,
  docto_base text,
  archivo_origen text,
  cargado_por uuid references profiles(id),
  cargado_en timestamptz not null default now()
);

create index if not exists idx_entradas_ea_yave on entradas_ea(yave);
create index if not exists idx_entradas_ea_cargado_por on entradas_ea(cargado_por);

-- ---------------------------------------------------------------------
-- 6. PEDIDOS / DETALLE (hoja "DETALLE") - acumulativa, valida duplicados
--    por C.O. + Nro orden + Referencia + Bodega (= "YAVE" en tu Excel).
-- ---------------------------------------------------------------------
create table if not exists pedidos_detalle (
  id bigint generated always as identity primary key,
  yave text not null,
  nro_orden text not null,
  co text not null,
  bodega text,
  proveedor text,
  referencia text not null,
  desc_item text,
  cant_ordenada numeric not null default 0,
  cant_entrada_inv numeric not null default 0,
  cant_pendiente_inv numeric not null default 0,
  -- Fecha en que el ERP marca la orden como "cumplida" (primera columna
  -- de tu archivo BASE.xlsx). Dato de origen -- distinto de "fecha de
  -- entrega real", que la app calcula desde EA.
  fecha_cumplido date,
  fecha_orden date,
  -- Trazabilidad de la corrección automática de fecha (el tema que pediste):
  fecha_orden_original date,
  fecha_orden_corregida boolean not null default false,
  fecha_orden_corregida_en timestamptz,
  necesita_revision boolean not null default false,
  precio_unit numeric not null default 0,
  valor_bruto numeric not null default 0,
  docto_referencia text,
  notas_documento text,
  -- asignación de motivo de INCUMPLIMIENTO EN TIEMPO DE ENTREGA (columna
  -- "Cumplimiento" = INCUMPLIDO; igual patrón que "Pendientes" en Compras)
  motivo_id bigint references motivos(id),
  responsable_motivo text,
  motivo_asignado_en timestamptz,
  motivo_asignado_por uuid references profiles(id),
  -- asignación de motivo de FALTANTE DE ÍTEM (cant_pendiente_inv > 0,
  -- columna "Observaciones" = INCOMPLETA) -- independiente del motivo de
  -- incumplimiento en tiempo de entrega de arriba: una línea puede tener
  -- cantidad pendiente sin haber incumplido el tiempo de entrega (o
  -- viceversa), así que necesitan su propio motivo y su propio responsable.
  motivo_faltante_id bigint references motivos(id),
  responsable_motivo_faltante text,
  motivo_faltante_asignado_en timestamptz,
  motivo_faltante_asignado_por uuid references profiles(id),
  archivo_origen text,
  cargado_por uuid references profiles(id),
  cargado_en timestamptz not null default now(),
  constraint pedidos_detalle_unico unique (yave)
);

create index if not exists idx_pedidos_detalle_co on pedidos_detalle(co);
create index if not exists idx_pedidos_detalle_nro_orden on pedidos_detalle(nro_orden);
create index if not exists idx_pedidos_detalle_fecha_orden on pedidos_detalle(fecha_orden);
create index if not exists idx_pedidos_detalle_revision on pedidos_detalle(necesita_revision) where necesita_revision = true;
create index if not exists idx_pedidos_detalle_cargado_por on pedidos_detalle(cargado_por);
create index if not exists idx_pedidos_detalle_motivo_asignado_por on pedidos_detalle(motivo_asignado_por);
create index if not exists idx_pedidos_detalle_motivo_id on pedidos_detalle(motivo_id);
create index if not exists idx_pedidos_detalle_motivo_faltante_id on pedidos_detalle(motivo_faltante_id);
create index if not exists idx_pedidos_detalle_motivo_faltante_asignado_por on pedidos_detalle(motivo_faltante_asignado_por);

-- ---------------------------------------------------------------------
-- 7. LOG DE IMPORTACIONES
-- ---------------------------------------------------------------------
create table if not exists import_logs (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('pedidos_detalle','entradas_ea','odc_historico','tiempo_entrega','motivos')),
  archivo text,
  usuario_id uuid references profiles(id),
  registros_totales int not null default 0,
  registros_insertados int not null default 0,
  registros_omitidos int not null default 0,
  errores jsonb not null default '[]',
  omitidos_detalle jsonb not null default '[]',
  duracion_ms int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_import_logs_usuario_id on import_logs(usuario_id);

-- =====================================================================
-- FUNCIÓN AUXILIAR: días hábiles entre dos fechas (equivalente a
-- NETWORKDAYS.INTL de Excel, semana Lun-Vie).
-- =====================================================================
create or replace function dias_habiles_entre(fecha_inicio date, fecha_fin date)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when fecha_inicio is null or fecha_fin is null then null
    when fecha_fin >= fecha_inicio then (
      select count(*)::int from generate_series(fecha_inicio, fecha_fin, interval '1 day') d
      where extract(isodow from d) < 6
    )
    else -(
      select count(*)::int from generate_series(fecha_fin, fecha_inicio, interval '1 day') d
      where extract(isodow from d) < 6
    )
  end;
$$;

-- =====================================================================
-- Quita el prefijo "ODC-" y los ceros a la izquierda de un número de
-- orden, para poder comparar "Nro orden" del histórico de ODC contra
-- "Docto referencia" de Pedidos sin importar el formato de cada uno
-- (ej. "ODC-00189722" y "189722" deben quedar iguales: "189722").
-- =====================================================================
create or replace function normalizar_nro_orden(texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(ltrim(regexp_replace(coalesce(texto, ''), '[^0-9]', '', 'g'), '0'), '');
$$;

-- =====================================================================
-- FUNCIÓN CLAVE: corrige automáticamente "Fecha orden" cuando quedó
-- igual a la fecha real de entrada, usando el histórico de ODC, y marca
-- para revisión manual los casos que sigan sin resolverse.
--
-- Reemplaza la fórmula de la columna "Fecha ODC" de tu hoja "BD Calculos"
-- (que hoy está incompleta: =XLOOKUP(ODC!D:D,ODC!C:C) no trae el valor a
-- buscar) por una corrección real, en el servidor, que deja rastro de lo
-- que cambió.
--
-- IMPORTANTE (arreglado a partir de un caso real que reportó el usuario):
-- "Nro orden" en Pedidos YA ES la orden nueva/modificada (por eso quedó
-- con la misma fecha que la entrada) -- la orden ORIGINAL está
-- referenciada en la columna "Docto referencia" de Pedidos (ej.
-- "189722"), que hay que cruzar contra "Nro orden" del histórico de ODC
-- (ej. "ODC-00189722") normalizando ambos con normalizar_nro_orden().
-- Cruzar "Nro orden" contra "Nro orden" (como se hacía antes) nunca
-- encontraba nada, porque son literalmente la misma orden en Pedidos.
--
-- Se debe llamar (la app ya lo hace):
--   - automáticamente al terminar de importar Pedidos, EA, o el
--     histórico de ODC
--   - manualmente con el botón "Corregir fechas de orden" en la pantalla
--     de Nivel de servicio
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
  select d.id, d.nro_orden, d.fecha_orden, e.fecha_entrega_real, h.fecha as fecha_historica
  from pedidos_detalle d
  join (
    select yave, max(fecha) as fecha_entrega_real
    from entradas_ea
    where fecha is not null
    group by yave
  ) e on e.yave = d.yave
  left join odc_historico h
    on h.co = d.co
   and normalizar_nro_orden(h.nro_orden) = normalizar_nro_orden(d.docto_referencia)
  where d.fecha_orden is not null
    and d.fecha_orden = e.fecha_entrega_real;

  select count(*) into v_evaluadas from tmp_candidatas_fecha_orden;

  -- Caso 1: se encontró la fecha real de la orden inicial en el histórico
  -- de ODC (cruzando C.O. + Docto referencia normalizado contra C.O. +
  -- Nro orden normalizado) y es distinta a la fecha de entrada -> se
  -- corrige "Fecha orden" automáticamente, guardando la fecha original
  -- para trazabilidad.
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
-- VISTA PRINCIPAL: reemplaza las columnas Q:Y de la hoja "BD Calculos"
-- =====================================================================
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
    mf.responsable as motivo_faltante_responsable
  from con_diferencia c
  left join motivos m on m.id = c.motivo_id
  left join motivos mf on mf.id = c.motivo_faltante_id;

-- Nota de migración (producción): en la base de datos en vivo esta vista se
-- recreó con DROP + CREATE en vez de CREATE OR REPLACE, porque la vista ya
-- desplegada había quedado "congelada" con una lista de columnas de antes
-- de que pedidos_detalle ganara la columna fecha_cumplido (las vistas con
-- "tabla.*" fijan la lista de columnas al momento de crearse, no se
-- actualizan solas cuando la tabla gana columnas nuevas). Si vuelves a
-- correr este archivo completo contra una base de datos NUEVA (vacía) no
-- tienes ese problema -- "create or replace view" funciona sin más.

-- =====================================================================
-- FUNCIÓN: tarjetas de nivel de servicio para la pantalla principal
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
      and (fecha_inicio is null or v.fecha_orden >= fecha_inicio)
      and (fecha_fin is null or v.fecha_orden <= fecha_fin)
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
-- FUNCIÓN: Dashboard completo (tarjetas + tablas + gráfico por C.O.)
--
-- "Órdenes" (documentos) se calculan agrupando por Nro orden (no por
-- línea/ítem):
--   - en_full (sin pendientes) = la orden completa (todas sus líneas)
--     quedó con cantidad pendiente = 0.
--   - a_tiempo (on time) = TODAS las líneas de la orden tienen
--     diferencia <= 1 día hábil (si alguna línea no tiene fecha de
--     entrega real todavía, la orden cuenta como NO a tiempo -- igual
--     que en el cálculo de NS de líneas/valor).
--   - completas = sin pendientes Y a tiempo (OTIF a nivel de orden).
--   - OTIF = (órdenes a tiempo / total) * (órdenes sin pendientes / total),
--     tal como lo definiste.
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
      and (fecha_inicio is null or v.fecha_orden >= fecha_inicio)
      and (fecha_fin is null or v.fecha_orden <= fecha_fin)
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

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table profiles enable row level security;
alter table motivos enable row level security;
alter table tiempo_entrega enable row level security;
alter table odc_historico enable row level security;
alter table entradas_ea enable row level security;
alter table pedidos_detalle enable row level security;
alter table import_logs enable row level security;

-- Nota: los filtros de RLS usan (select auth.uid()) / (select auth.role())
-- en vez de auth.uid() / auth.role() directo, para que Postgres los evalúe
-- una sola vez por consulta en vez de una vez por fila (recomendación del
-- linter de seguridad de Supabase: "Auth RLS Initialization Plan").
--
-- IMPORTANTE: el chequeo de "es administrador" NO se hace con una subquery
-- directa "exists (select 1 from profiles p2 where ...)" dentro de las
-- políticas DE profiles, porque eso hace que la política de profiles se
-- consulte a sí misma -> Postgres lo detecta como "infinite recursion
-- detected in policy for relation profiles" y CUALQUIER select a profiles
-- desde el navegador (rol anon/authenticated) falla. Por eso se usa una
-- función SECURITY DEFINER (corre con permisos del dueño de la tabla, así
-- que no vuelve a pasar por RLS al mirar profiles por dentro).
create or replace function public.es_administrador()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and rol = 'administrador'
  );
$$;

-- Solo se llama desde dentro de las políticas de abajo (para usuarios ya
-- autenticados) -- se le quita ejecución directa por RPC a anon/public.
revoke execute on function public.es_administrador() from public;
revoke execute on function public.es_administrador() from anon;
grant execute on function public.es_administrador() to authenticated;

create policy "ver propio perfil o admin ve todos" on profiles
  for select using (
    (select auth.uid()) = id
    or public.es_administrador()
  );

create policy "solo admin inserta perfiles" on profiles
  for insert with check ( public.es_administrador() );

create policy "solo admin actualiza perfiles" on profiles
  for update using ( public.es_administrador() );

-- motivos: lectura para cualquier autenticado, escritura solo para admin
-- (dos políticas necesarias porque los permisos difieren por acción).
create policy "autenticados leen motivos" on motivos
  for select using ((select auth.role()) = 'authenticated');
create policy "solo admin escribe motivos" on motivos
  for all using ( public.es_administrador() );

-- tiempo_entrega / odc_historico / entradas_ea / pedidos_detalle: cualquier
-- autenticado lee y escribe -> una sola política "for all" (una política de
-- solo-lectura aparte sería redundante y se re-evaluaría dos veces por fila).
create policy "autenticados leen y escriben tiempo_entrega" on tiempo_entrega
  for all using ((select auth.role()) = 'authenticated');

create policy "autenticados leen y escriben odc_historico" on odc_historico
  for all using ((select auth.role()) = 'authenticated');

create policy "autenticados leen y escriben entradas_ea" on entradas_ea
  for all using ((select auth.role()) = 'authenticated');

create policy "autenticados leen y escriben pedidos_detalle" on pedidos_detalle
  for all using ((select auth.role()) = 'authenticated');

create policy "autenticados leen logs" on import_logs
  for select using ((select auth.role()) = 'authenticated');
create policy "autenticados insertan logs" on import_logs
  for insert with check ((select auth.role()) = 'authenticated');

-- =====================================================================
-- CIERRE DE MES: borra las tablas "de periodo" (Pedidos/BASE y
-- Entradas/EA) después de que el usuario descargó el respaldo en Excel,
-- igual que en Compras. NO toca el histórico de ODC, el maestro de
-- Tiempo de entrega, Motivos, ni Usuarios. Restringido a administradores
-- como última barrera de seguridad (además del botón "escribe ELIMINAR"
-- en la pantalla de Configuración > Cierre de mes).
-- =====================================================================
create or replace function eliminar_periodo_ns_proveedores()
returns table(pedidos_eliminados bigint, entradas_eliminadas bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedidos bigint;
  v_entradas bigint;
begin
  if not public.es_administrador() then
    raise exception 'Solo un administrador puede hacer el cierre de mes.';
  end if;

  select count(*) into v_pedidos from pedidos_detalle;
  select count(*) into v_entradas from entradas_ea;

  -- Supabase bloquea por seguridad cualquier DELETE sin WHERE (extensión
  -- "safeupdate"); "where id is not null" borra todo igual, cumpliendo
  -- ese requisito.
  delete from pedidos_detalle where id is not null;
  delete from entradas_ea where id is not null;

  return query select v_pedidos, v_entradas;
end;
$$;

revoke execute on function eliminar_periodo_ns_proveedores() from public;
revoke execute on function eliminar_periodo_ns_proveedores() from anon;
grant execute on function eliminar_periodo_ns_proveedores() to authenticated;

-- =====================================================================
-- Primer usuario administrador
-- =====================================================================
-- Después de crear tu primer usuario desde Supabase Auth (Authentication
-- > Users > Add user), ejecuta esto reemplazando el UUID y los datos:
--
-- insert into profiles (id, nombre_completo, correo, rol, ve_todos_co, modulos_permitidos)
-- values (
--   'UUID-DEL-USUARIO-AQUI',
--   'Nombre Administrador',
--   'admin@empresa.com',
--   'administrador',
--   true,
--   array['importar','nivel_servicio','configuracion_usuarios','configuracion_motivos']
-- );
