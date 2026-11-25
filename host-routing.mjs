// Host-based page boundaries are separate from authentication and workspace authorization.
export function hostRouting({enabled,publicHost='ringonyx.com',appHost='app.ringonyx.com',customerPages}) {
  const normalize=value=>{
    if (typeof value!=='string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value)) throw Error('Configure a hostname without a scheme, port or path.');
    return value.toLowerCase();
  };
  publicHost=normalize(publicHost);appHost=normalize(appHost);
  if (publicHost===appHost) throw Error('Public and customer hostnames must be distinct.');
  return (host,method,url)=>{
    if (!enabled) return null;
    host=String(host || '').toLowerCase().replace(/:\d+$/,'');
    const parsed=new URL(url,'http://localhost');
    const path=parsed.pathname;
    const navigation=['GET','HEAD'].includes(method);
    if (host===appHost && path==='/' && navigation) return {status:302,location:'https://'+appHost+'/overview'+parsed.search};
    if (host!==publicHost && host!=='www.'+publicHost) return null;
    if (customerPages.has(path)) return navigation
      ? {status:302,location:'https://'+appHost+path+parsed.search}
      : {status:404};
    // Public intake and publisher APIs keep their documented endpoints.
    // Browser sessions, account actions, recordings and dashboard data belong on the app host.
    if (path.startsWith('/api/') && !/^\/api\/(?:intake\/|publisher\/|v1\/)/.test(path)) return {status:404};
    if (host==='www.'+publicHost && navigation) return {status:308,location:'https://'+publicHost+path+parsed.search};
    return null;
  };
}
