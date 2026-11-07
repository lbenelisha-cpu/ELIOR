import fs from 'node:fs';
import {patchParallelChecks} from '../../scripts/patch-parallel-entry-checks.mjs';
import {patchChannelPoc} from '../../scripts/patch-channel-poc.mjs';
export function upgradePocFixture(root){
 const parallel=JSON.parse(fs.readFileSync(new URL('../../scripts/parallel-entry-checks-patches.json',import.meta.url),'utf8'));
 patchParallelChecks(root,parallel);
 const poc=JSON.parse(fs.readFileSync(new URL('../../scripts/channel-poc-patches.json',import.meta.url),'utf8'));
 patchChannelPoc(root,poc);
}
