# VíaAlerta Quito — MVP con hardening de seguridad

Aplicación web pública adaptable a móvil y escritorio. Los ciudadanos publican reportes anónimos; cualquier visitante, incluidas instituciones, consulta el mismo mapa sin crear cuenta. Las escrituras se procesan en Edge Functions protegidas; el navegador no tiene permisos directos de escritura en la base de datos ni en Storage.

## Stack
- Leaflet + OpenStreetMap.
- Supabase (Postgres + Storage + Edge Functions).
- Cloudflare Turnstile para frenar automatizaciones.
- Hosting estático HTTPS con encabezados de seguridad en `_headers`.

## Archivos principales
- `index.html`, `app.js`: interfaz pública.
- `config.js.example`: plantilla de configuración pública del navegador.
- `supabase/schema.sql`: tablas, RLS, permisos mínimos, bucket y rate limiting.
- `supabase/functions/report-create`: endpoint validado para reportes y fotografías.
- `supabase/functions/comment-create`: endpoint validado para comentarios.
- `supabase/functions/_shared/security.ts`: CORS, CAPTCHA, rate limiting, validaciones y moderación.
- `supabase/config.toml`: configuración de endpoints públicos con verificación propia en función.
- `SECURITY.md`: guía de hardening, despliegue y pruebas obligatorias.

## Inicio rápido

1. Crea un proyecto Supabase.
2. Ejecuta `supabase/schema.sql` en el SQL Editor.
3. Crea un widget Cloudflare Turnstile con el dominio de desarrollo/producción.
4. Copia `config.js.example` como `config.js` y rellena la URL, clave pública, site key y URL de funciones.
5. Configura los secretos de Edge Functions indicados en `SECURITY.md`.
6. Instala Supabase CLI, vincula el proyecto y despliega:

```bash
supabase link --project-ref TU_PROJECT_REF
supabase secrets set SUPABASE_URL="https://TU-PROYECTO.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="TU_SERVICE_ROLE_KEY" \
  SUPABASE_ANON_KEY="TU_ANON_O_PUBLISHABLE_KEY" \
  TURNSTILE_SECRET_KEY="TU_TURNSTILE_SECRET" \
  TURNSTILE_EXPECTED_HOSTNAME="tu-dominio.ec" \
  RATE_LIMIT_PEPPER="SECRETO_ALEATORIO_LARGO" \
  ALLOWED_ORIGINS="https://tu-dominio.ec"
supabase functions deploy report-create
supabase functions deploy comment-create
```

7. Publica la carpeta en un hosting HTTPS que aplique `_headers` (por ejemplo Cloudflare Pages o Netlify).
8. Ejecuta todas las pruebas de aceptación de `SECURITY.md` antes de abrir el sitio al público.

## Configuración pública vs secretos

`config.js` solo debe contener URL, clave anon/publishable y Turnstile Site Key. La `service_role` key y Turnstile Secret Key son secretos de servidor y nunca deben incluirse en HTML, JS, repositorios o variables `NEXT_PUBLIC_*`.

## Límites conocidos

Este es un hardening importante del MVP, no una certificación de seguridad ni una auditoría de penetración. Antes de producción aún se recomienda transcodificar imágenes para eliminar EXIF/GPS, validar contra el polígono oficial del Distrito Metropolitano, implementar moderación visual y denuncia, añadir panel privado de administración y monitoreo, configurar backups/alertas y realizar pruebas dinámicas. Ver `SECURITY.md`.


## Sostenibilidad y donaciones (fase futura)

VíaAlerta comienza como un proyecto ciudadano independiente, no como una organización ni como un canal oficial de una institución pública. La interfaz incluye una sección informativa de apoyo, pero **no procesa ni recibe pagos todavía**.

Cuando se habiliten las donaciones:
- Serán voluntarias y se recibirán a través de un proveedor de pagos que opere legalmente en Ecuador.
- La persona responsable del proyecto administrará los fondos inicialmente y conservará comprobantes y un registro de cada ingreso y gasto.
- Se publicará un resumen periódico de ingresos, comisiones, gastos operativos y saldo destinado al mantenimiento, sin divulgar datos personales o bancarios de donantes.
- No se solicitará una donación para reportar, comentar o consultar información. Donar nunca dará prioridad, trato preferente ni capacidad de modificar reportes.
- Antes de activar cobros se revisarán las obligaciones tributarias, contables y legales aplicables en Ecuador. Si el volumen o la operación lo justifican, se evaluará constituir una organización formal.

No se deben insertar claves privadas de pasarelas de pago en el frontend. La futura integración deberá verificar pagos en servidor mediante webhooks firmados y registrar únicamente los datos necesarios para conciliación.
