# VíaAlerta AI — plan de implementación y pruebas

## Objetivo
Validar cada reporte en el servidor antes de publicarlo. La IA complementa, pero nunca sustituye, las comprobaciones deterministas.

## Flujo objetivo
1. Recibir formulario y CAPTCHA.
2. Validar categoría, texto, tamaño, MIME real y firma del archivo.
3. Validar latitud/longitud y comprobar con PostGIS que el punto está cubierto por el polígono oficial del Distrito Metropolitano de Quito.
4. Decodificar y volver a codificar la imagen en el servidor, eliminando EXIF/GPS y metadatos; limitar dimensiones y tamaño resultante.
5. Analizar la imagen con un modelo de visión desde la Edge Function. Solicitar una respuesta estructurada: `is_road_issue`, `detected_category`, `image_quality`, `safety_flags`, `confidence`, `reason`.
6. Comparar categoría declarada y detectada; calcular duplicidad con hash perceptual y proximidad geográfica.
7. Aplicar política determinista: `approved`, `needs_review` o `rejected`.
8. Guardar primero en almacenamiento privado temporal. Solo `approved` pasa a almacenamiento público y aparece en el mapa.

## Reglas de decisión iniciales (ajustables con pruebas)
- Rechazar: archivo corrupto/no decodificable, contenido manifiestamente ajeno al propósito, ubicación fuera del polígono, CAPTCHA inválido, abuso confirmado.
- Revisión: baja calidad, discrepancia entre categoría y análisis, posible duplicado, señales de privacidad o confianza insuficiente.
- Aprobar: validaciones técnicas y geográficas correctas, evidencia visual pertinente y sin alertas relevantes.
- No usar una puntuación de IA como única condición de rechazo. Registrar versión del modelo y motivo para auditar falsos positivos.

## Geocerca PostGIS
La migración `supabase/migrations/20261118_quito_geofence.sql` crea una tabla privada y una función `is_point_in_quito`. La función falla de forma cerrada: hasta importar el polígono oficial, no permite publicar reportes. No ejecutar en producción sin disponer del GeoJSON oficial, validar su fuente, CRS/SRID 4326, geometría y cobertura territorial.

## Pendiente antes de conectar IA
- Elegir proveedor/modelo de visión y revisar precio, retención, ubicación de procesamiento y condiciones de uso.
- Definir límites de coste y tamaño; nunca enviar claves al navegador.
- Implementar decodificación/re-encode server-side con librería compatible con Deno Edge Runtime.
- Crear bucket privado temporal y estados de moderación; no hacer pública una imagen hasta aprobarla.
- Decidir tratamiento de rostros y placas: detección y difuminado antes de publicación, con revisión cuando no sea fiable.

## Pruebas
Crear casos positivos y negativos por categoría, fotos borrosas, capturas, imágenes repetidas, formatos falsos, GPS fuera/dentro/en borde, ubicación imprecisa y discrepancias. Medir falsos positivos y falsos negativos. Mantener el entorno de prueba separado del de producción.

## Limitaciones
La IA puede equivocarse y las coordenadas GPS pueden ser manipuladas. La geocerca comprueba el punto declarado, no demuestra que la foto se haya tomado allí. No prometer verificación absoluta ni anonimato absoluto.
