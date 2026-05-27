const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

// YOURS. CONFIG
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.APP_URL || 'https://yours-social.com';

// YOU. CONFIG
const YOU_SUPABASE_URL = process.env.YOU_SUPABASE_URL;
const YOU_SUPABASE_KEY = process.env.YOU_SUPABASE_KEY;
const YOU_RESEND_KEY = process.env.YOU_RESEND_KEY || process.env.RESEND_API_KEY;
const YOU_APP_URL = process.env.YOU_APP_URL || 'https://you-app.onrender.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const youSupabase = YOU_SUPABASE_URL && YOU_SUPABASE_KEY ? createClient(YOU_SUPABASE_URL, YOU_SUPABASE_KEY) : null;
const resend = new Resend(RESEND_API_KEY);
const youResend = new Resend(YOU_RESEND_KEY);
const settleCodes = {};

async function readBody(req) {
  return new Promise((res, rej) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => res(body));
    req.on('error', rej);
  });
}

async function hashPwd(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, buf) => {
      if (err) reject(err);
      else resolve(buf.toString('hex'));
    });
  });
}

async function hashPwdSimple(pwd, salt) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(salt + ':' + pwd));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// YOURS. DB
async function dbGet(key) {
  const { data } = await supabase.from('store').select('value').eq('key', key).single();
  return data ? data.value : null;
}
async function dbSet(key, value) {
  await supabase.from('store').upsert({ key, value });
}
async function dbDel(key) {
  await supabase.from('store').delete().eq('key', key);
}

