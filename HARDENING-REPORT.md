# Informe de hardening — VíaAlerta Quito

## Resumen ejecutivo
Se revisó el MVP anterior y se identificó un riesgo crítico de abuso: el cliente anónimo tenía permisos directos para insertar reportes, comentarios y objetos en el bucket de fotografías. La moderación de lenguaje ocurría principalmente en el navegador y no había CAPTCHA ni rate limiting de servidor.

La versión reforzada elimina las escrituras directas del navegador y centraliza las publicaciones en dos Edge Functions. Se conserva el requisito del producto: acceso público, sin cuentas ciudadanas ni institucionales, y las instituciones solo consultan el contenido público.

## Hallazgos del MVP anterior

| Hallazgo | Riesgo | Tratamiento |
|---|---|---|
| INSERT público directo en tablas | Spam y abuso automatizado | Revocado; escritura por Edge Functions |
| INSERT público directo a Storage | Subida de archivos arbitrarios dentro del bucket | Revocado; el servidor valida y carga |
| Filtro de insultos solo en frontend | Bypass sencillo desde API | Validación en Edge Function + trigger SQL |
| Sin CAPTCHA ni rate limit | Bots y abuso de recursos | Turnstile + cuotas por IP hasheada |
| CSP/headers ausentes | Mayor superficie ante XSS/clickjacking | `_headers` con CSP y headers defensivos |
| URL/archivo validado solo en cliente | MIME falso/extensión engañosa | Firma binaria y MIME validados en servidor |
| Clave de servicio descrita pero sin separación de endpoints | Riesgo de exponer privilegios si se implementa mal | Service role solo en Edge Functions |

## Validaciones locales realizadas

- `node --check app.js`: correcto.
- Revisión de HTML: los handlers inline fueron retirados del código de interfaz y movidos a listeners en `app.js`.
- Revisión de permisos SQL: roles públicos solo reciben SELECT; no se conceden escrituras públicas.
- Revisión de secretos: la plantilla del cliente solo contiene claves públicas; los secretos requeridos están documentados para el entorno servidor.

## No verificado en este entorno

No se dispone de acceso al proyecto Supabase real, a las credenciales de despliegue, al dominio final ni a Cloudflare Turnstile. Por tanto, no se pudo ejecutar el SQL contra producción, desplegar Edge Functions, verificar los secretos, probar CORS real, comprobar políticas efectivas del bucket ni realizar pruebas dinámicas contra el servicio desplegado.

## Riesgos que permanecen abiertos

1. Reescritura de imágenes y eliminación de metadatos EXIF/GPS del archivo antes de hacerlo público.
2. Validación de coordenadas contra el polígono oficial del Distrito Metropolitano de Quito, no solo una caja geográfica aproximada.
3. Moderación de imágenes y revisión humana de contenido denunciado.
4. Detección de evasión de filtros, amenazas y lenguaje abusivo contextual.
5. Cuotas globales, alertas de consumo, monitoreo, backups y pruebas de carga.
6. Pruebas de penetración y revisión independiente antes de una difusión pública amplia.

**Conclusión:** el paquete reduce de forma sustancial los riesgos de abuso del MVP, pero el hardening no queda completado hasta configurar, desplegar y probar el backend real. No debe anunciarse como invulnerable ni como auditado por terceros.
