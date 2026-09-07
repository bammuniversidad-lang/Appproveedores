# Auditoría del código — NS Proveedores

Fecha: 2026-09-07. Revisión completa de las 12 pantallas, las funciones de base de datos y el esquema, buscando específicamente: **(a)** código que pueda dañar datos, **(b)** trabajo repetido o innecesario que haga lenta la aplicación.

Cada punto dice qué pasa, por qué importa y cómo se arregla.

## Estado

**Ya corregido** (ronda del 2026-09-07, scripts `2026-09-07c` y `2026-09-07d`):

| Punto | Qué se hizo |
|---|---|
| 1.1 | Desempate por `id` en el respaldo del cierre de mes. |
| 1.2 | Los dos cruces contra el histórico pasaron a `LATERAL ... limit 1`: una sola coincidencia por línea, siempre la misma. |
| 1.4 | Los "C.O. permitidos" ahora restringen de verdad, desde la base de datos. Incluye una migración que deja "ve todos los C.O." a los usuarios existentes para que nadie pierda acceso de golpe. |
| 2.1 | Creados los dos índices de expresión del cruce normalizado. |
| 2.5 | Eliminados los dos índices redundantes. |

**Pendiente:** todo lo demás de este documento. El orden sugerido está al final.

---

## 1. Riesgos para los datos

### 1.1 ALTO — El respaldo del Cierre de mes puede perder filas, justo antes del borrado irreversible

**Dónde:** `pages/configuracion/cierre-mes.js:93`

```js
supabase.from('v_ns_proveedores').select('*').order('co').order('nro_orden')
```

El respaldo se descarga por páginas de 1000 filas. Para que la paginación sea confiable, el orden tiene que ser **único**, y `(C.O. + Nro orden)` no lo es: una orden tiene muchas líneas con esos dos valores iguales. Cuando hay empates, la base de datos no garantiza que las devuelva en el mismo orden en cada página, así que **filas de la frontera entre páginas pueden salir dos veces o no salir ninguna**.

**Por qué importa:** este es exactamente el archivo que se descarga justo antes de borrar `pedidos_detalle` y `entradas_ea` sin vuelta atrás. Una pérdida silenciosa aquí es una pérdida definitiva, y el mensaje de "descargado con N registros" no la delataría.

**Arreglo:** agregar un desempate único al final del orden — `.order('co').order('nro_orden').order('id')`.

---

### 1.2 ALTO — La corrección automática de fechas puede cruzar contra dos órdenes distintas del histórico

**Dónde:** `supabase/schema.sql:484-488`

El comentario del código afirma que este cruce nunca puede traer más de una coincidencia porque `odc_historico` tiene `unique (nro_orden)`. **Eso no es exacto:** la restricción es sobre el valor *crudo*, pero el cruce se hace sobre el valor *normalizado* (`normalizar_nro_orden` quita letras y ceros a la izquierda).

Es decir, `"ODC-00189722"` y `"189722"` son dos filas perfectamente válidas y distintas para la restricción única, pero ambas normalizan a `"189722"`. Si el histórico llegó a tener las dos (por ejemplo, porque el ERP cambió el formato del archivo entre meses), esa línea entra **dos veces** en la tabla temporal, y entonces:

- el `UPDATE` aplica una de las dos fechas, elegida arbitrariamente por Postgres;
- el conteo "líneas evaluadas" que ves después de importar queda inflado.

**Arreglo:** garantizar una sola coincidencia por línea con `distinct on (d.id)`, o cambiar los dos `left join` por una búsqueda `LATERAL ... limit 1`. Es un cambio pequeño y sin contraindicaciones.

---

### 1.3 MEDIO — Volver a importar el mismo archivo de EA duplica todas sus filas, en silencio

**Dónde:** `pages/importar.js:134`, tabla `entradas_ea`

`entradas_ea` no tiene ninguna restricción de unicidad y la carga es un `insert` directo. Si por error se sube dos veces el mismo archivo, **todas sus filas quedan duplicadas** sin ningún aviso.

**Por qué importa:** no cambia la fecha de entrega calculada (se usa la más reciente), así que el error es invisible en pantalla — pero infla justamente la tabla que hace lenta la vista, y no hay forma de saber después cuáles filas sobran. Pedidos y ODC sí están protegidos (validan duplicados); EA es la única sin red.

**Arreglo:** antes de importar, revisar en `import_logs` si ya existe una carga de EA con ese mismo nombre de archivo y pedir confirmación explícita.

---

### 1.4 MEDIO — "C.O. permitidos" por usuario no restringe absolutamente nada

**Dónde:** `pages/configuracion/usuarios.js:205-221`, `pages/api/crear-usuario.js:67`, `supabase/schema.sql:1263`

