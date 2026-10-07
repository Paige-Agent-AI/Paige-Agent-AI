import config from "./solo.vite.config";

// INT-338 renders the actual canonical upload hook; only authentication/history/model data are fake.
export default {
  ...config,
  resolve: {
    ...config.resolve,
    alias: config.resolve.alias.filter(entry => !String(entry.find).includes("useChatDocumentUpload")),
  },
  server: { ...config.server, port: 5215 },
};
