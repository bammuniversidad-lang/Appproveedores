import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Falta token de autenticación' });
  }

  const supabaseComoUsuario = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData, error: errUser } = await supabaseComoUsuario.auth.getUser();
  if (errUser || !userData?.user) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }

  const { data: perfilSolicitante, error: errPerfil } = await supabaseComoUsuario
    .from('profiles')
    .select('rol')
    .eq('id', userData.user.id)
    .single();

  if (errPerfil || perfilSolicitante?.rol !== 'administrador') {
    return res.status(403).json({ error: 'Solo un administrador puede modificar usuarios' });
  }

  const {
    id,
    nombre_completo,
    celular,
    rol,
    cos_permitidos,
    ve_todos_co,
    modulos_permitidos,
    password, // opcional: si viene, se cambia la contraseña
    activo,
  } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Falta el id del usuario a modificar' });
  }

  const { error: errPerfilUpd } = await supabaseAdmin
    .from('profiles')
    .update({
      nombre_completo,
      celular: celular || null,
      rol,
      cos_permitidos: cos_permitidos || [],
      ve_todos_co: !!ve_todos_co,
      modulos_permitidos: modulos_permitidos || [],
      activo: activo !== undefined ? activo : true,
    })
    .eq('id', id);

  if (errPerfilUpd) {
    return res.status(400).json({ error: `No se pudo actualizar el perfil: ${errPerfilUpd.message}` });
  }

  if (password) {
    const { error: errPassword } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
    if (errPassword) {
      return res.status(400).json({ error: `Perfil actualizado, pero no se pudo cambiar la contraseña: ${errPassword.message}` });
    }
  }

  return res.status(200).json({ ok: true });
}
