const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Source 1: tikwm API
async function fetchFromTikwm(username) {
  const res = await fetch(
    `https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(username)}`,
    { headers: { 'User-Agent': UA, 'Referer': 'https://www.tikwm.com/' } }
  );
  if (!res.ok) throw new Error(`tikwm HTTP ${res.status}`);
  const json = await res.json();
  if (!json?.data?.user) throw new Error('tikwm: no user');
  const u = json.data.user;
  // Try all known field names (tikwm uses both camelCase and snake_case)
  const rawAvatar =
    u.avatarHd || u.avatar_hd ||
    u.avatarLarger || u.avatar_larger ||
    u.avatarMedium || u.avatar_medium ||
    u.avatarThumb || u.avatar_thumb ||
    u.avatar || '';
  return {
    username: u.unique_id || username,
    nickname: u.nickname || u.unique_id || username,
    rawAvatar,
  };
}

// Source 2: scrape TikTok public page
async function fetchFromTikTokPage(username) {
  const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html' }
  });
  if (!res.ok) throw new Error(`tiktok-page HTTP ${res.status}`);
  const html = await res.text();
  let avatarUrl = '', nickname = '', uniqueId = username;
  const m1 = html.match(/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (m1) {
    try {
      const data = JSON.parse(m1[1]);
      const detail =
        data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user ||
        data?.__DEFAULT_SCOPE__?.['seo.user-detail']?.userInfo?.user;
      if (detail) {
        avatarUrl = detail.avatarLarger || detail.avatarMedium || detail.avatarThumb || '';
        nickname = detail.nickname || '';
        uniqueId = detail.uniqueId || username;
      }
    } catch { }
  }
  if (!avatarUrl) {
    const m2 = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
    if (m2) avatarUrl = m2[1];
  }
  if (!avatarUrl) throw new Error('tiktok-page: no avatar');
  return { username: uniqueId, nickname: nickname || uniqueId, rawAvatar: avatarUrl };
}

// Debug endpoint
app.get('/api/tiktok/debug/:username', async (req, res) => {
  const username = String(req.params.username || '').replace(/^[@$]+/, '').trim();
  const log = [];
  try {
    const r = await fetch(`https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(username)}`,
      { headers: { 'User-Agent': UA, 'Referer': 'https://www.tikwm.com/' } });
    const text = await r.text();
    log.push({ source: 'tikwm-api', status: r.status, body: text.slice(0, 500) });
  } catch (e) { log.push({ source: 'tikwm-api', error: e.message }); }
  res.json({ username, log });
});

// Main profile route — returns raw CDN URL so browser can load it directly
app.get('/api/tiktok/profile/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '').replace(/^[@$]+/, '').trim();
    if (!username) return res.json({ success: false });

    let resolvedUsername = username;
    let resolvedNickname = username;
    let rawAvatar = '';

    // Step 1: tikwm
    try {
      const tikwm = await fetchFromTikwm(username);
      resolvedUsername = tikwm.username;
      resolvedNickname = tikwm.nickname;
      rawAvatar = tikwm.rawAvatar;
      console.log(`[TikTok] @${username} nickname="${resolvedNickname}" avatar="${rawAvatar.slice(0, 80)}"`);
    } catch (e) {
      console.warn(`[TikTok] tikwm failed: ${e.message}`);
    }

    // Step 2: fallback to page scrape
    if (!rawAvatar) {
      try {
        const page = await fetchFromTikTokPage(resolvedUsername);
        rawAvatar = page.rawAvatar;
        resolvedNickname = resolvedNickname || page.nickname;
        console.log(`[TikTok] @${username} page avatar="${rawAvatar.slice(0, 80)}"`);
      } catch (e) {
        console.warn(`[TikTok] page scrape failed: ${e.message}`);
      }
    }

    // Return raw CDN URL — browser will load it directly (not blocked for browsers)
    return res.json({
      success: true,
      data: {
        username: resolvedUsername,
        nickname: resolvedNickname,
        avatar: rawAvatar  // direct TikTok CDN URL
      }
    });

  } catch (err) {
    console.error('Profile API Error:', err);
    res.status(500).json({ success: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));