# NS Proveedores

Aplicación web para nivel de servicio de proveedores, construida con
Next.js y Supabase (Postgres + Auth) — mismo diseño (login, franja
superior, menú lateral, tarjetas) que tu aplicación de Compras, pero en
un **proyecto de Supabase independiente**, con sus propios usuarios.

Reemplaza el archivo Excel `NS_PROVEEDORES1.xlsb` (con macros VBA) que
usas hoy: importas las mismas 4 bases que ya descargas de tu sistema
(Pedidos/ODC x Ítem, EA, histórico de ODC, tiempo de entrega) y la
aplicación calcula el nivel de servicio en el servidor, en vez de
fórmulas de Excel.

## El problema que resuelve esta primera entrega

En tu Excel, cuando **Fecha orden** queda igual a la **fecha real de
entrada** (síntoma de que la orden se modificó y arrastró la fecha
equivocada), la hoja "DETALLE" trae un número de orden en el que te
apoyas para ir a la hoja **ODC** (tu histórico) y buscar la fecha real.
La fórmula que hace esa búsqueda automática (columna "Fecha ODC" de la
hoja "BD Calculos") está incompleta —
`=XLOOKUP(ODC!D:D,ODC!C:C)` no trae el valor a buscar — así que hoy no
funciona.

Esta aplicación reemplaza esa fórmula por una función en el servidor
(`corregir_fechas_orden_ns_proveedores`, en `supabase/schema.sql`) que:

1. Busca las líneas donde **Fecha orden = Fecha de entrega real**.
2. Busca el **Nro orden** de esas líneas en el histórico de ODC.
3. Si encuentra una fecha real distinta, **corrige "Fecha orden"
   automáticamente**, guardando la fecha original en
   **"Fecha orden original"** (para que quede trazable qué cambió).
4. Si no encuentra la orden en el histórico, o la fecha del histórico
   también coincide con la de entrada, **marca la línea como
   "necesita_revision"** para que la revises y la corrijas tú mismo
   desde la pantalla de **Nivel de servicio**.

Esto corre automáticamente cada vez que importas Pedidos, EA, o el
histórico de ODC, y también tiene un botón manual ("Corregir fechas de
orden") en Nivel de servicio.

Probé esta función con tus datos reales (`NS_PROVEEDORES1.xlsb`, ~7.700
líneas de "DETALLE" cargadas en una base de prueba local): identificó
correctamente 143 líneas con fecha de orden = fecha de entrada, y para
las que sí tenían una fecha distinta en el histórico de ODC, la
corrigió y dejó el rastro de la fecha original (lo verifiqué también con
un caso de prueba controlado). Ninguna de esas 143 líneas específicas de
tu archivo tenía una fecha distinta en el histórico — es decir, quedaron
correctamente marcadas para que las revises tú, en vez de "inventar" una
corrección que no existía en los datos.

## Bug que arreglé: el menú no mostraba nada

Si en algún momento entraste y el menú lateral no mostraba ni "Importar"
ni "Configuración" (aunque tu usuario fuera administrador), la causa era
un bug clásico de Supabase: la política de seguridad (RLS) de la tabla
`profiles` se consultaba **a sí misma** para saber si eras administrador,
y Postgres detecta eso como "recursión infinita" y bloquea la consulta —
por eso tu perfil nunca cargaba en el navegador, aunque la fila en la
base de datos estuviera perfectamente bien (por eso no se veía revisando
la base directamente, que sí tiene permisos para saltarse esa política).

Ya está corregido: moví el chequeo de "es administrador" a una función
en el servidor (`es_administrador()`, en `supabase/schema.sql`) que no
vuelve a pasar por esa misma política. Si ya tenías la app abierta,
solo tienes que recargarla (Ctrl+Shift+R) o volver a iniciar sesión.

## Otros bugs que arreglé (con datos reales que cargaste)

- **C.O. vacío en Nivel de servicio**: tu archivo BASE real trae esa
  columna como **"C.O. Docto."** (no "CO" a secas, como asumí al
  principio) — ya se reconocen las dos variantes.
- **Decimales que se perdían en Valor pendiente** (ej. mostraba
  `2257748640` en vez de `2.257.748,64`): el lector de números asumía
  que "3 dígitos después de una coma o punto" siempre era separador de
  miles, así que un precio con 3 decimales (frecuente en costos
  unitarios) se leía mal y quedaba 1000 veces más grande. Ya se corrigió
  — el separador decimal ahora es siempre el ÚLTIMO punto/coma del
  texto, sin importar cuántos dígitos tenga detrás.
- **Llave de EA**: confirmaste que la columna de C.O. en EA se llama
  igual, **"C.O. Docto."**, y que la llave real para saber "cuál es el
  mismo pedido" es C.O. + Nro orden (ODC) + Referencia + Bodega (no solo
  Nro orden + Referencia) — ya está así en Pedidos y en EA.
- Agregué a la tabla de Nivel de servicio las columnas que faltaban:
  **Cant. ordenada, Cant. entrada inv., Docto. referencia** — y le puse
  formato de moneda/miles (antes se veían como números sin formatear).

