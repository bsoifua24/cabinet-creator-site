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
  "fixtures":{"A":{"sink":true,"dw":true,"window":true},"B":{"fridgeXL":true}},
  "island":{"width":90,"depth":36,"sink":true},
  "sourcePage":3,
  "notes":"anything ambiguous, including any floating/open shelving shown that doesn't fit a fixture slot below"}
]}
Rules:
- type is one of: kitchen, bath, laundry, closet — pick the nearest fit for non-standard spaces. A space with countertop/base-cabinet symbols — a wet bar, butler's pantry, prep kitchen, prep pantry, or scullery — is "kitchen" even if it's small or has no range/fridge, AS LONG AS you can actually see counter/cabinet runs (a double-ruled rectangle with a door-swing or drawer marks) on the plan; don't default a room to "kitchen" just because its label says "prep" or "pantry". A storage-only space with no counter and no plumbing — a plain shelving pantry, mudroom lockers, linen, office built-ins, a media wall — is "closet". Powder room → bath.
- shape is one of: single, L, galley, U. Wall A first; for L, A is the longer leg; for U, B is the back wall.
- All wall lengths in INCHES along the face that receives cabinets. Omit or set 0 for unused walls.
- fixtures keys by room type — kitchen: sink, dw, range, fridge, fridgeXL, trash, spice, ice, window · bath: vanity, vanity2, linen, toilet · laundry: washer, dryer, sink, tall · closet: drawers, shelves, rods.
- Refrigerator width matters: a single ~30-36" box tagged REF or F is "fridge". A wider ~60-72" footprint, or two adjacent appliance boxes/tags at that fixture (commonly a pair like "F" + "R" for freezer + refrigerator, or "REF/FRZ") is one double-wide unit — report it as "fridgeXL", not two separate fridges.
- A freestanding rectangle apart from the perimeter walls with counter/cabinet symbols around its edge is a kitchen island — report it under "island" (width = its long dimension in inches, depth = its short dimension). If a sink symbol (a basin outline, or two basins side by side with a shared faucet mark = a double-bowl sink) sits on the island, set island.sink=true; if the island doesn't have a sink or you don't see one, omit the sink key rather than guessing.
- Cabinets are drawn as a double-ruled rectangle along the wall (indicating real depth, ~12-24"), often with a door-swing diagonal or drawer-front hash marks. Floating/open shelving is drawn much shallower — a single thin line or a shallow ledge with no door-swing mark, sometimes labeled "OPEN SHLVG" or "FLOATING SHELF" on the sheet's notes or legend. Don't count open shelving as a fixture slot below; just call it out by wall in "notes" so a person can add it by hand.
- sourcePage: if the image for this room was preceded by a caption like "Page 3 — likely...", echo that page number here as an integer. Omit if you can't tell.
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

  /* the client now batches into small groups per request (6 at a time) so a
     large plan set can't produce a payload/output big enough to time out or
     get truncated — this cap just guards against a stray oversized request */
  if (!files.length || files.length > 10)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Send 1–10 room images/pages per request — the client should be batching automatically.' }) };

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
