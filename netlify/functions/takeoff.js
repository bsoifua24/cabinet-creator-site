/* Cabinet Creator — plan takeoff function (pass 2: read exact dimensions).
   Runs on Netlify's servers so the API key never reaches the browser.
   Setup: in the Netlify dashboard → Site settings → Environment variables,
   add ANTHROPIC_API_KEY with your key from console.anthropic.com. */

const TAKEOFF_PROMPT = `You are a cabinet-industry estimator doing a takeoff from residential construction plans.
Some images may carry a short caption guessing the room from an earlier scanning pass — verify that guess against what you actually see and correct it if it's wrong.
For each room, read the dimension strings (or scale from labeled dimensions) and report the cabinet-bearing walls.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"rooms":[
 {"name":"Kitchen","type":"kitchen","shape":"L","ceiling":96,
  "walls":{"A":150,"B":126,"C":0},
  "fixtures":{"A":{"sink":true,"dw":true,"window":true},"B":{"range":true,"fridge":true}},
  "notes":"anything ambiguous"}
]}
Rules:
- type is one of: kitchen, bath, laundry, closet — pick the nearest fit for non-standard spaces (wet bar/butler's pantry → kitchen, mudroom/pantry/office built-ins/media wall → closet, powder room → bath).
- shape is one of: single, L, galley, U. Wall A first; for L, A is the longer leg; for U, B is the back wall.
- All wall lengths in INCHES along the face that receives cabinets. Omit or set 0 for unused walls.
- fixtures keys by room type — kitchen: sink, dw, range, fridge, window · bath: vanity, vanity2, linen, toilet · laundry: washer, dryer, sink, tall · closet: drawers, shelves, rods.
- If a dimension is not legible, estimate from scale and say so in notes. Never invent rooms.`;

exports.handler = async (event) => {
  const headers = { 'content-type': 'application/json' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set in the Netlify environment variables.' }) };

  let files;
  try { files = (JSON.parse(event.body || '{}').files) || []; }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request body' }) }; }

  if (!files.length || files.length > 24)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Send 1–24 room images/pages.' }) };

  const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const content = [];
  for (const f of files) {
    if (!OK_TYPES.includes(f.media_type) || typeof f.data !== 'string')
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported file type.' }) };
    if (f.caption && typeof f.caption === 'string')
      content.push({ type: 'text', text: f.caption.slice(0, 300) });
    content.push(f.media_type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
      : { type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
  }
  content.push({ type: 'text', text: TAKEOFF_PROMPT });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content }]
      })
    });
    const data = await resp.json();
    if (data.error)
      return { statusCode: 502, headers, body: JSON.stringify({ error: data.error.message || 'AI service error' }) };
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return { statusCode: 200, headers, body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