Los campos `cos_permitidos` y `ve_todos_co` se capturan, se guardan y se muestran en la tabla de usuarios — pero **ninguna pantalla los lee**, y la política de seguridad de la base de datos permite leer `pedidos_detalle` a cualquier usuario autenticado.

**Por qué importa:** el administrador configura "este usuario solo ve el C.O. 001", la pantalla se lo confirma, y ese usuario ve y exporta todos los C.O. Es una garantía de confidencialidad falsa.

**Arreglo:** o se aplica de verdad (filtrar por `cos_permitidos` en las consultas y en las políticas de la base), o se quita el control de la pantalla para no prometer lo que no se cumple. Dejarlo como está es lo peor de las dos opciones.

---

### 1.5 MEDIO — Borrar un tiempo de entrega marca masivamente INCUMPLIDO, y cualquier usuario puede hacerlo

**Dónde:** `pages/configuracion/tiempo-entrega.js:154-160`

El borrado solo pide confirmación en el navegador. La política de la base permite borrar a cualquier usuario autenticado, y la restricción de módulo del menú no protege nada frente a una llamada directa.

**Por qué importa:** al borrar esa fila, todas las líneas de ese C.O. + proveedor pasan a evaluarse contra 0 días de entrega y se marcan como INCUMPLIDO en masa. El daño es desproporcionado frente a lo fácil que es provocarlo.

**Arreglo:** exigir rol administrador en la política de borrado de `tiempo_entrega` (igual que ya se hace con el borrado del cierre de mes, que sí está bien protegido).

---

### 1.6 MEDIO — Editar un usuario lo reactiva siempre, y "activo" nunca se comprueba

**Dónde:** `pages/api/actualizar-usuario.js:60`

`activo: activo !== undefined ? activo : true` — la pantalla nunca envía ese campo, así que **toda** edición de un usuario lo vuelve a poner en activo. Y el campo no se consulta en ningún lado (ni al ingresar, ni en las políticas de la base): un usuario desactivado a mano sigue entrando igual.

**Arreglo:** quitar `activo` del update (que conserve su valor) y, si la desactivación debe funcionar, comprobarla al ingresar.

---

### 1.7 MEDIO — Éxito parcial reportado como fallo total al editar usuarios

**Dónde:** `pages/api/actualizar-usuario.js:51-73` + `pages/configuracion/usuarios.js:124-128`

Si el perfil se guarda bien pero el cambio de contraseña falla, la respuesta es un error, el frontend no recarga la lista, y **la tabla sigue mostrando los datos viejos aunque en la base ya cambiaron**.

**Arreglo:** devolver éxito con advertencia cuando el perfil sí se guardó, y recargar mostrando el aviso.

---

## 2. Lentitud: trabajo de más o repetido

### 2.1 ALTO — Faltan dos índices en la corrección de fechas, que corre después de CADA importación

**Dónde:** `supabase/schema.sql:486-488`

El cruce contra el histórico usa `normalizar_nro_orden(...)` en ambos lados. No existe ningún índice sobre esa expresión, así que la base tiene que **calcular la función sobre todas las filas de las dos tablas, y hacerlo dos veces** (son dos cruces). Y esto no corre de vez en cuando: corre automáticamente después de importar Pedidos, después de importar EA y después de importar ODC — tres veces si subes los tres archivos.

**Arreglo:** dos índices de expresión (la función ya es `immutable`, así que se puede indexar):

```sql
create index if not exists idx_odc_historico_nro_orden_norm
  on odc_historico (normalizar_nro_orden(nro_orden));
create index if not exists idx_pedidos_detalle_docto_ref_norm
  on pedidos_detalle (normalizar_nro_orden(docto_referencia));
```

Es probablemente la mejora de rendimiento más grande que queda pendiente, y es de bajo riesgo.

---

### 2.2 ALTO — Asignar un motivo recarga TODA la tabla

**Dónde:** `pages/nivel-servicio.js:276`, `pages/nivel-servicio.js:297-298`, `pages/novedades.js:178`

Después de asignar un motivo a una línea (o a un grupo), se llama `cargarFilas()` — que vuelve a descargar **todas** las líneas del rango, página por página — y en algunos casos también `cargarTarjetas()`, que recalcula el agregado completo.

**Por qué importa:** el flujo normal de trabajo es asignar motivos uno tras otro. Asignar 30 motivos dispara 30 descargas completas de la tabla. Es la causa más probable de que la pantalla se sienta pesada mientras se trabaja, incluso ahora que las consultas están optimizadas.

**Arreglo:** después de un `update` exitoso, actualizar solo esa fila (o esas filas) en el estado local en vez de recargar todo. Reservar la recarga completa para el botón "Actualizar".

---

### 2.3 ALTO — La tabla dibuja todas las filas en la pantalla, sin excepción

**Dónde:** `pages/nivel-servicio.js` (el `filasOrdenadas.map(...)` del cuerpo de la tabla)

