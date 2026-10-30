import {getStore} from '@netlify/blobs';
export const paperStore = () => getStore({name: 'levi-trader-auto-paper-v1', consistency: 'strong'});
