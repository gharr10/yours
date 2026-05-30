const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.APP_URL || 'https://yours-social.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const resend = new Resend(RESEND_API_KEY);
const settleCodes = {};

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
async function readBody(req) {
  return new Promise((res, rej) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => res(body));
    req.on('error', rej);
  });
}
async function hashPwd(pwd, salt) {
  return new Promise((resolve, reject) => {
    require('crypto').pbkdf2(pwd, salt, 1000, 32, 'sha256', (err, buf) => {
      if (err) reject(err);
      else resolve(buf.toString('hex'));
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:40px 20px;"><h2 style="font-family:Georgia,serif;font-size:32px;margin-bottom:8px;">yours.</h2><p style="color:#888;margin-bottom:32px;">share with the people who actually matter.</p><p>Someone requested a password reset for your account <strong>@${username}</strong>.</p><a href="${APP_URL}/reset-password?token=${token}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#1A1917;color:white;text-decoration:none;border-radius:8px;">Reset Password</a><p style="color:#888;font-size:13px;">If you didn't request this, ignore this email.</p></div>`
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
    const salt = require('crypto').randomBytes(16).toString('hex');
    const hashedPwd = await hashPwd(password, salt);
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
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:40px 20px;background:#F7F3EE;"><h2 style="font-family:Georgia,serif;font-size:28px;color:#1A1108;margin-bottom:4px;">settle.</h2><p style="color:#9A8878;margin-bottom:32px;font-size:14px;">you chose to go back. that's okay.</p><div style="font-size:48px;font-weight:300;color:#C47A3A;letter-spacing:8px;margin-bottom:24px;">${code}</div><p style="font-size:13px;color:#9A8878;">this code expires in 10 minutes.</p></div>`
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

  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`yours. running on port ${PORT}`));