Con las 2.282 líneas de tu última prueba y 18 columnas visibles, el navegador construye unas **41.000 celdas**, y en cada una se ejecuta un formateo de número/moneda. Con un rango de varios meses esto se multiplica. El `maxHeight` del contenedor solo recorta lo que se ve; el navegador igual construye todo.

**Arreglo (por orden de esfuerzo):** ocultar por defecto las columnas que casi no se usan; guardar los formateadores de número una sola vez en vez de crearlos por celda; y si hace falta más, paginar la vista (mostrar 200 filas a la vez) manteniendo la descarga completa solo para el Excel.

---

### 2.4 MEDIO — Dos consultas pesadas por cada cambio de filtro

**Dónde:** `pages/nivel-servicio.js:194-195`, `220-221`

Cada cambio de fecha, C.O. o casilla dispara `cargarFilas()` **y** `cargarTarjetas()`: dos recorridos completos del mismo conjunto de datos, uno para traer las filas y otro para contarlas.

**Arreglo:** cuando no hay casillas de filtro activas, las tarjetas se pueden calcular en el navegador con las filas ya descargadas, sin una segunda consulta. (Con casillas activas sí se necesita la consulta aparte, porque las tarjetas cuentan sobre el rango completo.)

---

### 2.5 MEDIO — Dos índices redundantes que solo cuestan tiempo en cada importación

**Dónde:** `supabase/schema.sql:105` y `supabase/schema.sql:137`

- `idx_odc_historico_nro_orden` duplica exactamente el índice que ya crea la restricción `unique (nro_orden)`.
- `idx_entradas_ea_yave` quedó cubierto por el índice compuesto `(yave, fecha desc)` que agregamos después.

**Por qué importa:** un índice de más no acelera nada, pero **cada fila que se inserta tiene que actualizarlo**. Y `entradas_ea` recibe miles de filas en cada carga de EA. Es trabajo puro de más.

**Arreglo:** `drop index if exists idx_odc_historico_nro_orden;` y `drop index if exists idx_entradas_ea_yave;`

---

### 2.6 MEDIO — El panel de "proveedores sin tiempo de entrega" recorre toda la base, y se recalcula tras cada alta

**Dónde:** `supabase/schema.sql:1153` (`get_co_proveedor_sin_tiempo_entrega`) y `pages/configuracion/tiempo-entrega.js:121-122, 159, 198-199`

Esa función agrega **toda** `v_ns_proveedores` sin ningún filtro de fechas — es la consulta más pesada de la aplicación. Y se vuelve a llamar después de crear, borrar o importar en el maestro. Registrar diez proveedores desde el panel de faltantes dispara diez recorridos completos.

**Arreglo:** al registrar un proveedor, quitarlo de la lista en pantalla en vez de volver a consultar; dejar la recarga solo para la importación masiva. Opcionalmente, limitar la función a los últimos N meses.

---

### 2.7 MEDIO — El Dashboard puede mostrar datos que no corresponden al filtro

**Dónde:** `pages/dashboard.js:101-118`

Es el mismo problema que acabamos de corregir en Nivel de servicio: no hay protección contra respuestas que llegan fuera de orden. Si haces clic en una fila para filtrar y enseguida quitas el filtro, la respuesta lenta puede llegar después y dejar la pantalla mostrando datos filtrados mientras el chip dice que no hay filtro — y el Excel que exportes en ese momento sale con esos datos.

**Arreglo:** el mismo control de "descartar respuestas viejas" que ya pusimos en Nivel de servicio.

---

### 2.8 MEDIO — El perfil del usuario se consulta dos veces por carga, y otra vez cada vez que se renueva la sesión

**Dónde:** `lib/AuthContext.js:12-44`

Se pide la sesión manualmente y además se escucha el evento de sesión, que entrega la misma sesión inicial como un objeto distinto. Resultado: **dos consultas idénticas al perfil en cada carga de página**, y una más cada vez que se renueva el token, sin que nada haya cambiado.

**Arreglo:** quitar la consulta manual de sesión (el evento ya la entrega) y depender del identificador del usuario, no del objeto de sesión completo.

---

### 2.9 MEDIO — El maestro de tiempo de entrega se corta en 1000 filas

**Dónde:** `pages/configuracion/tiempo-entrega.js:63-73`

Es el mismo tope de PostgREST que ya arreglamos en el filtro de C.O., pero esta pantalla quedó sin corregir. El buscador filtra sobre lo ya descargado, así que **un proveedor más allá de la fila 1000 parece no existir**: intentas crearlo y choca contra la restricción de duplicados. El contador de registros también queda corto.

**Arreglo:** paginar la carga igual que en las otras pantallas.

---

### 2.10 MEDIO — Aplicar una fecha a la selección dispara una petición por línea, todas a la vez

**Dónde:** `pages/nivel-servicio.js:312-325`

