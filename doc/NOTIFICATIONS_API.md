# Notificaciones de la API

Este documento describe cómo se almacenan y sincronizan las notificaciones entre la aplicación de escritorio y la API.

## Flujo general

La aplicación de escritorio guarda las notificaciones en su base SQLite local. Las que tienen cambios pendientes se envían a la API y las notificaciones remotas se descargan y fusionan en SQLite. La interfaz consulta principalmente esa copia local.

La sincronización completa sigue este orden:

1. **Push:** envía a la API los registros locales pendientes de sincronizar.
2. **Pull:** obtiene registros remotos nuevos o modificados usando un cursor.
3. **Lectura local:** la aplicación devuelve a la interfaz la página solicitada desde SQLite.

La aplicación también puede avisar cambios de lectura o descarte inmediatamente. La API almacena las notificaciones en DynamoDB cuando la tabla está configurada; si no, el servidor usa el almacén JSON en S3. DynamoDB puede leer datos existentes de S3 como migración de respaldo cuando todavía no encuentra registros para ese usuario.

## Endpoints

### `POST /notifications/batch`

Sincroniza notificaciones creadas o modificadas en el cliente. El cuerpo tiene la forma `{ "items": [...] }`; cada solicitud admite hasta **200 registros**. Rust lee hasta 200 registros locales pendientes por tanda. La API guarda o reemplaza cada registro por su clave de usuario e ID.

### `GET /notifications`

Lista los registros disponibles para el usuario autenticado.

Parámetros:

| Parámetro | Comportamiento                                                                            |
| --------- | ----------------------------------------------------------------------------------------- |
| `limit`   | Cantidad solicitada por página. El valor predeterminado es **50** y el máximo es **200**. |
| `cursor`  | Cursor devuelto por la página anterior; se omite para empezar desde la página inicial.    |

La respuesta tiene la forma `{ "items": [...], "nextCursor": "..." }`. El cliente debe pasar `nextCursor` como `cursor` en la siguiente solicitud. Rust pide páginas de hasta 200 registros y guarda el cursor de sincronización localmente.

Hay dos niveles de paginación distintos:

- **DynamoDB:** el repositorio sigue internamente `LastEvaluatedKey` hasta terminar de leer los registros del usuario. Este cursor interno no se expone al cliente.
- **API:** el caso de uso ordena los registros y entrega páginas mediante `cursor` y `nextCursor`.

### Límite del historial

El repositorio de DynamoDB ordena por fecha y devuelve como máximo las **500 notificaciones más recientes** al caso de uso. Por tanto, la paginación de `GET /notifications` permite recorrer esas 500, pero no acceder a registros más antiguos si existen más. El tope de 500 es una decisión de la implementación; no es el límite de página de DynamoDB ni el máximo que acepta el endpoint.

Los registros de DynamoDB reciben un TTL de **30 días**. La retención efectiva también depende del almacén utilizado y de que la expiración TTL haya sido procesada por DynamoDB.

### `POST /notifications/ack`

Marca notificaciones como leídas o descartadas. El cuerpo incluye los IDs y uno o ambos indicadores:

```json
{
  "ids": ["id-de-notificacion"],
  "read": true,
  "dismiss": false
}
```

La API actualiza los registros identificados. Rust también actualiza primero su SQLite local y envía este aviso remoto en segundo plano.

## Límites relacionados

- `POST /notifications/batch`: máximo de **200** elementos por solicitud.
- `GET /notifications`: máximo de **200** elementos por página; máximo de **500** elementos disponibles en la carga actual del repositorio DynamoDB.
- `POST /notifications/ack`: máximo de **500** IDs por solicitud.
- Las escrituras DynamoDB por lote se dividen en grupos de **25**, que es el máximo de escrituras de `BatchWriteItem` por llamada; los elementos no procesados se reintentan.
