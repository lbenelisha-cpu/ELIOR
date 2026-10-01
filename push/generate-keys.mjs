import {createECDH,randomBytes} from 'node:crypto';import {mkdir,writeFile} from 'node:fs/promises';import {homedir} from 'node:os';import {join} from 'node:path';
const directory=join(homedir(),'.levi');await mkdir(directory,{recursive:true});
const curve=createECDH('prime256v1');curve.generateKeys();const publicKey=curve.getPublicKey().toString('base64url'),privateKey=curve.getPrivateKey().toString('base64url'),pairing=randomBytes(24).toString('base64url'),relay=randomBytes(32).toString('base64url'),site='https://levi-emptying-tracker.netlify.app';
const setup={PUSH_SITE_URL:site,VAPID_SUBJECT:site,VAPID_PUBLIC_KEY:publicKey,VAPID_PRIVATE_KEY:privateKey,PUSH_PAIRING_TOKEN:pairing,PUSH_RELAY_TOKEN:relay,NODE_VERSION:'22'};
// Refuse overwriting established signing keys or a paired relay configuration.
await writeFile(join(directory,'netlify-push-settings.json'),JSON.stringify(setup,null,2),{flag:'wx',mode:0o600});
await writeFile(join(directory,'push-config.json'),JSON.stringify({site,token:relay},null,2),{flag:'wx',mode:0o600});
console.log('הגדרות נוצרו בתיקייה '+directory+'. אל תעלה תיקייה זו ל־GitHub. המפתחות לא הודפסו למסך.');