`Promise.all` sobre todas las líneas seleccionadas: si seleccionas 500 líneas, se lanzan **500 peticiones simultáneas**. Tu panel de Supabase mostraba un pico de 11 de 60 conexiones; esto lo puede llevar al límite y hacer que algunas fallen.

**Arreglo:** procesar en lotes (por ejemplo de 25 en 25), o mejor, una sola función en la base que reciba la lista de identificadores y la fecha y haga todo en un solo `UPDATE`.

---

### 2.11 BAJO — Los campos de fecha lanzan consultas mientras se escribe

**Dónde:** `pages/dashboard.js:206, 210` y equivalentes

Escribir el año "2026" a mano genera fechas intermedias (`0002-…`, `0020-…`, `0202-…`) y una consulta pesada por cada una, todas compitiendo entre sí.

**Arreglo:** esperar ~400 ms antes de consultar, o consultar al salir del campo.

---

## 3. Código muerto y detalles menores

| Dónde | Qué |
|---|---|
| `components/TablaHeader.js:43` | `useOrdenTabla(filas, ordenInicial)` — los dos parámetros no se usan nunca, y no es realmente un hook. |
| `lib/exportarDashboard.js:140-145` | El enlace de descarga se libera en el mismo instante en que se hace clic. En Chrome suele funcionar; en Firefox y Safari es causa clásica de descargas que no arrancan, y el error no se detecta. |
| `lib/exportarDashboard.js:25` | El rango de la hoja se arma con `String.fromCharCode`, que produce una referencia inválida a partir de 27 columnas. Hoy el máximo es 10. |
| `lib/exportarDashboard.js:26` | `return hoja` que nadie usa. |
| `pages/dashboard.js:96-99` | Si la consulta de C.O. falla, el error se ignora y el filtro queda vacío sin ningún aviso — el usuario concluye que no hay C.O. |
| `pages/configuracion/motivos.js:118-128` | Si un motivo del archivo da problema, falla la creación de todos los nuevos de golpe. La pantalla de tiempo de entrega ya resuelve este caso reintentando fila por fila; aquí falta. |
| `pages/configuracion/motivos.js:27-57` | Los nombres se guardan sin quitar espacios, y el nombre es único distinguiendo mayúsculas: se pueden crear `"BAJO PEDIDO "` y `"Bajo pedido"` como dos motivos distintos. |
| `pages/configuracion/tiempo-entrega.js:143-152` | Al editar no se valida que C.O. y Proveedor no queden vacíos (al crear sí), y no se refresca el panel de faltantes. |
| `pages/_app.js:7-14` | El tema arranca claro y después lee la preferencia: parpadeo blanco en cada carga completa si usas fondo negro. |
| `components/Layout.js:72-93` | La pantalla se dibuja (y lanza sus consultas) antes de confirmar el permiso; y si falla la carga del perfil, el permiso nunca se evalúa y la página queda visible. |

---

## 4. Revisado y está bien — no tocar

- **Los endpoints de usuarios están correctamente protegidos.** Resuelven quién llama con su propio token y verifican el rol contra la base antes de usar la llave de administrador. El rol no se toma de lo que envía el navegador. Es el patrón correcto.
- **El borrado del cierre de mes sí tiene respaldo en la base.** La función verifica rol administrador y falla si no lo es. El "escribe ELIMINAR" es una capa extra, no la única barrera.
- **Manejo de llaves correcto.** La llave de servicio solo vive en el servidor y `.env.local` está fuera del control de versiones.
- **La corrección automática de fechas es idempotente:** correrla dos veces no vuelve a cambiar lo ya corregido, y conserva siempre la fecha original.
- **La importación de Pedidos y de Tiempo de entrega** trabaja en lotes y reintenta fila por fila cuando un lote falla — es el patrón robusto.
- **Las políticas de seguridad de la base** evitan correctamente la recursión infinita usando una función con permisos elevados, y evalúan la identidad una vez por consulta en vez de una por fila.
- **Las optimizaciones recientes** (búsqueda LATERAL de la fecha de entrega, índice de expresión para el filtro de fechas, `necesita_revision` calculado en vivo) están bien planteadas y son la razón de la mejora que ya notaste.

---

## 5. Orden sugerido para atacarlo

1. **1.1** (respaldo del cierre de mes) — una línea, y es lo único cuyo fallo es irreversible.
2. **2.1** y **2.5** (índices) — puro rendimiento, sin cambiar comportamiento, riesgo casi nulo.
3. **2.2** (recargar todo al asignar motivo) — es lo que más se siente en el uso diario.
4. **1.2** (doble coincidencia en el histórico) y **1.3** (EA duplicada) — protección de datos.
5. **1.4** (C.O. permitidos) — decidir: implementarlo o quitarlo.
6. El resto, por conveniencia.
