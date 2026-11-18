
import { backend, corsHeaders, json, requirePublicKey, normalizeText, hasProfanity, verifyTurnstile, rateLimit } from '../_shared/security.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Método no permitido.' });
  if (!requirePublicKey(req)) return json(req, 401, { error: 'Cliente no autorizado.' });

  const origin = req.headers.get('origin') ?? '';
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(x=>x.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return json(req, 403, { error: 'Origen no autorizado.' });

  try {
    const db = backend();
    const body = await req.json();
    const reportId = String(body.reportId ?? '');
    const comment = normalizeText(String(body.body ?? ''));
    const token = String(body.turnstileToken ?? '');

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId))
      return json(req, 400, { error: 'Reporte inválido.' });

    if (comment.length < 2 || comment.length > 300 || hasProfanity(comment))
      return json(req, 400, { error: 'El comentario no cumple las reglas de publicación.' });

    if (!await verifyTurnstile(token, req))
      return json(req, 403, { error: 'No se pudo verificar la protección anti-bots.' });

    if (!await rateLimit(db, req, 'comment'))
      return json(req, 429, { error: 'Has alcanzado el límite temporal de comentarios.' });

    const { data: report, error: lookupError } = await db
      .from('reports').select('id').eq('id', reportId).maybeSingle();

    if (lookupError || !report)
      return json(req, 404, { error: 'El reporte no existe.' });

    const { data, error } = await db.from('comments')
      .insert({ report_id: reportId, body: comment })
      .select('id,report_id,body,created_at').single();

    if (error) throw error;

    return json(req, 201, { comment: data });
  } catch (e) {
    console.error('comment-create failure', e instanceof Error ? e.message : 'unknown');
    return json(req, 500, { error: 'No se pudo publicar el comentario. Inténtalo más tarde.' });
  }
});
