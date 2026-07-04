/* =============================================
   ECHO — /api/gemini-token
   Vercel Serverless Function

   Purpose: mint a short-lived Gemini Live ephemeral token so the
   developer's real Gemini API key NEVER reaches the browser.

   Flow:
     Frontend (Talk To Me AI Free)
        -> POST /api/gemini-token   (this function)
        -> Google AuthTokenService.CreateToken  (uses GEMINI_API_KEY, server-side only)
        -> returns { token } to the frontend
        -> frontend opens a WebSocket straight to Gemini Live using
           that ephemeral token (not the real key).

   Setup on Vercel:
     1. In your Vercel project → Settings → Environment Variables,
        add GEMINI_API_KEY = <your real Gemini API key>.
     2. Deploy. Vercel auto-detects any file under /api as a
        serverless function — no extra config needed.

   No auth, no rate limiting, no quotas here by design (per request).
   Anyone who can load your site can call this endpoint and get a
   token — add limits later if you need to control cost.
   ============================================= */

export default async function handler(req, res) {
  // Basic CORS so this also works if the frontend is ever hosted
  // on a different origin than the Vercel deployment.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set as a Vercel environment variable.');
    res.status(500).json({ error: 'AI Tutor is not configured on the server yet.' });
    return;
  }

  try {
    const now = Date.now();
    // The token itself is valid for 30 minutes...
    const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
    // ...but the client must OPEN the session within 60 seconds of
    // getting the token, otherwise it's rejected. That's fine here
    // since we mint it right before connecting.
    const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

    const googleResp = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/authTokens?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authToken: {
            uses: 1,
            expireTime,
            newSessionExpireTime,
          },
        }),
      }
    );

    const data = await googleResp.json();

    if (!googleResp.ok) {
      console.error('Google AuthTokenService error:', data);
      res.status(googleResp.status).json({
        error: (data && data.error && data.error.message) || 'Could not create an AI Tutor session token.',
      });
      return;
    }

    // `data.name` is the ephemeral token, e.g. "auth_tokens/AbCdEf..."
    res.status(200).json({ token: data.name });
  } catch (err) {
    console.error('gemini-token function error:', err);
    res.status(500).json({ error: 'Unexpected server error while creating the AI Tutor session.' });
  }
}