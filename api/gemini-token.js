/* =============================================
   ECHO — /api/gemini-token
   Vercel Serverless Function

   Purpose: mint a short-lived Gemini Live ephemeral token so the
   developer's real Gemini API key NEVER reaches the browser.

   Uses the official @google/genai SDK (client.authTokens.create()),
   which is the path Google documents and maintains — it's the most
   likely to keep working as the Live API evolves, and it handles the
   HTTP response parsing internally instead of us doing it by hand.

   Flow:
     Frontend (Talk To Me AI Free)
        -> POST /api/gemini-token   (this function)
        -> @google/genai -> AuthTokenService.CreateToken (GEMINI_API_KEY, server-side only)
        -> returns { token } to the frontend
        -> frontend opens a WebSocket straight to Gemini Live using
           that ephemeral token (not the real key).

   Setup on Vercel:
     1. Add "@google/genai" as a dependency (see package.json).
     2. In your Vercel project → Settings → Environment Variables,
        add GEMINI_API_KEY = <your real Gemini API key>.
     3. Deploy. Vercel auto-detects any file under /api as a
        serverless function — no extra config needed.

   No auth, no rate limiting, no quotas here by design (per request).
   Anyone who can load your site can call this endpoint and get a
   token — add limits later if you need to control cost.
   ============================================= */

import { GoogleGenAI } from '@google/genai';

// Restricted to the production domain — change this if you deploy
// the frontend somewhere else (e.g. a custom domain).
const ALLOWED_ORIGIN = 'https://ai-talk-tutor.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
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
    const client = new GoogleGenAI({ apiKey });

    const now = Date.now();
    // The token itself is valid for 30 minutes...
    const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
    // ...but the client must OPEN the session within 60 seconds of
    // getting the token, otherwise it's rejected. That's fine here
    // since we mint it right before connecting.
    const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        httpOptions: { apiVersion: 'v1alpha' },
      },
    });

    if (!token || !token.name) {
      throw new Error('Google returned an empty token.');
    }

    // token.name looks like "auth_tokens/AbCdEf..."
    res.status(200).json({ token: token.name });
  } catch (err) {
    console.error('gemini-token function error:', err);
    const message = (err && err.message) || 'Unexpected server error while creating the AI Tutor session.';
    res.status(500).json({ error: message });
  }
}