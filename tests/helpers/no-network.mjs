// HTTP integration tests run the real server with all external fetches disabled.
globalThis.fetch=async()=>{throw Error('TEST_EXTERNAL_NETWORK_DISABLED');};
