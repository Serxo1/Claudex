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
    getSummary: (cwd) => ipcRenderer.invoke("git:getSummary", cwd),
    getRecentCommits: (limit, cwd) => ipcRenderer.invoke("git:getRecentCommits", limit, cwd),
    initRepo: (cwd) => ipcRenderer.invoke("git:initRepo", cwd),
    checkoutBranch: (branchName, cwd) => ipcRenderer.invoke("git:checkoutBranch", branchName, cwd),
    commit: (message, cwd) => ipcRenderer.invoke("git:commit", message, cwd),
    push: (cwd) => ipcRenderer.invoke("git:push", cwd),
    pull: (cwd) => ipcRenderer.invoke("git:pull", cwd),
    fetch: (cwd) => ipcRenderer.invoke("git:fetch", cwd),
    createPr: (payload) => ipcRenderer.invoke("git:createPr", payload),
    getHeadHash: (cwd) => ipcRenderer.invoke("git:getHeadHash", { cwd }),
    getChangedFiles: (since, cwd) => ipcRenderer.invoke("git:getChangedFiles", { since, cwd })
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
  app: {
    notify: (payload) => ipcRenderer.invoke("app:notify", payload),
    checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
    installUpdate: () => ipcRenderer.invoke("app:installUpdate"),
    onUpdateAvailable: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("app:updateAvailable", listener);
      return () => ipcRenderer.removeListener("app:updateAvailable", listener);
    },
    onUpdateDownloaded: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("app:updateDownloaded", listener);
      return () => ipcRenderer.removeListener("app:updateDownloaded", listener);
    }
  },
  mcp: {
    getServers: () => ipcRenderer.invoke("mcp:getServers"),
    openConfigFile: () => ipcRenderer.invoke("mcp:openConfigFile")
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
  },
  teams: {
    list: () => ipcRenderer.invoke("teams:list"),
    getSnapshot: (teamName) => ipcRenderer.invoke("teams:getSnapshot", teamName),
    refresh: (teamName) => ipcRenderer.invoke("teams:refresh", teamName),
    onSnapshot: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("teams:snapshot", listener);
      return () => ipcRenderer.removeListener("teams:snapshot", listener);
    },
    onAllDone: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("teams:allDone", listener);
      return () => ipcRenderer.removeListener("teams:allDone", listener);
    },
    respondToPermission: (payload) => ipcRenderer.invoke("teams:respondToPermission", payload),
    sendMessage: (payload) => ipcRenderer.invoke("teams:sendMessage", payload),
    deleteTeam: (teamName) => ipcRenderer.invoke("teams:deleteTeam", teamName)
  },
  todos: {
    read: (sessionId) => ipcRenderer.invoke("todos:read", sessionId),
    watch: (sessionId) => ipcRenderer.invoke("todos:watch", sessionId),
    unwatch: (sessionId) => ipcRenderer.invoke("todos:unwatch", sessionId),
    onUpdate: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("todos:update", listener);
      return () => ipcRenderer.removeListener("todos:update", listener);
    }
  }
});
