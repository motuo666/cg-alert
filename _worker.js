// _worker.js — Cloudflare Pages Functions 版 301
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 根域 → www（保留路径和查询参数；强制 https）
    if (url.hostname === 'cg-alert.com') {
      url.protocol = 'https:';             // http -> https
      url.hostname = 'www.cg-alert.com';   // apex -> www
      return Response.redirect(url.toString(), 301);
    }
    // 其他照常由 Pages 静态资源服务
    return env.ASSETS.fetch(request);
  }
}
