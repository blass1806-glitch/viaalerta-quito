# VíaAlerta Quito — informe de hardening

## Estado
Este paquete implementa una arquitectura más segura que el MVP anterior, pero **no debe considerarse producción lista** hasta completar los secretos, desplegar las Edge Functions, ejecutar el SQL, probar los controles en el proyecto real y revisar los requisitos legales/operativos.

## Cambios de seguridad incluidos

- El navegador conserva únicamente permisos `SELECT` sobre reportes y comentarios.
- Se revocan `INSERT`, `UPDATE`, `DELETE` y `TRUNCATE` para `anon` y `authenticated`.
- Las escrituras pasan por Edge Functions; `SUPABASE_SERVICE_ROLE_KEY` existe solo en el servidor.
- Las Edge Functions verifican el origen, la clave pública del proyecto, Turnstile y límites de frecuencia.
- Rate limit atómico por hash de IP y tipo de acción; no se almacena la IP en la tabla de límites.
- Validación de categoría, coordenadas, longitud de texto, tipo MIME y firma binaria de imagen.
- Límite de foto de 5 MB; no se aceptan SVG, HTML ni formatos arbitrarios.
- Bucket público solo para lectura: las cargas las realiza el servidor.
- Moderación de texto en servidor y trigger SQL adicional; el filtro del navegador es solo una ayuda UX.
- Consultas públicas limitadas y ordenadas; texto renderizado con escape HTML.
- CSP, HSTS, `nosniff`, `frame-ancestors`, `Referrer-Policy` y `Permissions-Policy` en `_headers`.
- Sin registro ciudadano ni institucional. La clave pública del cliente no es una contraseña.

## Configuración obligatoria antes de desplegar

### 1. Supabase SQL
Ejecuta `supabase/schema.sql` en el SQL Editor del proyecto. Revisa que las políticas antiguas de INSERT de Storage hayan desaparecido. Los roles `anon` y `authenticated` no deben tener privilegios de escritura en `reports`, `comments` ni `storage.objects`.

### 2. Cloudflare Turnstile
Crea un widget en https://dash.cloudflare.com/ → Turnstile. Configura el dominio de producción y el de pruebas. La Site Key es pública; el Secret Key es exclusivamente servidor.

### 3. Configuración del navegador
Copia `config.js.example` a `config.js` y completa:
- `supabaseUrl`
- `supabaseAnonKey` (publishable/anon pública)
- `turnstileSiteKey`
- `functionsBaseUrl`

No publiques el archivo `.env`, ni una clave `service_role` o `secret`.

### 4. Secretos de Supabase Functions
Configura en el entorno de Edge Functions:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (solo servidor)
- `SUPABASE_ANON_KEY` (misma clave pública configurada en el frontend)
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_EXPECTED_HOSTNAME` (hostname exacto, sin protocolo)
- `RATE_LIMIT_PEPPER` (secreto aleatorio largo, mínimo 32 bytes)
- `ALLOWED_ORIGINS` (lista separada por comas, por ejemplo `https://viaalerta.ec,https://www.viaalerta.ec`; añade localhost solo en entorno de desarrollo)

Ejemplo de configuración con Supabase CLI:

```bash
supabase secrets set SUPABASE_URL="https://TU-PROYECTO.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="TU_SERVICE_ROLE_SECRET" \
  SUPABASE_ANON_KEY="TU_ANON_O_PUBLISHABLE_KEY" \
  TURNSTILE_SECRET_KEY="TU_TURNSTILE_SECRET" \
  TURNSTILE_EXPECTED_HOSTNAME="viaalerta.ec" \
  RATE_LIMIT_PEPPER="GENERA_UN_SECRETO_ALEATORIO_LARGO" \
  ALLOWED_ORIGINS="https://viaalerta.ec,https://www.viaalerta.ec"
```

Despliega:

```bash
supabase functions deploy report-create
supabase functions deploy comment-create
```

