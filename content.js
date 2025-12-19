/**
 * TabWeaver Content Script
 * 负责在目标网页执行 Readability 提取
 */

(function () {
    // 检查是否已经定义，防止重复执行
    if (window.hasTabWeaverExtractor) return;
    window.hasTabWeaverExtractor = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "extractContent") {
            try {
                // 动态检查 Readability 是否加载（如果是通过 executeScript 注入的）
                if (typeof Readability === 'undefined') {
                    sendResponse({ error: "Readability not loaded" });
                    return;
                }

                const documentClone = document.cloneNode(true);
                const article = new Readability(documentClone).parse();

                sendResponse({
                    title: article?.title || document.title,
                    content: article?.textContent?.substring(0, 1000) || "", // 截取前 1000 字作为摘要
                    url: window.location.href
                });
            } catch (err) {
                sendResponse({ error: err.message });
            }
        }
        return true;
    });
})();
