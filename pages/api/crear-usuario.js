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

  // Cliente "de nombre del usuario" para validar quién hace la petición
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
    return res.status(403).json({ error: 'Solo un administrador puede crear usuarios' });
  }

  const {
    nombre_completo,
    correo,
    celular,
    rol,
    cos_permitidos,
    ve_todos_co,
    modulos_permitidos,
    password,
  } = req.body;

  if (!nombre_completo || !correo || !password || !rol) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const { data: nuevoUsuario, error: errCrear } = await supabaseAdmin.auth.admin.createUser({
    email: correo,
    password,
    email_confirm: true,
  });

  if (errCrear) {
    return res.status(400).json({ error: `No se pudo crear el usuario: ${errCrear.message}` });
  }

  const { error: errPerfilNuevo } = await supabaseAdmin.from('profiles').insert({
    id: nuevoUsuario.user.id,
    nombre_completo,
    correo,
    celular: celular || null,
    rol,
    cos_permitidos: cos_permitidos || [],
    ve_todos_co: !!ve_todos_co,
    modulos_permitidos: modulos_permitidos || [],
  });

  if (errPerfilNuevo) {
    // revertir creación de auth si falló el perfil
    await supabaseAdmin.auth.admin.deleteUser(nuevoUsuario.user.id);
    return res.status(400).json({ error: `No se pudo crear el perfil: ${errPerfilNuevo.message}` });
  }

  return res.status(200).json({ ok: true, id: nuevoUsuario.user.id });
}
