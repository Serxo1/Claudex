const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    setAuthMode: (authMode) => ipcRenderer.invoke("settings:setAuthMode", authMode),
    setModel: (model) => ipcRenderer.invoke("settings:setModel", model),
    setPreferredIde: (ideId) => ipcRenderer.invoke("settings:setPreferredIde", ideId),
    setApiKey: (apiKey) => ipcRenderer.invoke("settings:setApiKey", apiKey),
    clearApiKey: () => ipcRenderer.invoke("settings:clearApiKey"),
    clearClaudeCliSession: () => ipcRenderer.invoke("settings:clearClaudeCliSession")
  },
  providers: {
    testClaudeCli: () => ipcRenderer.invoke("providers:testClaudeCli")
  },
  workspace: {
    getInfo: () => ipcRenderer.invoke("workspace:getInfo"),
    getFileTree: (payload) => ipcRenderer.invoke("workspace:getFileTree", payload),
    getFileTrees: (payload) => ipcRenderer.invoke("workspace:getFileTrees", payload),
    addDirectory: () => ipcRenderer.invoke("workspace:addDirectory"),
    pickDirectory: () => ipcRenderer.invoke("workspace:pickDirectory"),
    removeDirectory: (dirPath) => ipcRenderer.invoke("workspace:removeDirectory", dirPath),
    pickContextFile: () => ipcRenderer.invoke("workspace:pickContextFile"),
    resolveContextFile: (relativePath) => ipcRenderer.invoke("workspace:resolveContextFile", relativePath),
    readFile: (filePath) => ipcRenderer.invoke("workspace:readFile", filePath),
    writeFile: (payload) => ipcRenderer.invoke("workspace:writeFile", payload),
    savePastedImage: (payload) => ipcRenderer.invoke("workspace:savePastedImage", payload),
    getSkills: () => ipcRenderer.invoke("workspace:getSkills")
  },
  ide: {
    getInfo: () => ipcRenderer.invoke("ide:getInfo"),
    openProject: (ideId) => ipcRenderer.invoke("ide:openProject", ideId)
  },
  git: {
    getSummary: () => ipcRenderer.invoke("git:getSummary"),
    getRecentCommits: (limit) => ipcRenderer.invoke("git:getRecentCommits", limit),
    initRepo: () => ipcRenderer.invoke("git:initRepo"),
    checkoutBranch: (branchName) => ipcRenderer.invoke("git:checkoutBranch", branchName),
    commit: (message) => ipcRenderer.invoke("git:commit", message),
    createPr: (payload) => ipcRenderer.invoke("git:createPr", payload)
  },
  terminal: {
    createSession: (payload) => ipcRenderer.invoke("terminal:createSession", payload),
    write: (payload) => ipcRenderer.invoke("terminal:write", payload),
    resize: (payload) => ipcRenderer.invoke("terminal:resize", payload),
    close: (sessionId) => ipcRenderer.invoke("terminal:close", sessionId),
    openExternal: () => ipcRenderer.invoke("terminal:openExternal"),
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    }
  },
  debug: {
    openDevTools: () => ipcRenderer.invoke("debug:openDevTools")
  },
  chat: {
    send: (payload) => ipcRenderer.invoke("chat:send", payload),
    startStream: (payload) => ipcRenderer.invoke("chat:streamStart", payload),
    abortStream: (requestId) => ipcRenderer.invoke("chat:streamAbort", requestId),
    respondToApproval: (approvalId, response) => ipcRenderer.invoke("chat:approvalResponse", approvalId, response),
    onStreamEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("chat:streamEvent", listener);
      return () => ipcRenderer.removeListener("chat:streamEvent", listener);
    }
  }
});
