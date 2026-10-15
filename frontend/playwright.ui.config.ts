/** Controlled frontend UI checks. No MongoDB or payment account is touched. */
import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./ui-tests',fullyParallel:false,workers:1,timeout:45000,retries:0,
 reporter:[['list'],['html',{outputFolder:'qa/ui-report',open:'never'}],['json',{outputFile:'qa/ui-results.json'}]],
 use:{baseURL:'http://127.0.0.1:3108',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'node ../scripts/start-ui-stack.mjs',url:'http://127.0.0.1:3108/login',reuseExistingServer:false,timeout:240000}
});
