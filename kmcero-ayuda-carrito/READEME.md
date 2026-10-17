# KMCERO · Ayuda para el carrito

Extensión local para Chrome o Edge. Añade un panel a kmcero.cu que busca un producto por su nombre exacto, abre su ficha y pulsa el control original **Añadir al carrito** de la tienda. No crea pedidos ni realiza pagos.

## Instalación

1. Abre `chrome://extensions` (Chrome) o `edge://extensions` (Edge).
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige esta carpeta.
4. Entra a `https://www.kmcero.cu`, inicia sesión y abre el catálogo.
5. Pulsa **🛒 Ayuda carrito** abajo a la izquierda.

## Añadir un producto automáticamente

En el panel, escribe el **nombre exacto** del producto tal como aparece en el catálogo (por defecto trae cargado el gas licuado) y pulsa **Activar**. La extensión navega a la búsqueda de ese producto por su URL y deja abierta la pestaña de KMCERO. Cuando la tienda muestre el producto, la extensión abrirá su ficha y pulsará el botón original **Añadir al carrito**. Revisa el carrito para confirmar que la tienda aceptó la operación. **Detener** cancela la espera.

Si el botón **Añadir al carrito** aparece **desactivado** (por ejemplo porque la cantidad o el stock mostrado en la ficha no está listo) o la ficha dice **Agotado**, la extensión espera los segundos que indiques en **Reabrir cada** y luego **recarga la página completa**, para forzar que se actualice el stock disponible y volver a intentar abrir la ficha y añadir el producto. Los reintentos frecuentes pueden activar las alertas de KMCERO; si detecta un aviso de uso intensivo o bloqueo, se detiene.

Si KMCERO no actualiza el catálogo por sí mismo, escribe los minutos que quieras en **Recargar página completa cada... minutos** (0 = nunca) antes de pulsar **Activar**. Esta opción es independiente del intervalo de reapertura de la ficha y solo recarga mientras la pestaña esté visible y la ficha no esté abierta.

La extensión observa los cambios que la tienda muestra en la pestaña abierta. No consulta inventario en segundo plano ni completa pagos. Si la ficha exige elegir variantes u otros datos, tendrás que terminarlos en la tienda.

Cuando la página muestra el producto, la extensión responde a los cambios del contenido sin esperar al intervalo de recarga. La rapidez de aparición depende de cuándo KMCERO entregue y muestre los datos; añadir al carrito tampoco garantiza que el inventario siga disponible hasta completar el pedido.

Si el estado se queda esperando la reapertura de la ficha tras varios intentos, la extensión sigue reintentando según el intervalo elegido. Algunos controles del sitio pueden rechazar clics generados por extensiones; en ese caso, abre la ficha tú mismo y la extensión intentará pulsar **Añadir al carrito** cuando la vea abierta.

La ficha de KMCERO puede abrirse como una ventana sobre el catálogo sin cambiar la dirección de la página. Esta versión reconoce esa ventana y solo muestra éxito cuando la tienda indica **En el carrito**. Si no recibe esa confirmación, muestra un aviso para que compruebes el carrito.

Si tenías instalada la versión anterior, sustituye los archivos en la misma carpeta, pulsa **Actualizar** en la tarjeta de la extensión dentro de `chrome://extensions` o `edge://extensions` y recarga la página de KMCERO.

La extensión no guarda credenciales ni completa pagos. Los intentos de reapertura y las recargas opcionales pueden generar consultas a KMCERO mediante los controles normales de la página; no evitan sus reglas de disponibilidad.

## Límite actual

No se pudo verificar el catálogo después de iniciar sesión, porque requiere una cuenta del usuario. El buscador solo encuentra productos cargados en la página actual; no consulta el catálogo completo. La tienda puede cambiar la estructura de sus tarjetas; si el panel no detecta un producto visible, usa el control normal de KMCERO y envía una captura para ajustar el detector.