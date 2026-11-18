
import { backend, corsHeaders, json, requirePublicKey, normalizeText, hasProfanity, verifyTurnstile, rateLimit, validImage, validCoords } from '../_shared/security.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Método no permitido.' });
  if (!requirePublicKey(req)) return json(req, 401, { error: 'Cliente no autorizado.' });

  const origin = req.headers.get('origin') ?? '';
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return json(req, 403, { error: 'Origen no autorizado.' });

  try {
    const db = backend();
    const form = await req.formData();
    const category = String(form.get('category') ?? '');
    const description = normalizeText(String(form.get('description') ?? ''));
    const lat = Number(form.get('lat'));
    const lng = Number(form.get('lng'));
    const token = String(form.get('turnstileToken') ?? '');
    const file = form.get('photo');

    if (!['pothole', 'manhole', 'blocked', 'flood'].includes(category))
      return json(req, 400, { error: 'Categoría inválida.' });

    if (description.length > 500 || hasProfanity(description))
      return json(req, 400, { error: 'La descripción excede el límite o contiene lenguaje no permitido.' });

    if (!validCoords(lat, lng))
      return json(req, 400, { error: 'La ubicación está fuera del área admitida de Quito.' });

    // Validación territorial contra el polígono oficial del DMQ.
    const { data: insideQuito, error: geoError } = await db.rpc(
      'is_point_in_quito',
      {
        p_lat: lat,
        p_lng: lng
      }
    );

    // Si falla PostGIS, no permitimos publicar el reporte.
    if (geoError) {
      console.error('Error en validación territorial:', geoError.message);
      return json(req, 503, { error: 'No se pudo validar la ubicación. Inténtalo más tarde.' });
    }

    if (insideQuito !== true)
      return json(req, 400, { error: 'La ubicación está fuera del Distrito Metropolitano de Quito.' });

    if (!(file instanceof File) || file.size < 1 || file.size > 5 * 1024 * 1024)
      return json(req, 400, { error: 'La fotografía debe pesar como máximo 5 MB.' });

    if (!await verifyTurnstile(token, req))
      return json(req, 403, { error: 'No se pudo verificar la protección anti-bots. Inténtalo nuevamente.' });

    if (!await rateLimit(db, req, 'report'))
      return json(req, 429, { error: 'Límite temporal de reportes alcanzado. Inténtalo más tarde.' });

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validImage(bytes, file.type))
      return json(req, 415, { error: 'Formato de imagen no válido. Usa JPG, PNG o WebP.' });

    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
    const path = `${crypto.randomUUID()}.${ext}`;

    const upload = await db.storage.from('report-photos').upload(path, bytes, {
      contentType: file.type,
      upsert: false,
      cacheControl: '31536000'
    });

    if (upload.error) throw upload.error;

    const photoUrl = db.storage.from('report-photos').getPublicUrl(path).data.publicUrl;

    const { data, error } = await db.from('reports').insert({
      category, description, lat, lng, photo_url: photoUrl
    }).select('id,category,description,lat,lng,photo_url,status,created_at').single();

    if (error) {
      await db.storage.from('report-photos').remove([path]);
      throw error;
    }

    return json(req, 201, { report: data });
  } catch (e) {
    console.error('report-create failure', e instanceof Error ? e.message : 'unknown');
    return json(req, 500, { error: 'No se pudo publicar el reporte. Inténtalo más tarde.' });
  }
});