**Importante**: como estos bugs ya habían afectado los datos de prueba
que habías cargado (los ~4.849 pedidos tenían C.O. vacío y precios
inflados), **borré esa data de prueba** de Pedidos y Entradas/EA para
que puedas volver a cargar limpio con estos arreglos. Tu maestro de
Tiempo de entrega (1.541 proveedores) NO se tocó.

## Bug arreglado: "Corregir fechas de orden" no corregía nada (0 de 397)

Encontraste la causa exacta: el cruce contra el histórico de ODC comparaba
**"Nro orden" contra "Nro orden"** — pero "Nro orden" en Pedidos YA ES la
orden nueva/modificada (por eso "Fecha orden" quedó igual a la fecha de
entrada). La orden ORIGINAL está en la columna **"Docto referencia"**
(ej. `189722`), que hay que cruzar contra "Nro orden" del histórico de
ODC (ej. `ODC-00189722`) quitándole el prefijo "ODC-" y los ceros a la
izquierda a ambos lados.

Arreglado en `corregir_fechas_orden_ns_proveedores()`: ahora cruza **C.O.
+ Docto referencia (normalizado)** contra **C.O. + Nro orden del
histórico (normalizado)**. Lo probé con un caso controlado igual al que
describiste (`ODC-00190090` / Docto referencia `189722` → histórico
`ODC-00189722`) y corrige bien, dejando el rastro de la fecha original.

**Nota**: además de este bug, tu histórico de ODC está vacío por ahora
(0 filas) — sin datos ahí, la corrección automática no tiene nada contra
qué comparar. Impórtalo desde **Importar > Histórico de ODC** para que
la corrección automática empiece a funcionar de verdad.

## Bug arreglado: el Excel de Nivel de servicio no descargaba completo (y no cuadraba con el Dashboard)

Causa: la consulta de Nivel de servicio (`cargarFilas()`) pedía todas las
filas con un solo `.select('*')`, y Supabase/PostgREST **limita cada
consulta a 1.000 filas por defecto** si no se pagina explícitamente. Si tu
rango de fechas tenía más de 1.000 líneas, la tabla en pantalla (y por lo
tanto el Excel que descargabas, que se arma con lo que hay en pantalla)
se cortaba ahí — mientras que el Dashboard usa una función SQL que sí
recorre TODAS las filas de la base de datos, así que los totales no
cuadraban entre las dos pantallas.

Arreglado: `cargarFilas()` ahora pagina en bloques de 1.000 hasta traer
todas las filas que cumplan los filtros. Debajo de la barra de filtros
verás cuántas líneas se cargaron en total, para que puedas verificar el
número tú mismo. El Excel ahora exporta exactamente lo que ves en
pantalla (respetando también los filtros de columna).

**Nota**: si activas "Solo por revisar", "Solo incumplidos" o un C.O.
específico en Nivel de servicio, los totales van a ser distintos a los
del Dashboard a propósito (el Dashboard no tiene esos filtros) — para
comparar cifras, usa el mismo rango de fechas en ambas pantallas y deja
esos filtros apagados.

## Bug arreglado: "Órdenes emitidas" del Dashboard no coincidía con las órdenes distintas del Excel (492 vs. 486)

Encontré la causa exacta con tus datos: la tarjeta "Órdenes de compra"
contaba las órdenes agrupando por **Nro orden + C.O. + Proveedor**. La
mayoría de las veces eso da lo mismo que contar Nro orden distintos,
pero hay ODC reales que tienen líneas de **más de un proveedor** bajo el
mismo número (ej. `ODC-00017675` con 3 proveedores distintos, o casos
como "8 - TEAM FOODS" / "585 - TEAM FOODS PANADERIA" que parecen el
mismo proveedor con dos códigos distintos en el maestro). Eso inflaba el
conteo de 486 (Nro orden realmente distintos, lo que se ve al contar en
el Excel) a 492.

Arreglado: la tarjeta "Órdenes de compra"/"Tiempo de entrega"/"OTIF" del
Dashboard ahora cuenta **a nivel de documento** (Nro orden + C.O., sin
importar el proveedor) — coincide con lo que cuentas en el Excel. El
cuadro "Clasificación de proveedores (ABCD)" sigue separando por
proveedor puertas adentro (ahí sí tiene que separar, para calcular el
OTIF/on time/in full DE CADA proveedor), así que ese cuadro no cambió.

**Nota**: si "8 - TEAM FOODS" y "585 - TEAM FOODS PANADERIA" son
realmente el mismo proveedor con dos códigos, vale la pena unificarlos
en tu maestro de proveedores del ERP — mientras tengan códigos
distintos, el Dashboard los va a seguir mostrando como dos proveedores
separados en el cuadro de clasificación ABCD.

## Nuevo: tarjetas de Valor y de Líneas en el Dashboard (y corrección de la tarjeta "Órdenes de compra")

