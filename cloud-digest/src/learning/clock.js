import {AsyncLocalStorage} from 'node:async_hooks';

// 「現在時間」的唯一入口。handler 依賴提供 now() 時，該次請求、排程或佇列處理內的時間都從它取；
// 測試因此能假裝「今天是某一天」，不必等真實時間經過。沒有提供時用系統時間。
const storage=new AsyncLocalStorage();
export function now(){const clock=storage.getStore();return clock?clock():Date.now();}
export function withClock(clock,fn){return clock?storage.run(clock,fn):fn();}
