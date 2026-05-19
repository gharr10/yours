const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { createClient } = require('@supabase/supabase-js');
console.log('Full URL:', SUPABASE_URL);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function dbGet(key) {
  const { data } = await supabase
    .from('store')
    .select('value')
    .eq('key', key)
    .single();
  return data ? data.value : null;
}

async function dbSet(key, value) {
  console.log('dbSet called:', key);
  const { error } = await supabase
    .from('store')
    .upsert({ key, value });
  if (error) console.log('dbSet error:', error.message);
}

async function dbDel(key) {
  await supabase
    .from('store')
    .delete()
    .eq('key', key);
}

async function readBody(req) {
  return new Promise((res, rej) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => res(body));
    req.on('error', rej);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`yours. running on port ${PORT}`));