- La tarjeta "Órdenes de compra" mostraba el indicador de **on time**
  (a tiempo/emitidas) debajo de "Sin pendientes (in full)" y "Completas
  (OTIF)" — no calzaba con lo que la tarjeta lista. Ahora muestra el
  indicador correcto: **in full** (sin pendientes/emitidas).
- **Tarjeta "Valor" (nueva)**, con la misma forma que "Cantidades":
  Valor solicitado, Valor pendiente, Valor entregado (= solicitado −
  pendiente), e indicador = entregado/solicitado (que es el mismo
  número que NS Valor).
- **Tarjeta "Líneas" (nueva)**, también con la misma forma: Líneas
  solicitadas, Líneas con pendiente, Líneas entregadas (las que ya
  tienen `Cant. pendiente inv. = 0`), e indicador = entregadas/
  solicitadas.
- Ambas tarjetas nuevas también se agregaron a la hoja "Resumen" del
  Excel exportable y a la diapositiva de indicadores del PowerPoint.

## Nuevo (última ronda): días hábiles sin festivos colombianos + días de entrega sugeridos

Pediste dos ajustes sobre el cálculo del tiempo de entrega:

1. *"No se debe tener presente los días sábados y domingos, además de los días festivos
   en Colombia, toda vez que no es un día hábil, esto ayudará a saber realmente si es
   incumplimiento o no."* El sistema ya excluía sábados y domingos al calcular la
   diferencia entre la fecha de la orden y la fecha real de entrega, pero no excluía los
   festivos colombianos. Ahora sí: se agregó una tabla `dias_festivos_colombia` con los
   18 festivos oficiales de cada año (calculados con la Ley Emiliani, que traslada
   varios festivos al lunes siguiente) para 2024 a 2028, y la función que calcula "días
   hábiles" ahora también excluye esas fechas. Esto puede mover algunas líneas de
   "incumplido" a "cumplido" si el festivo hacía parecer más lenta la entrega de lo que
   realmente fue.
2. *"En el tiempo de entrega, los proveedores que se identifican como faltante, si hay
   fecha de orden y fecha real de entrada con los datos existentes, colocar como
   sugerido el promedio siempre y cuando no sea 0 o 1, pero que la persona al revisar en
   caso de que no sea real lo pueda modificar."* En el panel "Proveedores/C.O. sin
   tiempo de entrega definido" (Configuración > Tiempo de entrega), ahora hay una
   columna **"Días sugerido"**: el promedio de días hábiles reales entre la fecha de la
   orden y la fecha de entrega real de las líneas que ya existen para ese proveedor
   (excluyendo fines de semana y festivos, como en el punto 1). Si el promedio es 0 o 1
   día, no se sugiere nada (esos valores casi siempre son datos atípicos, no un tiempo
   de entrega real). Al presionar "Agregar", el formulario se precarga con ese valor
   sugerido en "Días de entrega", pero lo puedes revisar y cambiar libremente antes de
   guardar si no te parece representativo.

## Nuevo (ronda anterior): Novedades rediseñada — por documento, ordenable, filtro "sin motivo"

Pediste: *"en la hoja de novedades por incumplimiento aparece el detalle por c.o,
proveedor, líneas, sin motivo y valor pendiente, pero debería quedar c.o, proveedor, nro
documento, líneas incumplidas, valor solicitado no el pendiente y la fecha de la orden y
fecha real de la entrada, además que si le doy clic a los títulos se organicen, que haya
un botón para que muestre las líneas sin motivo"*.

En **Novedades**, cada fila ahora es una **orden de compra específica** (C.O. +
Proveedor + Nro documento), no un proveedor completo como antes — así "Fecha de la
orden" y "Fecha entrega real" tienen sentido como columnas de la tabla principal:

- Columnas: C.O., Proveedor, **Nro documento**, Líneas incumplidas, **Valor solicitado**
  (antes "Valor pendiente" — ahora suma el valor completo de la orden, no solo la
  porción pendiente), **Fecha de la orden**, **Fecha entrega real**.
- **Clic en los títulos de columna para ordenar** (igual que en Nivel de servicio y el
  Dashboard).
- Nuevo botón **"Ver solo sin motivo"**: filtra la tabla para mostrar solo las órdenes
  que todavía tienen alguna línea sin motivo asignado.
- El detalle expandible ("Ver líneas") ahora también muestra el valor bruto de cada
  línea, junto al valor pendiente.

## Nuevo (ronda -2): corrección masiva de fecha de orden y auditoría de proveedores sin tiempo de entrega

Pediste dos cosas sobre **Nivel de servicio** y **Tiempo de entrega**:

1. *"para corregir fechas yo lo hago por nro orden pero aquí toca línea a línea"* — ya se
   podía filtrar por Nro orden y seleccionar todas las líneas filtradas con la casilla del
   encabezado, pero la corrección de "Fecha orden" solo existía línea por línea. Ahora, en
   **Nivel de servicio**, cuando tienes filas seleccionadas aparece (junto a los selectores
   de motivo) un campo de fecha + botón **"Aplicar fecha de orden a selección"**: filtra por
   Nro orden, selecciona todo con la casilla del encabezado, elige la fecha y aplícala a
   todas las líneas de una sola vez. Cada línea conserva su propia "Fecha orden original" (no
   se pisa si ya tenía una), igual que la corrección manual de siempre.

