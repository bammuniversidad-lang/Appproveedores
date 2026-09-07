-- =====================================================================
-- AUDITORÍA — Punto 1.4: hacer que "C.O. permitidos" por usuario
-- realmente restrinja.
--
-- HOY: los campos "Ve todos los C.O." y "C.O. que puede ver" se guardan y
-- se muestran en Configuración > Usuarios, pero ninguna pantalla los lee y
-- la base deja leer todo a cualquier usuario autenticado. Es decir, la
-- pantalla promete una restricción que no existe.
--
-- CON ESTE CAMBIO: la restricción se aplica en la base de datos, sobre la
-- tabla pedidos_detalle. Como v_ns_proveedores se construye sobre ella y
-- está declarada "security_invoker = true", el filtro se propaga solo a
-- TODO: Nivel de servicio, Novedades, Dashboard, las tarjetas, el
-- respaldo del cierre de mes y hasta la lista desplegable de C.O. (que
-- solo mostrará los permitidos). No hay que filtrar nada a mano en el
-- frontend, y no se puede saltar el filtro llamando la API directamente.
--
-- QUIÉN VE TODO: los administradores (siempre, sin importar lo que diga
-- su lista) y cualquier usuario con la casilla "Ve todos los C.O."
-- marcada.
--
-- ⚠️  LO MÁS IMPORTANTE DE ESTE ARCHIVO: un usuario que NO tenga "ve
-- todos los C.O." y tenga la lista vacía deja de ver CUALQUIER línea. Y
-- el valor por defecto de esos campos es justamente "no ve todos" +
-- "lista vacía". Por eso el paso 2 pone "ve todos los C.O." en todos los
-- usuarios que YA existen: así nadie pierde acceso de un día para otro, y
-- a partir de ahí restringes uno por uno desde Configuración > Usuarios.
-- Si prefieres restringir a alguien desde ya, hazlo DESPUÉS de correr
-- esto, desde la pantalla de usuarios.
--
-- CÓMO EJECUTAR ESTE ARCHIVO:
--   1. Entra al Dashboard de Supabase: https://supabase.com/dashboard
--   2. Abre el proyecto "ns-proveedores".
--   3. Ve a "SQL Editor" > "New query".
--   4. Copia y pega TODO el contenido de este archivo.
--   5. Presiona "Run" (o Ctrl+Enter). Debe decir "Success".
--   6. Comprueba con la consulta del final que ningún usuario quedó sin
--      acceso por accidente.
-- =====================================================================

-- 1. Funciones auxiliares ---------------------------------------------
-- Son "security definer" por la misma razón que es_administrador(): tienen
-- que leer profiles por dentro sin volver a pasar por la RLS de profiles
-- (eso daría "infinite recursion detected in policy"). Son "stable" y sin
-- parámetros, así que dentro de la política, envueltas en (select ...),
-- Postgres las evalúa UNA vez por consulta y no una vez por fila.
create or replace function public.usuario_ve_todos_co()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select p.ve_todos_co or p.rol = 'administrador'
      from profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

create or replace function public.usuario_cos_permitidos()
returns text[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p.cos_permitidos from profiles p where p.id = auth.uid()),
    '{}'::text[]
  );
$$;

revoke execute on function public.usuario_ve_todos_co() from public;
revoke execute on function public.usuario_ve_todos_co() from anon;
grant execute on function public.usuario_ve_todos_co() to authenticated;
revoke execute on function public.usuario_cos_permitidos() from public;
revoke execute on function public.usuario_cos_permitidos() from anon;
grant execute on function public.usuario_cos_permitidos() to authenticated;

-- 2. Que nadie pierda acceso de golpe ---------------------------------
-- A todos los usuarios que ya existen y que hoy ven todo (porque hoy la
-- restricción no se aplica), se les deja explícitamente "ve todos los
-- C.O.". Los que ya tuvieran C.O. marcados se respetan tal cual: esos sí
-- quedan restringidos a su lista desde este momento.
update profiles
set ve_todos_co = true
where ve_todos_co = false
  and (cos_permitidos is null or cardinality(cos_permitidos) = 0);

-- 3. Nueva política de acceso a pedidos_detalle ------------------------
drop policy if exists "autenticados leen y escriben pedidos_detalle" on pedidos_detalle;
drop policy if exists "pedidos_detalle segun co permitidos" on pedidos_detalle;

create policy "pedidos_detalle segun co permitidos" on pedidos_detalle
  for all
  using (
    (select auth.role()) = 'authenticated'
    and (
      (select public.usuario_ve_todos_co())
      or co = any ((select public.usuario_cos_permitidos()))
    )
  )
  with check (
    (select auth.role()) = 'authenticated'
    and (
      (select public.usuario_ve_todos_co())
      or co = any ((select public.usuario_cos_permitidos()))
    )
  );

-- =====================================================================
-- 4. COMPROBACIÓN — corre esta consulta (selecciónala y presiona Run)
-- para ver cómo queda cada usuario. Revisa que nadie diga "SIN ACCESO"
-- sin que tú lo hayas querido:
-- =====================================================================
select
  correo,
  rol,
  ve_todos_co,
  cos_permitidos,
  case
    when rol = 'administrador' then 'VE TODO (es administrador)'
    when ve_todos_co then 'VE TODO'
    when cos_permitidos is null or cardinality(cos_permitidos) = 0 then 'SIN ACCESO A NINGUNA LÍNEA'
    else 'RESTRINGIDO A: ' || array_to_string(cos_permitidos, ', ')
  end as acceso
from profiles
order by rol, correo;

-- =====================================================================
-- NOTA sobre las importaciones: la política también aplica al escribir.
-- Un usuario restringido a ciertos C.O. no podrá cargar líneas de otros
-- C.O. (el archivo se rechazaría en esas filas). Como quien importa suele
-- ser un administrador o alguien con "ve todos los C.O.", en la práctica
-- no cambia nada -- pero si algún día un usuario restringido reporta
-- filas omitidas al importar, esta es la razón.
--
-- La corrección automática de fechas (corregir_fechas_orden_ns_proveedores)
-- quedó "security definer" en el script 2026-09-07c, justamente para que
-- siga procesando TODAS las líneas aunque quien dispare la importación
-- esté restringido. Corre ese script antes que este.
-- =====================================================================
