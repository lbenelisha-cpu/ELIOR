import {timingSafeEqual} from 'node:crypto';
export function controlAuthorized(header, token) {
  if(typeof token!=='string'||token.length<32||typeof header!=='string'||!header.startsWith('Bearer '))return false;
  const supplied=Buffer.from(header.slice(7)),expected=Buffer.from(token);
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