2. *"cómo podemos identificar que proveedores y en que C.O. no está definido el tiempo de
   entrega, para tener una buena métrica del incumplimiento"* — cuando una combinación C.O. +
   Proveedor no tiene registro en el maestro de **Tiempo de entrega**, el sistema asume 0
   días de entrega esperados, así que esas líneas casi siempre terminan marcadas como
   incumplidas aunque nunca se evaluó bien su tiempo de entrega real. Ahora, la pantalla
   **Configuración > Tiempo de entrega** tiene un panel nuevo arriba, **"Proveedores/C.O. sin
   tiempo de entrega definido"**, que lista esas combinaciones ordenadas por líneas
   incumplidas y valor en riesgo, con un botón "Agregar" que precarga el formulario para
   registrarlas rápido. Con tus datos reales encontramos **33 combinaciones** sin tiempo de
   entrega definido — algunas con más del 90% de sus líneas marcadas como incumplidas
   (ejemplo: C.O. 003 / PRODUCTOS RAMO SAS, 73 de 78 líneas). Registrarlas con sus días de
   entrega reales debería corregir bastante el indicador de incumplimiento.

## Nuevo (ronda -3): Dashboard reorganizado — cuadros simétricos

Reportaste que el Dashboard "no se ve simétrico". La causa: la rejilla de cuadros usaba
un ancho automático (`auto-fit`) que acomoda tantos cuadros como quepan por fila según
un mínimo de 560px — así que el ancho real de cada cuadro dependía de cuántos cupieran
al lado, y cuadros con la misma cantidad de columnas de datos (por ejemplo "Proveedores
por clasificación" y "Referencias por clasificación", ambos con 10 columnas) terminaban
con anchos muy distintos entre sí, mientras cuadros angostos y anchos se mezclaban sin
ningún criterio.

Arreglo: ahora la rejilla es de **dos columnas fijas**. Los cuadros angostos (pocas
columnas de datos: "Valor por proveedor", "Descripción ítem", los dos de "Motivos") se
agrupan de a 2 por fila, siempre del mismo ancho entre sí. Los cuadros anchos (muchas
columnas: "Clasificación de proveedores", "Proveedores por clasificación", "Referencias
por clasificación", "Detalle por C.O.") ocupan la fila completa, así tienen más espacio
antes de necesitar scroll horizontal. El gráfico de barras sigue a ancho completo al
final, como antes.

## Nuevo (ronda -4): dos motivos independientes (faltante vs. incumplimiento en tiempo) y sus tablas en el Dashboard

Revisando el PowerPoint exportado, detectamos que "Motivos de incumplimiento" mezclaba
dos novedades distintas de tu proceso:

- La columna **"Observaciones"** (COMPLETA/INCOMPLETA) — si quedó **cantidad pendiente**
  del ítem.
- La columna **"Cumplimiento"** (CUMPLIDO/INCUMPLIDO) — si se incumplió el **tiempo de
  entrega**.

Antes, solo existía UN campo de motivo (`motivo_id`), y solo se podía asignar desde
Novedades a las líneas incumplidas en tiempo — las líneas con cantidad pendiente pero
SIN incumplimiento de tiempo (o viceversa) no tenían dónde registrar su motivo. Con tus
datos reales: 586 líneas con cantidad pendiente, y de esas, solo 2 tenían algún motivo
asignado (por coincidencia, porque también estaban incumplidas en tiempo).

- **Se eliminó** la tabla "Motivos por ítem — valor pendiente y participación" del
  Dashboard, tal como pediste.
- **Nueva columna en la base de datos**: `motivo_faltante_id` (independiente de
  `motivo_id`), con su propio responsable y fecha de asignación.
- **Nuevo lugar para asignarlo**: en **Nivel de servicio** ahora hay dos columnas de
  motivo por línea — "Motivo (incumplimiento)" (la de siempre) y "Motivo (faltante)"
  (nueva) — cada una con su propio selector por fila y su propio botón de "Aplicar a
  selección" para varias líneas a la vez. Hay un nuevo filtro "Solo con cantidad
  pendiente (faltante)" para encontrar rápido las líneas que faltan por clasificar y
  llegar al 100% de cobertura del indicador.
- **Dos tablas nuevas en el Dashboard** (reemplazan a "Motivos de incumplimiento — valor
  pendiente"):
  - **"Motivos por faltante de ítem — valor pendiente y participación"**: agrupa por el
    motivo del faltante (cantidad pendiente), valorado por Valor pendiente.
  - **"Motivos por incumplimiento en tiempo de entrega — valor de la orden y
    participación"**: agrupa por el motivo del incumplimiento en tiempo, pero valorado
    por el **valor de la orden de compra completa** (no solo la porción pendiente),
    como pediste.
- Ambas tablas se agregaron también al Excel exportable (hojas "Motivos por faltante" y
  "Motivos por incumplimiento") y al PowerPoint (con la corrección de altura de fila de
  la sección anterior, así que no se ven distorsionadas).

## Nuevo (ronda -5): proveedor único en Pareto, dos cuadros por clasificación, filtro C.O. y PowerPoint sin distorsión

- **Bug arreglado — el mismo proveedor aparecía varias veces en
  "Clasificación de proveedores (Pareto ABCD)"**: el cuadro agrupaba por
  **C.O. + Proveedor**, así que un proveedor que factura bajo varios C.O.
  salía una fila por cada C.O., y como la clasificación A/B/C/D se
  calcula sobre el ranking global, podía mostrar el **mismo proveedor con
  letras distintas** (ej. "A" en un C.O. y "B" en otro). Verificado con
  tus datos reales: había 126 proveedores distintos y el cuadro mostraba
  más de 126 filas antes de este arreglo. Ahora el cuadro agrupa **solo
  por Proveedor** (sumando todos sus C.O.) — un proveedor, una fila, una
  sola clasificación. Confirmé con una consulta directa que ahora hay
  exactamente 126 filas para 126 proveedores distintos.
- **Nuevo cuadro — "Proveedores por clasificación (resumen A/B/C/D)"**:
  una fila por letra (A, B, C, D) con # de proveedores, valor solicitado,
  valor pendiente, NS Valor, NS Cantidad, NS Líneas, on time, in full y
  OTIF de ese grupo completo (los indicadores se calculan sumando
  órdenes/líneas de todos los proveedores del grupo, no promediando
  porcentajes, para que el número sea correcto).
- **Nuevo cuadro — "Referencias por clasificación (resumen A/B/C/D)"**:
  mismo formato que el anterior pero clasificando por **Referencia** en
  vez de por Proveedor. Aquí on time/in full/OTIF se calculan **por
  línea** (no por orden completa, porque una referencia no es dueña de
  toda una orden) — lo aclaro con una nota en pantalla, en el Excel y en
  el PowerPoint para que no se confunda con la definición de proveedor.
- **Nuevo filtro de C.O.** en el Dashboard, junto a los filtros de fecha
  — funciona igual que en Nivel de servicio (selecciona un C.O. o "Todos"
  y todos los cuadros/tarjetas/gráfico se recalculan).
- **Nuevo cuadro — "Detalle por C.O."**: una fila por C.O. con cantidad
  solicitada, cantidad pendiente, valor solicitado, valor pendiente, NS
  Valor, NS Cantidad, on time, in full y OTIF — y es "clicable" como los
  demás cuadros (haz clic en una fila para filtrar el resto del Dashboard
  por ese C.O., igual que con proveedor/ítem/motivo).
- **Bug arreglado — tablas del PowerPoint se veían distorsionadas**:
  revisé el PowerPoint que exportaste (`dashboard_ns_proveedores_...pptx`)
  con una herramienta que lee la altura real de cada fila de tabla en el
  archivo, y encontré que **todas las filas tenían altura 0** — la
  librería que genera el PowerPoint (pptxgenjs) deja la altura en 0 por
  diseño ("que PowerPoint la autoajuste"), pero combinado con el tamaño
  fijo y pequeño del marco de la tabla, algunos programas no la
  autoajustan bien y el texto queda apretado o superpuesto. Ahora cada
  tabla se genera con una **altura de fila explícita**, calculada según
  cuántas filas tiene (entre 0.22" y 0.5"), y también reduje de 15 a 10
  las filas de detalle por diapositiva (con nota de "descarga el Excel
  para ver el resto") para que ninguna tabla quede demasiado apretada.
  Generé un PowerPoint de prueba con los cuadros nuevos y confirmé con la
  misma herramienta que ahora las filas tienen alturas reales (por
  ejemplo 0.5", 0.4", 0.22" según el cuadro) en vez de 0.
- El Excel exportable también se actualizó: la hoja "Por proveedor" ya
  no trae la columna "C.O." (porque el cuadro ahora es por proveedor
  único), y se agregaron las hojas nuevas "Proveedores por clase" y
  "Referencias por clase", más las columnas de cantidad en la hoja
  "Por C.O.".

## 🚀 Instalación

**El proyecto de Supabase ya está creado y el esquema ya está aplicado** —
se llama `ns-proveedores` (región São Paulo / `sa-east-1`, plan gratuito),
lo creé y le apliqué `supabase/schema.sql` directamente. Ya pasó también
el chequeo de seguridad de Supabase (0 alertas) y el de rendimiento (solo
quedan avisos informativos de índices sin uso, normales con las tablas
vacías — se resuelven solos cuando empieces a importar datos).

Para instalar la app en tu computador:

1. `npm install`
2. Copia `.env.local.example` a `.env.local` — ya trae la URL y la llave
   pública (`anon`) reales del proyecto. Solo te falta pegar la
   `service_role` key (secreta): entra a
   [Supabase Dashboard](https://supabase.com/dashboard/project/wbrfvypsuuqttqqgxrdr) →
   **Project Settings > API** → copia **service_role secret**.
3. Crea tu primer usuario administrador (ver paso 3 más abajo).
4. `npm run dev`

Si quieres volver a ejecutar `supabase/schema.sql` desde cero (por ejemplo
en otro proyecto), la sección "Crear el proyecto de Supabase" más abajo
explica cómo.

## Qué incluye esta Etapa 1

- **Login** con usuario y contraseña (Supabase Auth), mismo diseño que
  Compras.
- **Importar bases de datos**: una sección separada por cada base, con la
  Ruta y las Consideraciones exactas con las que hoy las descargas del
  ERP (BASE, EA, ODC):
  - **BASE** (Pedidos / "DETALLE"): acumulativa, valida duplicados por
    Nro orden + Referencia (= "YAVE"). Incluye "Fecha de cumplido".
  - **EA** (Entradas / Evaluación de proveedores): acumulativa. El
    archivo real no trae columna "YAVE" — la app la calcula sola con
    "Docto. orden" + "Referencia".
  - **Histórico de ODC**: acumulativa, actualiza la fecha si la orden ya
    existía (se queda con la más reciente del archivo).
  - Cada carga muestra tiempo, cantidad de registros y errores por fila,
    y se puede descargar el detalle de omitidos en Excel.
  - Al importar BASE, EA, o el histórico de ODC, se recalcula
    automáticamente la corrección de fechas de orden.
- **Nivel de servicio**: tarjetas (líneas, valor, corregidas
  automáticamente, por revisar), filtros por fecha y por **C.O.**, una
  **franja de filtros de texto** debajo de los encabezados para
  Referencia, Proveedor, Nro orden y Desc. item (escribe y filtra en
  vivo, igual que en Pendientes de Compras), un selector para
  **mostrar/ocultar columnas** ("Mostrar/ocultar columnas", debajo de
  la barra de filtros), tabla con las líneas resaltadas en amarillo
  (corregida automáticamente) o rojo (necesita revisión manual),
  columnas arrastrables para cambiar de ancho, asignación de motivo de
  incumplimiento uno a uno o en bloque, corrección manual de fecha
  línea por línea, y exportación a Excel (respeta los filtros que
  tengas activos).
- **Configuración**:
  - Usuarios: nombre, correo, celular, rol, C.O. permitidos, módulos
    permitidos (mismo patrón que Compras).
  - Motivos: catálogo de causales (se preinstala con los 12 motivos de
    tu hoja "GUIA": Descodificado, Negociación fin de mes, Cambio de
    factura, Recoge Juan D Hoyos, Bajo pedido, Viene de otro lugar,
    Orden público, Bloqueo por cartera, Incumplido, Consolidación de
    carga, No se envió orden de compra, Promociones), editable y con
    importación masiva desde Excel/CSV.
  - **Tiempo de entrega**: ya no es una carga que reemplaza todo — es un
    **maestro editable**: agrega proveedores nuevos o modifica uno
    existente (días de entrega, condición de pago, pedidos mínimos,
    etc.) uno a uno desde la pantalla, o carga/actualiza varios a la vez
    desde el Excel del indicador NS Proveedores1 (hace upsert por C.O. +
    Proveedor, nunca borra lo que ya esté cargado).
  - **Cierre de mes**: descarga un respaldo en Excel con las 24 columnas
    exactas que pediste (YAVE, Fecha de cumplido, Nro orden, CO, Bodega,
    PROVEEDOR, Referencia, Desc. item, cantidades, Fecha orden, Precio
    unit., Valor bruto, Docto referencia, Notas documento, V PENDIENTE,
    OBSERVACIONES, FECHA DE ENTREGA REAL, DIFERENCIA, OBSERVACION 2,
    MOTIVO DE INCUMPLIMIENTO, VALIDACION, Validación) y luego, con
    confirmación escribiendo "ELIMINAR", vacía Pedidos y Entradas/EA
    para que el periodo siguiente arranque liviano (igual que en
    Compras). El histórico de ODC y el maestro de Tiempo de entrega NO
    se tocan.

### Sobre las columnas "VALIDACION" y "Validación" del cierre de mes

Tu Excel original tenía una columna "Validación" con un desfase de fila
(ver "Decisiones que tomé" más abajo), así que no había una fórmula
limpia que replicar. Construí estas dos columnas con lógica de negocio
clara -- si no es lo que esperabas, dime cómo deberían calcularse y las
ajusto:

- **VALIDACION**: para líneas "INCUMPLIDO", indica si ya tienen motivo
  asignado (`CON MOTIVO` / `FALTA MOTIVO`); `N/A` si no aplica.
- **Validación**: rastro de la corrección automática de "Fecha orden":
  `FECHA CORREGIDA AUTOMATICA`, `PENDIENTE REVISION FECHA`, u `OK`.

## Dashboard (nuevo)

Pantalla nueva (`/dashboard`, menú principal), con los mismos filtros de
fecha que Nivel de servicio:

- **6 tarjetas**: Cantidades (solicitada/pendiente/entregada + indicador
  = entregada/solicitada), Órdenes de compra (emitidas/sin
  pendientes/completas + in full), Tiempo de entrega (admitidas/a
  tiempo/incumplidas + on time), **OTIF** (on time × in full, con valor
  solicitado/pendiente), **Valor** (solicitado/pendiente/entregado +
  indicador) y **Líneas** (solicitadas/con pendiente/entregadas +
  indicador) — estas dos últimas nuevas, con la misma forma que
  Cantidades. Las tarjetas ya tenían la animación al pasar el cursor
  (se levantan un poco), igual que en Compras.
- **Tabla "Valor por proveedor"**: valor solicitado, pendiente y % de
  pendiente sobre solicitado, con la fila coloreada según qué tan alto
  es el % pendiente.
- **Tabla "Clasificación ABCD" (por proveedor)**: Pareto por valor
  solicitado (A ≤ 80% acumulado, B ≤ 95%, C ≤ 99%, D el resto —
  exactamente tus parámetros), con OTIF, NS Valor, on time e in full
  por proveedor.
- **Tabla "Descripción ítem — Pareto ABCD" (nueva)**: la misma
  clasificación ABCD pero por ítem en vez de por proveedor —
  Desc. item, ABCD (según participación acumulada del valor
  solicitado), Valor solicitado, Valor pendiente, NS Cantidad, NS
  Valor.
- **Tabla "Motivos — valor pendiente"** y **"Motivos por ítem"** (con %
  de participación sobre el total pendiente incumplido).
- **Gráfico de barras por C.O.**, con un selector para cambiar la medida
  (OTIF, on time, in full, NS Cantidad, NS Valor) y con la **etiqueta
  del valor sobre cada barra** (fondo amarillo, texto oscuro en negrita,
  para que se lea bien tanto en tema claro como oscuro).
- **Todos los cuadros son redimensionables**: arrastra el borde derecho
  de cualquier encabezado de columna para ajustar su ancho, igual que
  en Nivel de servicio y en Compras.
- **Filtro cruzado estilo Power BI**: haz clic en una fila de
  cualquier cuadro (o en una barra del gráfico por C.O.) y el resto del
  Dashboard — tarjetas, cuadros y gráfico — se filtra automáticamente
  por ese proveedor/ítem/motivo/C.O. Aparece un "chip" arriba indicando
  el filtro activo, con una "✕" para quitarlo. Puedes cruzar por
  proveedor (cuadros 1 y 2), por ítem (cuadro 3), por motivo (cuadros 4
  y 5) o por C.O. (gráfico de barras).
- **Exportar a Excel y a PowerPoint** (nuevo, igual que en Compras):
  dos botones nuevos junto a "Actualizar". El Excel trae una hoja
  "Resumen" con las tarjetas y una hoja por cada cuadro (Por proveedor,
  Por item ABCD, Por motivo, Por motivo e item, Por C.O.), todas con
  formato de moneda/porcentaje y filtro automático. El PowerPoint trae
  portada, una diapositiva de indicadores, un gráfico de barras nativo
  de PowerPoint (editable, no una imagen) con la medida que tengas
  seleccionada, y una diapositiva de tabla por cada cuadro (top 15,
  ordenado de mayor a menor — descarga el Excel si necesitas verlos
  todos). Ambos usan lo que ya está calculado en pantalla (respeta el
  rango de fechas y el filtro cruzado activo), así que son casi
  instantáneos — no vuelven a consultar la base de datos.

**Cómo definí "orden a tiempo" / "sin pendientes" (a nivel de documento,
no de línea) — puedes ajustar el criterio si no es exactamente lo que
esperabas**:
- Una orden (Nro orden) está **"sin pendientes" / in full** si la suma
  de "Cant. pendiente inv." de TODAS sus líneas da 0.
- Una orden está **"a tiempo" / on time** si TODAS sus líneas tienen
  diferencia ≤ 1 día hábil (si alguna línea todavía no tiene fecha de
  entrega real, la orden completa cuenta como NO a tiempo, igual que en
  el cálculo de NS que ya tenías).
- **"Completas"** = sin pendientes Y a tiempo a la vez (esto es lo que
  alimenta el conteo de OTIF a nivel de documento).
- **OTIF** = (órdenes a tiempo / total) × (órdenes sin pendientes /
  total), tal como lo definiste.

## Decisiones que tomé y que puedes ajustar

Como tu Excel tenía algunas inconsistencias internas (la hoja NOVEDADES
asignaba motivo por C.O.+Proveedor con una lista de validación aplicada
a la columna equivocada; la columna "Validación" de "BD Calculos" tenía
un desfase de una fila), no las repliqué tal cual — construí la versión
"limpia" que tiene más sentido de negocio, y la dejo documentada aquí
para que la confirmes o la ajustemos:

- **Fecha de entrega real**: cuando un mismo pedido (llave = C.O. + Nro
  orden/ODC + Referencia + Bodega, confirmado contigo) tiene varias
  entradas en la hoja EA, se usa la **fecha más reciente** (en vez de la
  primera que encuentre, que es lo que hacía el VLOOKUP de Excel).
- **Asignación de motivo**: además de línea por línea o en bloque (igual
  que en Pendientes de Compras) en Nivel de servicio, hay una pantalla
  nueva — **Novedades por incumplimiento en tiempo de entrega** — que
  agrupa por proveedor (no por ítem, que es demasiado dispendioso) para
  asignar un motivo a todas las líneas incumplidas de un proveedor de
  una sola vez.
- **Catálogo de motivos**: tomé los 12 que parecen ser causales reales
  de tu hoja GUIA (excluí "Descodificado" si no aplica, "Días de entrega
  asignados" e "Importaciones", que parecían encabezados de sección, no
  motivos). Puedes editarlos libremente desde Configuración > Motivos.

## Próximos pasos posibles (dime cuáles te sirven)

- Pantalla de **Dashboard** con gráficos de tendencia de nivel de
  servicio, como en Compras.
- **Cierre de mes**: descargar respaldo en Excel y vaciar Pedidos/EA
  para mantener la base liviana, igual que en Compras (Etapa 23-24).
- Restricción de C.O. visibles por usuario aplicada también en Nivel de
  servicio (ya está en el esquema de `profiles`, falta conectarla al
  filtro de la pantalla).
- Notificaciones o alertas cuando una línea queda "por revisar".

## 1. Crear el proyecto de Supabase

**Ya hecho para ti** — proyecto `ns-proveedores`, región `sa-east-1`,
URL `https://wbrfvypsuuqttqqgxrdr.supabase.co`. Solo te falta la
`service_role` key (ver instalación arriba). Estos pasos son por si algún
día necesitas recrear el proyecto desde cero (otro entorno, por ejemplo):

1. Ve a https://supabase.com y crea un proyecto nuevo.
2. Entra a **SQL Editor** y ejecuta `supabase/schema.sql`.
3. Ve a **Project Settings > API** y copia:
   - Project URL
   - `anon` `public` key
   - `service_role` key (secreta, nunca la compartas ni la subas a git)

## 2. Configurar el proyecto localmente

```bash
npm install
cp .env.local.example .env.local
# Edita .env.local y pega tus 3 valores de Supabase
```

## 3. Crear el primer usuario administrador

1. En Supabase, ve a **Authentication > Users > Add user** y crea tu
   usuario (correo + contraseña). Copia el UUID que se genera.
2. En **SQL Editor**, ejecuta (reemplazando los valores):

```sql
insert into profiles (id, nombre_completo, correo, rol, ve_todos_co, modulos_permitidos)
values (
  'UUID-DEL-USUARIO-AQUI',
  'Tu nombre',
  'tu-correo@empresa.com',
  'administrador',
  true,
  array['importar','nivel_servicio','configuracion_usuarios','configuracion_motivos']
);
```

Con esto ya puedes entrar como administrador y crear el resto de
usuarios desde **Configuración > Usuarios**.

## 4. Correr en desarrollo

```bash
npm run dev
```

Abre http://localhost:3000 — te enviará a `/login`.

## 5. Desplegar (recomendado: Vercel)

1. Sube este proyecto a un repositorio de GitHub (puede ser privado).
2. Entra a https://vercel.com, importa el repositorio.
3. En las variables de entorno de Vercel agrega las mismas 3 de
   `.env.local` (`SUPABASE_SERVICE_ROLE_KEY` como variable de servidor,
   solo se usa dentro de `pages/api/*`).
4. Despliega. Cada push a la rama principal actualiza la app sola.

## Estructura del proyecto

```
ns-proveedores-app/
├── supabase/schema.sql        # Tablas, función de corrección de fechas, vista, RLS
├── lib/                       # Cliente Supabase, contexto de auth, utilidades de import
│   └── exportarDashboard.js   # Exportar Dashboard a Excel (exceljs) y PowerPoint (pptxgenjs)
├── components/Layout.js       # Menú lateral según módulos del usuario
├── components/TablaHeader.js  # <th> ordenable + redimensionable (arrastrar ancho)
├── components/CuadroDashboard.js  # Cuadro de tabla del Dashboard: ordenable, redimensionable y con filtro cruzado (clic en fila)
├── pages/
│   ├── login.js
│   ├── index.js
│   ├── importar.js
│   ├── nivel-servicio.js        # Filtros por columna, filtro C.O., mostrar/ocultar columnas
│   ├── novedades.js            # Asignar motivo por proveedor (no por ítem)
│   ├── dashboard.js             # Tarjetas OTIF/NS, cuadros ABCD (proveedor e ítem)/motivos, gráfico por C.O., filtro cruzado estilo Power BI
│   ├── configuracion/usuarios.js
│   ├── configuracion/motivos.js
│   ├── configuracion/tiempo-entrega.js  # Maestro de proveedores (agregar/editar)
│   ├── configuracion/cierre-mes.js      # Respaldo Excel + vaciar Pedidos/EA
│   └── api/crear-usuario.js   # Crea usuarios en Supabase Auth (usa service_role)
└── styles/globals.css
```
