// 监听插件图标点击事件，打开 Dashboard
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard.html")
  });
});

// 监听消息请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getAllTabs") {
    chrome.tabs.query({}, (tabs) => {
      sendResponse({ tabs: tabs });
    });
    return true; // 异步响应
  }
});

// 监听标签页变化并广播
function broadcastTabUpdate() {
  chrome.runtime.sendMessage({ action: "tabsUpdated" }).catch(() => {
    // 忽略没有监听者的错误 (例如 Dashboard 还没打开时)
  });
}

chrome.tabs.onUpdated.addListener(broadcastTabUpdate);
chrome.tabs.onCreated.addListener(broadcastTabUpdate);
chrome.tabs.onRemoved.addListener(broadcastTabUpdate);

console.log("FlowTab Background Service Worker Initialized.");