// YOU. WEEKLY QUESTIONS
const WEEKLY_QUESTIONS = [
  "what's been sitting with you this week that you haven't said out loud?",
  "what did you avoid this week — and what does that tell you?",
  "what moment this week felt most like you?",
  "what would you tell yourself from seven days ago?",
  "what are you carrying that isn't yours to carry?",
  "what did you learn about yourself this week?",
  "what small thing made a difference this week?",
  "where did you feel most at peace this week?",
  "what did you want this week that you didn't let yourself have?",
  "what's one thing you'd do differently if you had this week again?",
  "what are you pretending is fine when it isn't?",
  "what surprised you about yourself this week?",
];
function getWeeklyQuestion() {
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return WEEKLY_QUESTIONS[week % WEEKLY_QUESTIONS.length];
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ==================
  // YOURS. ENDPOINTS
  // ==================

  if (pathname === '/db/get') {
    const key = parsed.query.key;
    if (!key) { res.writeHead(400); res.end('missing key'); return; }
    const val = await dbGet(key);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(val || 'null');
    return;
  }

  if (pathname === '/db/set' && req.method === 'POST') {
    const body = await readBody(req);
    let parsed2;
    try { parsed2 = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    await dbSet(parsed2.key, parsed2.value);
    res.writeHead(200); res.end('ok');
    return;
  }

  if (pathname === '/db/del' && req.method === 'DELETE') {
    const key = parsed.query.key;
    if (key) await dbDel(key);
    res.writeHead(200); res.end('ok');
    return;
  }

  if (pathname === '/forgot-password' && req.method === 'POST') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    const email = (data.email || '').toLowerCase().trim();
    if (!email) { res.writeHead(400); res.end('missing email'); return; }
    const users = await dbGet('users:by:email') || {};
    const username = users[email];
    if (!username) { res.writeHead(200); res.end('ok'); return; }
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expires = Date.now() + 3600000;
    await dbSet('reset:' + token, JSON.stringify({ username, expires }));
    await resend.emails.send({
      from: 'yours. <onboarding@resend.dev>',
      to: email,
      subject: 'Reset your yours. password',
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:40px 20px;"><h2 style="font-family:Georgia,serif;font-size:32px;margin-bottom:8px;">yours.</h2><p style="color:#888;margin-bottom:32px;">share with the people who actually matter.</p><p>Someone requested a password reset for your account <strong>@${username}</strong>.</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><a href="${APP_URL}/reset-password?token=${token}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#1A1917;color:white;text-decoration:none;border-radius:8px;">Reset Password</a><p style="color:#888;font-size:13px;">If you didn't request this, ignore this email.</p></div>`
    });
    res.writeHead(200); res.end('ok');
    return;
  }

  if (pathname === '/reset-password' && req.method === 'POST') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    const { token, password } = data;
    if (!token || !password) { res.writeHead(400); res.end('missing fields'); return; }
    const resetData = await dbGet('reset:' + token);
    if (!resetData) { res.writeHead(400); res.end('invalid token'); return; }
    let parsed3;
    try { parsed3 = JSON.parse(resetData); } catch { res.writeHead(400); res.end('bad token'); return; }
    if (Date.now() > parsed3.expires) { res.writeHead(400); res.end('expired'); return; }
    const ud = await dbGet('user:' + parsed3.username);
    if (!ud) { res.writeHead(400); res.end('user not found'); return; }
    const salt = Math.random().toString(36);
    const hashedPwd = await hashPwdSimple(password, salt);
    ud.password = hashedPwd;
    ud.salt = salt;
    await dbSet('user:' + parsed3.username, ud);
    await dbDel('reset:' + token);
    res.writeHead(200); res.end('ok');
    return;
  }

  if (pathname === '/reset-password') {
    const token = parsed.query.token;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset Password — yours.</title><style>body{font-family:'Georgia',serif;background:#FAF9F7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}.box{width:100%;max-width:360px;padding:2rem;}h1{font-size:36px;margin-bottom:6px;}p{color:#888;font-size:14px;margin-bottom:32px;}input{width:100%;padding:11px 14px;border:1px solid #E8E6E1;border-radius:8px;font-size:14px;margin-bottom:14px;box-sizing:border-box;font-family:sans-serif;}button{width:100%;padding:13px;background:#1A1917;color:white;border:none;border-radius:8px;font-size:15px;cursor:pointer;}.msg{font-size:13px;margin-top:10px;text-align:center;color:#C0392B;}.msg.success{color:#2D5A27;}</style></head><body><div class="box"><h1>yours.</h1><p>choose a new password.</p><input type="password" id="pwd" placeholder="new password" minlength="4"><input type="password" id="pwd2" placeholder="confirm password"><button onclick="reset()">reset password</button><div class="msg" id="msg"></div></div><script>async function reset(){const p=document.getElementById('pwd').value;const p2=document.getElementById('pwd2').value;const msg=document.getElementById('msg');if(p.length<4){msg.textContent='password must be at least 4 characters';return;}if(p!==p2){msg.textContent='passwords do not match';return;}const r=await fetch('/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'${token}',password:p})});if(r.ok){msg.className='msg success';msg.textContent='password reset — you can now sign in.'}else{msg.textContent='this link has expired. please request a new one.';}}</script></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  if (pathname === '/send-settle-code' && req.method === 'POST') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    const email = (data.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) { res.writeHead(400); res.end('invalid email'); return; }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    settleCodes[email] = { code, expires: Date.now() + 600000 };
    await resend.emails.send({
      from: 'settle. <onboarding@resend.dev>',
      to: email,
      subject: `your settle. code: ${code}`,
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:40px 20px;background:#F7F3EE;"><h2 style="font-family:Georgia,serif;font-size:28px;color:#1A1108;margin-bottom:4px;">settle.</h2><p style="color:#9A8878;margin-bottom:32px;font-size:14px;">you chose to go back. that's okay.</p><p style="font-size:14px;color:#1A1108;margin-bottom:16px;">your code is:</p><div style="font-size:48px;font-weight:300;color:#C47A3A;letter-spacing:8px;margin-bottom:24px;">${code}</div><p style="font-size:13px;color:#9A8878;">this code expires in 10 minutes.</p><p style="font-size:12px;color:#C0B0A0;margin-top:24px;">settle. doesn't analyse you. it just listens.</p></div>`
    });
    res.writeHead(200); res.end('ok');
    return;
  }

  if (pathname === '/verify-settle-code' && req.method === 'POST') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    const email = (data.email || '').toLowerCase().trim();
    const code = (data.code || '').trim();
    const stored = settleCodes[email];
    if (!stored) { res.writeHead(400); res.end('no code'); return; }
    if (Date.now() > stored.expires) { delete settleCodes[email]; res.writeHead(400); res.end('expired'); return; }
    if (stored.code !== code) { res.writeHead(400); res.end('wrong code'); return; }
    delete settleCodes[email];
    res.writeHead(200); res.end('ok');
    return;
  }

  // ==================
  // YOU. ENDPOINTS
  // ==================

  if (pathname === '/you/signup' && req.method === 'POST') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    const email = (data.email || '').toLowerCase().trim();
    const password = data.password || '';
    if (!email || !email.includes('@')) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid email' })); return; }
    if (password.length < 6) { res.writeHead(400); res.end(JSON.stringify({ error: 'password must be at least 6 characters' })); return; }
    const { data: existing } = await youSupabase.from('users').select('id').eq('email', email).single();
    if (existing) { res.writeHead(400); res.end(JSON.stringify({ error: 'an account with that email already exists' })); return; }
    const salt = crypto.randomBytes(32).toString('hex');
    const hashed = await hashPwd(password, salt);
    const { data: user, error } = await youSupabase.from('users').insert({ email, password: hashed, salt }).select().single();
    if (error) { res.writeHead(500); res.end(JSON.stringify({ error: 'could not create account' })); return; }
    const token = Buffer.from(JSON.stringify({ id: user.id, email, ts: Date.now() })).toString('base64');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token, userId: user.id, email }));
    return;
  }

  if (pathname === '/you/login' && req.method === 'POST') {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    const email = (data.email || '').toLowerCase().trim();
    const password = data.password || '';
    const { data: user } = await youSupabase.from('users').select('*').eq('email', email).single();
    if (!user) { res.writeHead(401); res.end(JSON.stringify({ error: 'email or password incorrect' })); return; }
    const hashed = await hashPwd(password, user.salt);
    if (hashed !== user.password) { res.writeHead(401); res.end(JSON.stringify({ error: 'email or password incorrect' })); return; }
    const token = Buffer.from(JSON.stringify({ id: user.id, email, ts: Date.now() })).toString('base64');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token, userId: user.id, email, premium: user.premium }));
    return;
  }

  // YOU. AUTH MIDDLEWARE
  let youUser = null;
  const authHeader = req.headers['authorization'] || '';
  const youToken = authHeader.replace('Bearer ', '');
  if (youToken && pathname.startsWith('/you/')) {
    try {
      const decoded = JSON.parse(Buffer.from(youToken, 'base64').toString());
      const { data: user } = await youSupabase.from('users').select('*').eq('id', decoded.id).single();
      if (user) youUser = user;
    } catch {}
  }

  if (pathname === '/you/answers' && req.method === 'POST') {
    if (!youUser) { res.writeHead(401); res.end(JSON.stringify({ error: 'not authenticated' })); return; }
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    const { questionId, answer } = data;
    if (!questionId || !answer) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing fields' })); return; }
    const { data: existing } = await youSupabase.from('entries').select('id').eq('user_id', youUser.id).eq('question_id', questionId).single();
    if (existing) {
      await youSupabase.from('entries').update({ answer, updated_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await youSupabase.from('entries').insert({ user_id: youUser.id, question_id: questionId, answer });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (pathname === '/you/answers' && req.method === 'GET') {
    if (!youUser) { res.writeHead(401); res.end(JSON.stringify({ error: 'not authenticated' })); return; }
    const { data: entries } = await youSupabase.from('entries').select('*').eq('user_id', youUser.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entries || []));
    return;
  }

  if (pathname === '/you/weekly' && req.method === 'POST') {
    if (!youUser) { res.writeHead(401); res.end(JSON.stringify({ error: 'not authenticated' })); return; }
    const question = getWeeklyQuestion();
    await youResend.emails.send({
      from: 'you. <onboarding@resend.dev>',
      to: youUser.email,
      subject: 'your weekly question.',
      html: `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:48px 24px;background:#F5F0E8;"><div style="font-size:32px;color:#1C1510;margin-bottom:4px;">you.</div><div style="font-size:13px;color:#8A7A68;margin-bottom:48px;">your weekly question.</div><div style="font-size:20px;color:#1C1510;line-height:1.6;margin-bottom:32px;font-style:italic;">"${question}"</div><div style="font-size:13px;color:#B8AA98;line-height:1.7;">no pressure to answer now.<br>sit with it. come back when it feels right.</div><div style="margin-top:48px;padding-top:24px;border-top:1px solid #E0D5C4;"><a href="${YOU_APP_URL}" style="font-size:13px;color:#C47A3A;text-decoration:none;">open you. →</a></div></div>`
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (pathname === '/you/seasonal' && req.method === 'POST') {
    if (!youUser) { res.writeHead(401); res.end(JSON.stringify({ error: 'not authenticated' })); return; }
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: oldEntries } = await youSupabase.from('entries').select('*').eq('user_id', youUser.id).lt('updated_at', threeMonthsAgo).limit(3);
    if (!oldEntries || oldEntries.length === 0) { res.writeHead(200); res.end(JSON.stringify({ message: 'not enough history yet' })); return; }
    const entriesHtml = oldEntries.map(e => `<div style="margin-bottom:24px;padding:16px;background:#FDFAF5;border-radius:8px;border-left:3px solid #C47A3A;"><div style="font-size:12px;color:#B8AA98;margin-bottom:6px;">three months ago you wrote:</div><div style="font-size:15px;color:#1C1510;line-height:1.6;font-style:italic;">"${e.answer}"</div></div>`).join('');
    await youResend.emails.send({
      from: 'you. <onboarding@resend.dev>',
      to: youUser.email,
      subject: 'three months ago, you wrote this.',
      html: `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:48px 24px;background:#F5F0E8;"><div style="font-size:32px;color:#1C1510;margin-bottom:4px;">you.</div><div style="font-size:13px;color:#8A7A68;margin-bottom:48px;">a reflection from three months ago.</div>${entriesHtml}<div style="font-size:16px;color:#1C1510;line-height:1.6;margin-top:32px;font-style:italic;">"what would you add today?"</div><div style="margin-top:48px;padding-top:24px;border-top:1px solid #E0D5C4;"><a href="${YOU_APP_URL}" style="font-size:13px;color:#C47A3A;text-decoration:none;">open you. →</a></div></div>`
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (pathname === '/you/anniversary' && req.method === 'POST') {
    if (!youUser) { res.writeHead(401); res.end(JSON.stringify({ error: 'not authenticated' })); return; }
    const joined = new Date(youUser.joined);
    const years = new Date().getFullYear() - joined.getFullYear();
    const { data: firstEntry } = await youSupabase.from('entries').select('*').eq('user_id', youUser.id).order('updated_at', { ascending: true }).limit(1).single();
    const { count } = await youSupabase.from('entries').select('*', { count: 'exact', head: true }).eq('user_id', youUser.id);
    await youResend.emails.send({
      from: 'you. <onboarding@resend.dev>',
      to: youUser.email,
      subject: `${years} year${years > 1 ? 's' : ''} of you.`,
      html: `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:48px 24px;background:#F5F0E8;"><div style="font-size:32px;color:#1C1510;margin-bottom:4px;">you.</div><div style="font-size:13px;color:#8A7A68;margin-bottom:48px;">${years} year${years > 1 ? 's' : ''} of honest reflection.</div><div style="font-size:18px;color:#1C1510;line-height:1.6;margin-bottom:24px;">you've written ${count || 0} answer${count !== 1 ? 's' : ''} in that time.</div>${firstEntry ? `<div style="margin-bottom:24px;padding:16px;background:#FDFAF5;border-radius:8px;border-left:3px solid #C47A3A;"><div style="font-size:12px;color:#B8AA98;margin-bottom:6px;">the first thing you ever wrote:</div><div style="font-size:15px;color:#1C1510;line-height:1.6;font-style:italic;">"${firstEntry.answer}"</div></div>` : ''}<div style="font-size:15px;color:#8A7A68;line-height:1.7;">that took something. most people never look this honestly at themselves.<br><br>keep going.</div><div style="margin-top:48px;padding-top:24px;border-top:1px solid #E0D5C4;"><a href="${YOU_APP_URL}" style="font-size:13px;color:#C47A3A;text-decoration:none;">open you. →</a></div></div>`
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // SERVE YOURS. FRONTEND
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Build Better Days server running on port ${PORT}`));
