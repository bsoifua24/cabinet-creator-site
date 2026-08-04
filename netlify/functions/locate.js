/* Cabinet Creator — plan locate function (pass 1: find cabinet-bearing spaces).
   Scans low-res thumbnails of every page in the drawing set and reports which
   pages (and which region of each page) contain a space that needs cabinetry,
   so the browser can re-render just those pages at high resolution for pass 2
   (netlify/functions/takeoff.js) instead of the user having to crop pages by hand.
   Runs on Netlify's servers so the API key never reaches the browser.
   Setup: in the Netlify dashboard → Site settings → Environment variables,
   add ANTHROPIC_API_KEY with your key from console.anthropic.com. */

const LOCATE_PROMPT = `You are a cabinet-industry estimator scanning a full residential construction drawing set (every page attached, in order) to find every place in the home that would need built-in cabinetry.

Think like an estimator walking the whole plan, not just the obviously-labeled rooms. Flag:
- Kitchens, bathrooms (incl. powder rooms), laundry/mud rooms, closets, pantries — the obvious ones.
- Anywhere else a cabinet shop would typically quote built-ins: wet bars, butler's pantries, mudroom lockers/benches, home-office built-ins, entry consoles, media-wall/entertainment built-ins, garage or basement storage walls, linen closets, wine storage.
- Skip spaces with no built-in cabinetry shown (bedrooms with no closet detail, open living rooms, garages with nothing built in, cover sheets, elevations/sections with no plan view).

Respond with ONLY valid JSON, no markdown fences, no commentary:
{"hits":[
  {"page":3,"name":"Kitchen","type":"kitchen","bbox":[0.04,0.58,0.49,0.94]},
  {"page":3,"name":"Mudroom","type":"closet","bbox":[0.52,0.60,0.71,0.90]}
]}
Rules:
- "page" is the 1-indexed page number among the images given, in the order given.
- "type" is whichever of these four the space is CLOSEST to for layout purposes — pick the nearest fit, don't invent new types:
  kitchen (sink+range/fridge run, or a wet bar/butler's pantry with a sink),
  bath (vanity/sink + fixtures, incl. powder rooms),
  laundry (washer/dryer/utility sink),
  closet (built-in storage with no plumbing fixture — pantries, mudroom lockers, linen, office built-ins, media walls, garage storage).
- "bbox" is normalized [x0,y0,x1,y1], 0–1 fractions of the full page image. Locate the building's exterior wall outline first, then draw the box tight around ONLY that room's actual walls and fixtures — its edges should land on or just inside the nearest wall lines. NEVER let the box extend past the exterior wall into blank page margin, the title block, a dimension string, or a notes/schedule column outside the structure. If you're not sure exactly where a wall falls, err smaller/tighter, not generous — a box that's a little too small still points a person to the right room; a box drifting into empty space outside the house is actively wrong and wastes their time re-locating it.
- Include a space even if you're not fully certain about its type or extent — a person reviews every result before anything is priced. Uncertainty about WHAT a room is is fine to flag; a box floating outside the building is not.`;

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

  if (!files.length || files.length > 60)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Send 1–60 page thumbnails.' }) };

  const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const content = [];
  for (const f of files) {
    if (!OK_TYPES.includes(f.media_type) || typeof f.data !== 'string')
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported file type — locate expects rendered page images, not raw PDFs.' }) };
    if (f.caption && typeof f.caption === 'string')
      content.push({ type: 'text', text: f.caption.slice(0, 300) });
    content.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
  }
  content.push({ type: 'text', text: LOCATE_PROMPT });

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
        max_tokens: 2000,
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
