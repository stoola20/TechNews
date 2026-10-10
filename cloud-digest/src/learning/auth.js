import {timingSafeEqual} from 'node:crypto';
import {hash,query,nowIso} from './store.js';

export function equalSecret(a,b) {
  if(!a || !b)return false;
  const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
export function cookie(request,name){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1) || '';}
export async function authorized(request,env){
  const bearer=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(equalSecret(bearer,env.RUN_TOKEN))return true;
  const token=cookie(request,'learning_session');
  if(!token)return false;
  const row=await query(env,'SELECT id FROM learning_sessions WHERE id=? AND credential_hash=? AND expires_at>?',await hash(token),await hash(env.RUN_TOKEN || ''),nowIso()).first();
  return !!row;
}
export async function createSession(env){
  const token=crypto.randomUUID()+crypto.randomUUID();
  await query(env,'INSERT INTO learning_sessions(id,credential_hash,expires_at) VALUES(?,?,?)',await hash(token),await hash(env.RUN_TOKEN),new Date(Date.now()+7*86400000).toISOString()).run();
  return `learning_session=${token}; Path=/learning; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`;
}
export function mutationAllowed(request,env){
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin)return false;
  return equalSecret(request.headers.get('authorization')?.replace(/^Bearer\s+/i,''),env.RUN_TOKEN) || request.headers.get('x-learning-request')==='1';
}