`supabase/config.toml` desactiva la validación JWT del gateway para estos dos endpoints públicos; por eso el código valida `apikey`, origen, CAPTCHA y límites. Los endpoints no son privados: están diseñados para publicación anónima, y su resistencia depende de Turnstile, rate limiting y monitoreo.

### 5. Hosting
Publica los archivos estáticos en un hosting HTTPS que respete el archivo `_headers` (Cloudflare Pages o Netlify, por ejemplo). Crea `config.js` a partir del ejemplo durante el despliegue y exclúyelo del repositorio si contiene datos de entorno específicos. La clave anon/publishable es pública, pero debe restringirse el acceso al proyecto con RLS y políticas correctas.

## Pruebas de aceptación obligatorias

1. Desde una sesión anónima, `SELECT` en `reports` y `comments` funciona.
2. Desde el navegador, INSERT/UPDATE/DELETE directo a esas tablas falla con `permission denied` o RLS.
3. INSERT/UPDATE/DELETE directo a `storage.objects` desde anon falla.
4. Reporte sin Turnstile, con CAPTCHA inválido o desde origen no autorizado falla.
5. Archivo SVG renombrado como JPG, MIME falso, archivo >5 MB y firma binaria inválida fallan.
6. Coordenadas fuera del rango geográfico admitido fallan.
7. Texto ofensivo, demasiado largo o vacío falla en el servidor.
8. Al exceder límites temporales, la función devuelve HTTP 429.
9. Un reporte válido aparece en otro dispositivo y las instituciones pueden consultarlo sin cuenta.
10. La clave `service_role` no aparece en HTML, JS, repositorio, variables del navegador ni respuestas de red.
11. La CSP no genera errores en consola; Leaflet, Turnstile, tiles y Supabase funcionan.
12. No se permite modificar ni borrar reportes o comentarios desde clientes públicos.

## Riesgos residuales / trabajo pendiente

- **Anonimato:** no se solicita identidad, pero hosting, Cloudflare y Supabase procesan datos técnicos (por ejemplo IP/telemetría) para operar y prevenir abuso. No se debe prometer anonimato absoluto. La función usa IP para limitar abuso y guarda solo un hash con pepper en la tabla de rate limit.
- **Ubicación:** el rectángulo de coordenadas SQL es aproximado, no el polígono oficial del Distrito Metropolitano de Quito. Antes de producción debe sustituirse por validación geoespacial con el límite oficial (PostGIS `ST_Contains`).
- **Fotografías:** se valida firma y tipo, pero todavía falta transcodificación/reescritura de imágenes para eliminar EXIF/GPS y metadatos, y moderación visual de contenido. Recomendada antes de apertura pública.
- **Moderación:** lista de palabras y normalización no detecta todo el contexto, variantes, acoso ni amenazas. Hace falta cola de revisión y herramienta de denuncia; no se debe presentar como filtro perfecto.
- **Abuso distribuido:** CAPTCHA y rate limit por IP reducen abuso, pero VPN, botnets y NAT pueden eludir/compartir límites. Añadir cuotas globales, alertas y controles de reputación.
- **Costos y disponibilidad:** configurar límites de gasto, alertas, backups y monitoreo en Supabase/hosting. Revisar límites de uso de OpenStreetMap; no depender del servidor comunitario de tiles para tráfico comercial/alto volumen.
- **Administración:** este paquete no implementa aún un panel privado de moderación. La administración debe añadirse con autenticación fuerte y endpoints separados; nunca abrir `service_role` al cliente.
- **Seguridad operacional:** ejecutar análisis de dependencias, pruebas dinámicas, revisión de CORS/CSP y auditoría independiente antes del lanzamiento.

## Política de acceso
Instituciones y público consultan la misma web sin cuentas. Los ciudadanos publican anónimamente mediante endpoints públicos protegidos. No existe panel ni permiso institucional de edición.
