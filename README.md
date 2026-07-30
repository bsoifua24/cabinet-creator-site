# Cabinet Creator — deploy guide (5 minutes)

## What this is
A plug-and-play cabinet design site:
- **Import plans** — clients drop in a full architect PDF set (not cropped
  screenshots); the site scans every page, decides where in the home cabinets
  are needed (kitchens, baths, laundry/mud rooms, closets, pantries, wet bars,
  built-ins), then re-reads just those areas at high resolution to extract
  wall dimensions. See "How the AI takeoff works" below.
- **Designer** — anyone can also build rooms by hand: shapes, wall lengths,
  fixtures, door styles, colors, countertops, sinks; with plan / elevation /
  3D views, a cabinet schedule, and a printable drawing set for shop pricing.

## Deploy to Netlify
1. Go to https://app.netlify.com → "Add new site" → "Deploy manually"
   and drag THIS WHOLE FOLDER (not just index.html) onto the page.
2. In the new site: Site configuration → Environment variables → Add:
      Key:   ANTHROPIC_API_KEY
      Value: (your key from https://console.anthropic.com → API keys)
3. Trigger a redeploy (Deploys → "Trigger deploy") so the variable takes effect.
4. Open the site URL — the Analyze button now works for anyone, no key needed.

## How the AI takeoff works
Two passes, both server-side (netlify/functions/):
1. **locate.js** — every PDF page is rendered in the browser (via PDF.js) to a
   low-res thumbnail and sent in one batch. The model scans the whole set and
   returns which pages have a cabinet-bearing space and roughly where on the
   page (kitchens/baths/laundry obviously, but also wet bars, mudrooms,
   pantries, office built-ins, etc.) — this is the "think about where in the
   home cabinets are needed" step, not just the 4 labeled room types.
2. **takeoff.js** — the browser re-renders just those specific pages at much
   higher resolution, crops tightly to the region locate.js found, and sends
   those crops back for the actual dimension read-off. This is why you don't
   have to screenshot/crop pages yourself: the site does the same "zoom into
   just the kitchen plan" step you'd otherwise do by hand, at whatever DPI is
   needed to read small dimension text — a raw multi-room architectural sheet
   sent as one flat PDF is usually too low-res internally for the model to
   read fine print.
Directly-uploaded image files (not PDFs) skip pass 1 and go straight to
pass 2, same as before.

## Troubleshooting
- **"Analyze plans" does nothing / shows an unreachable-service message** —
  you're almost certainly opening `index.html` locally (the address bar shows
  `file:///...`). The AI takeoff calls a serverless function, which only
  exists on your deployed Netlify URL (`https://your-site.netlify.app`).
  Open that instead. (The Designer, 3D view, etc. are pure client-side JS and
  work fine from a local file — only the AI takeoff needs the live site.)
- **500 error / "ANTHROPIC_API_KEY is not set"** — you deployed but skipped
  step 2, or added the key without redeploying afterward (step 3).
- Local testing without deploying: open Import → Advanced → paste a personal
  API key. It's stored only in your browser and used for direct calls from
  the page — fine for testing, not for sharing with clients (they'd need
  their own key). The deployed function is what lets visitors use it with
  no key of their own.

## Notes
- The key lives only on Netlify's server (netlify/functions/*.js).
  Visitors never see it.
- Each analysis costs a few cents of API usage on your key (two model calls
  per takeoff: locate + extract). Netlify's free tier covers the hosting and
  function calls at this scale.
- The manual Designer works even with no key set — only the AI takeoff needs it.
- All AI-read dimensions are preliminary; the review step exists so a person
  verifies before drawings go out for pricing.
