-- =====================================================================
-- ARREGLA: el filtro de C.O. en Nivel de servicio y Dashboard solo
-- mostraba "001" y "002" en vez de todos los C.O. que ya tienen líneas
-- cargadas (003, 004, 005, 009, etc.).
--
-- CAUSA: esas pantallas (y también Configuración > Usuarios) leían la
-- lista de C.O. con "select co from pedidos_detalle" directo desde el
-- frontend. PostgREST (la API de Supabase) devuelve máximo 1000 filas
-- por consulta si no se pide explícitamente más -- y como pedidos_detalle
-- ya tiene más de 1000 filas, esa consulta se quedaba solo con los C.O.
-- que aparecían dentro de esas primeras 1000 filas. El resto de C.O. SÍ
-- existe en la base, simplemente sus filas quedaban fuera de esa página.
--
-- SOLUCIÓN: una función que hace el DISTINCT directo en la base de datos
-- (aprovecha el índice que ya existe en la columna "co", así que es
-- rápida) y siempre trae la lista completa, sin importar cuántas filas
-- tenga pedidos_detalle.
--
-- CÓMO EJECUTAR ESTE ARCHIVO:
--   1. Entra al Dashboard de Supabase: https://supabase.com/dashboard
--   2. Abre el proyecto "ns-proveedores".
--   3. Ve a "SQL Editor" > "New query".
--   4. Copia y pega TODO el contenido de este archivo.
--   5. Presiona "Run" (o Ctrl+Enter). Debe decir "Success".
--   6. Vuelve a Nivel de servicio o Dashboard y presiona "Actualizar" (o
--      recarga la página) para ver el filtro de C.O. ya completo.
-- =====================================================================
create or replace function get_cos_disponibles()
returns table(co text)
language sql
stable
set search_path = public
as $$
  select distinct pedidos_detalle.co
  from pedidos_detalle
  where pedidos_detalle.co is not null and pedidos_detalle.co <> ''
  order by pedidos_detalle.co;
$$;

grant execute on function get_cos_disponibles() to anon, authenticated;
