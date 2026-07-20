// _middleware.js - 全局中间件
function getCorsOrigin(env) {
  // 优先使用环境变量配置的域名，默认放行同源请求
  const allowedOrigin = (env && env.CORS_ORIGIN) || '';
  return allowedOrigin || '*';
}

function getCorsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(env),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key',
    'Vary': 'Origin',
  };
}

// 限流器
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 10000;
const RATE_LIMIT_TTL = 60000;

function checkRateLimit(key, max = 60, windowSec = 60) {
  const now = Date.now();
  if (rateLimitMap.size > RATE_LIMIT_MAX) rateLimitMap.clear();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.reset > windowSec * 1000) {
    rateLimitMap.set(key, { count: 1, reset: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const corsHeaders = getCorsHeaders(env);
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  const url = new URL(request.url);
  
  // Rate limiting for API routes
  if (url.pathname.startsWith('/api/')) {
    const ip = request.headers.get('CF-Connecting-IP') ||
               request.headers.get('X-Forwarded-For') ||
               'unknown';
    const routeKey = url.pathname.split('/')[3] || 'api';
    const isAuth = url.pathname.includes('/auth/');
    const max = isAuth ? 10 : 60;
    if (!checkRateLimit(ip + ':' + routeKey, max)) {
      return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  
  const response = await next();
  
  // Add CORS headers to all responses
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
