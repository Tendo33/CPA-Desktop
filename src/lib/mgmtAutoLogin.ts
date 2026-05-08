/**
 * Build a self-contained JS string that, when `eval()`-ed inside the
 * management.html webview, populates localStorage so the management
 * panel auto-logs-in with the user's secret key.
 *
 * The mechanism mirrors what the upstream
 * `Cli-Proxy-API-Management-Center` zustand `useAuthStore` does:
 *   - `cli-proxy-auth` holds the persisted auth state, XOR-obfuscated
 *     and base64-encoded under the prefix `enc::v1::`
 *   - `isLoggedIn` is set to `'true'` so `restoreSession()` triggers
 *     auto-login on next page boot
 *
 * The XOR key is derived from `cli-proxy-api-webui::secure-storage|<host>|<UA>`,
 * read at runtime from `window.location.host` and `navigator.userAgent`.
 * Doing the obfuscation *inside* the webview avoids any host/UA mismatch
 * between the desktop app and the loaded panel.
 *
 * After writing storage, the script reloads the page so zustand's persist
 * middleware picks up the new state on the second boot.
 */
export function buildMgmtAutoLoginScript(opts: { apiBase: string; secretKey: string }): string {
  const payload = JSON.stringify({
    state: {
      apiBase: opts.apiBase,
      managementKey: opts.secretKey,
      rememberPassword: true,
      serverVersion: null,
      serverBuildDate: null,
    },
    version: 0,
  })

  // Embed the payload as a JSON string literal so it survives eval.
  const payloadLit = JSON.stringify(payload)

  // Single-statement IIFE — easier to log if it throws inside the webview.
  return `(function(){
  function report(status,message){
    var payload={status:status,message:message||''};
    window.__CPA_DESKTOP_AUTO_LOGIN_STATUS__=payload;
    try{
      var tauri=window.__TAURI__&&window.__TAURI__.event;
      if(tauri&&typeof tauri.emit==='function'){tauri.emit('cpa:auto-login-status',payload);}
    }catch(_){}
  }
  try{
    report('pending','');
    var SECRET_SALT='cli-proxy-api-webui::secure-storage';
    var ENC_PREFIX='enc::v1::';
    var STORAGE_KEY='cli-proxy-auth';
    var alreadySet=false;
    try{
      var existing=localStorage.getItem(STORAGE_KEY);
      if(existing && existing.indexOf(ENC_PREFIX)===0){alreadySet=true;}
    }catch(_){}
    if(localStorage.getItem('isLoggedIn')==='true' && alreadySet){report('ok','');return;}
    var host=window.location.host;
    var ua=navigator.userAgent;
    var keyStr=SECRET_SALT+'|'+host+'|'+ua;
    var enc=new TextEncoder();
    var keyBytes=enc.encode(keyStr);
    var dataBytes=enc.encode(${payloadLit});
    var out=new Uint8Array(dataBytes.length);
    for(var i=0;i<dataBytes.length;i++){out[i]=dataBytes[i]^keyBytes[i%keyBytes.length];}
    var bin='';
    for(var j=0;j<out.length;j++){bin+=String.fromCharCode(out[j]);}
    localStorage.setItem(STORAGE_KEY, ENC_PREFIX+btoa(bin));
    localStorage.setItem('isLoggedIn','true');
    report('ok','');
    setTimeout(function(){location.reload();},40);
  }catch(e){
    report('error',String(e&&e.message?e.message:e));
    console.error('[CPA Desktop] auto-login inject failed:',e);
  }})();`
}
