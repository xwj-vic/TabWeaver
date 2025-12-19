/**
 * FlowTab Dashboard Logic (v0.3.3)
 * 优化：图表布局调整，放置在正确位置
 */

let currentExtractedData = [];
let apiConfig = {};

// 默认图标 - 内联SVG，确保永不失效
const DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2394a3b8'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'/%3E%3C/svg%3E";

// 安全设置图标：处理 favicon 加载失败（CSP 兼容）
function getSafeIconHtml(iconUrl, className = 'tab-icon') {
    const src = iconUrl || DEFAULT_ICON;
    // 不使用内联 onerror，而是在创建元素后通过 JS 绑定
    return `<img class="${className}" src="${src}" data-fallback="${DEFAULT_ICON}">`;
}

// 为所有图片添加错误处理（CSP 兼容）
function attachImageFallbacks() {
    document.querySelectorAll('img[data-fallback]').forEach(img => {
        if (!img.dataset.fallbackAttached) {
            img.dataset.fallbackAttached = 'true';
            img.addEventListener('error', function () {
                if (this.src !== this.dataset.fallback) {
                    this.src = this.dataset.fallback;
                }
            });
        }
    });
}

// ========== Mermaid 安全渲染模块 ==========

/**
 * 深度清理 Mermaid 代码，修复常见语法问题
 */
function sanitizeMermaidCode(code) {
    if (!code) return '';

    let cleaned = code
        // 1. 中文标点转换
        .replace(/（/g, '(').replace(/）/g, ')')
        .replace(/【/g, '[').replace(/】/g, ']')
        .replace(/：/g, ':').replace(/；/g, ';')
        .replace(/，/g, ',').replace(/。/g, '.')
        .replace(/"/g, '"').replace(/"/g, '"')
        .replace(/'/g, "'").replace(/'/g, "'")
        // 2. 移除 HTML 和特殊字符
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\.\.\./g, '...')
        // 3. 修复长横线问题
        .replace(/-{3,}/g, '--')
        .replace(/—/g, '--')
        // 4. 移除纯装饰线条行
        .replace(/^\s*--+\s*$/gm, '')
        // 5. 移除空 subgraph
        .replace(/subgraph\s+"[^"]*"\s*\n\s*end/gm, '')
        // 6. 确保节点标签安全 - 给含特殊字符的节点加引号
        .replace(/\[([^\]"]+[<>:;]+[^\]]*)\]/g, '["$1"]')
        // 7. 移除不支持的 style 属性
        .replace(/:::[\w-]+/g, '')
        // 8. 修复关键字粘连问题：确保 Mermaid 关键字前有换行
        // 8a. 在图表方向声明后强制换行 (graph TD/TB/LR/RL/BT 后紧跟内容)
        .replace(/(graph\s*(?:TD|TB|BT|LR|RL)|flowchart\s*(?:TD|TB|BT|LR|RL))([^\s\n])/gi, '$1\n    $2')
        // 8b. 在 subgraph 关键字前强制换行（处理空格分隔的情况，如 "B subgraph" -> "B\n    subgraph"）
        .replace(/(\S)\s+(subgraph\s+)/gi, '$1\n    $2')
        .replace(/([^\n])(subgraph\s+)/gi, '$1\n    $2')
        // 8c. 在 end 关键字前强制换行（确保 end 独立成行）
        .replace(/(\S)\s+(end)(\s|$)/gim, '$1\n$2$3')
        .replace(/([^\n\s])\s*(end)(\s|$)/gi, '$1\n$2$3')
        // 8d. 修复箭头与节点粘连 (A-->B 变成 A --> B)
        .replace(/(\w)(-->|---)([\w\[])/g, '$1 $2 $3')
        // 8e. 修复节点标识符中的下划线和中文粘连问题 (如 F_作为工具) - 将此类节点用引号包裹
        .replace(/([A-Za-z0-9_]+_[\u4e00-\u9fa5]+)/g, '"$1"')
        .replace(/([\u4e00-\u9fa5]+_[A-Za-z0-9_]+)/g, '"$1"')
        // 8f. 修复箭头文本标签中的中文字符 (--> |标签| 格式的标签应该用引号)
        .replace(/-->\s*\|([^|]*[\u4e00-\u9fa5][^|]*)\|/g, '--> |"$1"|')
        // 9. 清理多余空行
        .replace(/\n{3,}/g, '\n\n');

    // 确保有正确的图表类型声明
    const hasType = /^(graph|flowchart|mindmap|sequenceDiagram|classDiagram|stateDiagram|erDiagram|pie)/im.test(cleaned);
    if (!hasType) {
        cleaned = 'graph TD\n' + cleaned;
    }

    return cleaned.trim();
}

/**
 * 安全渲染 Mermaid 图表，带重试和降级机制
 * @param {HTMLElement} container - 渲染容器
 * @param {string} code - Mermaid 代码
 * @param {number} maxRetries - 最大重试次数
 */
async function safeMermaidRender(container, code, maxRetries = 3) {
    const cleanedCode = sanitizeMermaidCode(code);
    container.textContent = cleanedCode;
    container.classList.add('mermaid');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // 等待 DOM 更新
            await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));

            // 尝试渲染
            await mermaid.run({ nodes: [container] });
            console.log(`Mermaid 渲染成功 (尝试 ${attempt})`);
            return true;
        } catch (error) {
            console.warn(`Mermaid 渲染失败 (尝试 ${attempt}/${maxRetries}):`, error.message);

            if (attempt < maxRetries) {
                // 每次重试前额外清理
                container.innerHTML = '';
                const furtherCleaned = cleanedCode
                    .replace(/\([^)]*\)/g, '')  // 移除所有括号内容
                    .replace(/["']/g, '');       // 移除引号
                container.textContent = furtherCleaned;
                await new Promise(r => setTimeout(r, 100));
            }
        }
    }

    // 全部失败：降级显示
    showMermaidFallback(container, cleanedCode);
    return false;
}

/**
 * 降级展示：显示代码块 + 重试按钮（CSP 兼容）
 */
function showMermaidFallback(container, code) {
    container.classList.remove('mermaid');

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'background: #1e293b; border-radius: 0.5rem; padding: 1rem; border: 1px solid #ef4444;';

    wrapper.innerHTML = `
        <div style="color: #f87171; font-size: 0.85rem; margin-bottom: 0.5rem;">⚠️ 图表渲染失败</div>
        <pre style="color: #94a3b8; font-size: 0.75rem; overflow-x: auto; margin: 0; white-space: pre-wrap;">${escapeHtml(code)}</pre>
    `;

    const retryBtn = document.createElement('button');
    retryBtn.textContent = '🔄 重新渲染';
    retryBtn.style.cssText = 'margin-top: 0.8rem; background: #334155; border: none; color: #94a3b8; padding: 0.4rem 0.8rem; border-radius: 0.4rem; cursor: pointer; font-size: 0.8rem;';
    retryBtn.addEventListener('click', () => {
        container.innerHTML = '<div style="color: #38bdf8;">重新渲染中...</div>';
        safeMermaidRender(container, code, 2);
    });

    wrapper.appendChild(retryBtn);
    container.innerHTML = '';
    container.appendChild(wrapper);
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeForJs(text) {
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

// 全局重试函数
window.retryMermaidRender = async function (container, code) {
    container.innerHTML = '<div style="color: #38bdf8;">重新渲染中...</div>';
    await safeMermaidRender(container, code, 2);
};

async function initDashboard() {
    const statusBar = document.getElementById('status-bar');
    const container = document.getElementById('a2ui-container');

    loadConfig();
    statusBar.innerText = "正在扫描标签页...";

    try {
        const response = await chrome.runtime.sendMessage({ action: "getAllTabs" });
        const allTabs = response.tabs.filter(t => t.url.startsWith('http') && !t.url.includes(chrome.runtime.id));

        if (allTabs.length === 0) {
            statusBar.innerText = "无活动网页";
            container.innerHTML = '<div style="color: #64748b; text-align: center; padding: 2rem;">请在浏览器中打开一些网页后重试。</div>';
            return;
        }

        statusBar.innerText = `正在提取 ${allTabs.length} 个页面的元数据...`;
        currentExtractedData = [];
        for (const tab of allTabs) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['libs/Readability.js', 'content.js']
                });
                const result = await chrome.tabs.sendMessage(tab.id, { action: "extractContent" });
                if (result && !result.error) {
                    result.tabId = tab.id;
                    result.windowId = tab.windowId;
                    result.favIconUrl = tab.favIconUrl;
                    result.shortContent = (result.content || "").substring(0, 600); // 增加摘要长度以提高分类准确度
                    currentExtractedData.push(result);
                }
            } catch (e) { console.warn(`Tab ${tab.id} skip:`, e); }
        }

        apiConfig = saveConfig();
        if (apiConfig.key) {
            statusBar.innerText = "正在聚类中...";
            await performRapidClustering(currentExtractedData, apiConfig);
        } else {
            statusBar.innerText = "请配置 API Key";
            renderExtractedSummary(currentExtractedData);
        }

    } catch (err) {
        console.error("Init failed:", err);
        statusBar.innerText = "运行出错";
    }
}

async function performRapidClustering(data, config) {
    try {
        const prompt = `你是一个专业的网页信息架构师。请将以下网页按照其**核心主题和细分领域**进行精准分类。

分类指南：
1. **语义分类**：不要只看标题，要结合摘要内容进行分类。如果两个页面虽然标题不同但讨论的是同一个具体的技术、产品或事件，请归为一类。
2. **细粒度主题**：如果页面数量较多，尽量区分出具体的子话题（例如“AI 基础架构”与“AI 应用案例”）。
3. **独立组**：完全不相关的页面应单独作为一个主题。
4. **命名规范**：分类标题应具有概括性且专业（如“前端性能优化”、“全球宏观经济”、“Vue3 开发实践”）。

输出要求：
- 严格输出 JSON 格式
- 输出 JSON：{ "groups": [ { "title": "主题名", "ids": [索引数字] } ] }

网页列表：
` + data.map((d, i) => `[${i}] 标题：${d.title}\n    关键摘要：${d.shortContent || '无'}`).join('\n\n');

        const result = await callAIChat(prompt, config);
        const json = parseAIResponse(result);
        if (json && json.groups && json.groups.length > 0) {
            renderTopicCards(json.groups, data);
            document.getElementById('status-bar').innerText = "聚类分析完成";
        } else {
            console.warn("AI clustering failed or empty, showing raw summary");
            renderExtractedSummary(data);
            document.getElementById('status-bar').innerText = "聚类解析失败，显示提取结果";
        }
    } catch (err) {
        console.error("Clustering error:", err);
        renderExtractedSummary(data);
        document.getElementById('status-bar').innerText = "聚类失败: " + err.message;
    }
}

async function performDeepSynthesis(item, modalBody) {
    const synthesisDiv = modalBody.querySelector('#deep-synthesis-content');
    synthesisDiv.innerHTML = '<div class="loading" style="font-size: 0.8rem;">AI 正在深度分析内容...</div>';

    try {
        // 纯文本深度总结 Prompt，无图表
        const tabContents = item.tabs.map(t => `---\n【${t.title}】\n${t.content}`).join('\n\n');
        const prompt = `你是一个知识整合专家。请根据以下网页内容进行深度分析和综合整合。

## 输出结构

### 第一部分：逐页深度总结

对每个页面进行**深度且详尽的内容拆解**，严禁一句话带过。每个页面必须包含以下内容：

#### 📄 [页面标题]

**🎯 核心主旨**：
用 2-3 句话精准概括该页面想要传达的核心信息或解决的核心问题。

**📌 重点内容提炼**：
详细阐述页面的主体内容，包括但不限于：
- 主要论点或核心观点
- 关键论据、数据支撑或案例说明
- 方法论、技术细节或实施路径
- 与其他相关主题的关联性

**💡 关键要点（不少于 3 点）**：
- **要点一**：[标题] - 详细说明该要点的含义和重要性
- **要点二**：[标题] - 详细说明该要点的含义和重要性
- **要点三**：[标题] - 详细说明该要点的含义和重要性
（根据内容复杂度可增加更多要点）

**⚠️ 特别注意**：
指出该页面中容易被忽略但非常重要的信息，或需要谨慎对待的观点。

---

### 第二部分：综合多维分析

基于以上所有页面的内容，进行跨页面的综合分析：

**🔗 共识与主线**：
这些页面在哪些方面达成了共识？它们共同指向什么主题或趋势？

**⚔️ 差异与张力**：
不同页面之间存在哪些观点分歧、数据差异或方法论冲突？这些差异反映了什么？

**🎯 核心洞见**：
综合所有信息后，提炼出最有价值的 2-3 条深度洞见，这些洞见应该是单独阅读任何一个页面都无法得出的。

**💼 行动建议**：
基于以上分析，给出具体可执行的建议或下一步行动方向。

---

## 重要规则
1. **禁止敷衍**：每个页面的总结必须详尽，体现你对内容的深度理解
2. **保持客观**：忠实于原文内容，避免过度解读
3. **结构清晰**：严格按照上述格式输出
4. **不需要生成任何图表或代码**

内容：
${tabContents}`;

        const result = await callAIChat(prompt, apiConfig);
        console.log("AI Result:", result);

        // 清空容器并直接渲染纯文本结果
        synthesisDiv.innerHTML = '';
        renderTextContent(synthesisDiv, result);

    } catch (err) {
        console.error("Synthesis error:", err);
        synthesisDiv.innerHTML = '<div style="color: #ef4444;">合成失败: ' + err.message + '</div>';
    }
}

/**
 * 纯文本渲染：将 AI 输出的 Markdown 转换为 HTML
 */
function renderTextContent(container, text) {
    // 将 Markdown 转换为 HTML 并渲染
    const htmlContent = markToHtml(text);

    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = 'color: #cbd5e1; line-height: 1.8; font-size: 0.95rem;';
    contentDiv.innerHTML = htmlContent;

    container.appendChild(contentDiv);
}

/**
 * 图文并茂渲染：将文本和图谱交织展示
 */
async function renderRichContent(container, rawText, mermaidBlocks, tabs) {
    // 替换 mermaid 代码块为占位符
    let processedText = rawText;
    const placeholders = [];
    mermaidBlocks.forEach((block, i) => {
        const placeholder = `[MERMAID_BLOCK_${i}]`;
        placeholders.push(placeholder);
        processedText = processedText.replace(/```mermaid\s * [\s\S] *? ```/, placeholder);
    });

    // 按页面分割内容
    const pageSections = processedText.split(/###\s*📄\s*/);

    // 渲染开头部分（如果有）
    if (pageSections[0] && pageSections[0].trim()) {
        const headerPart = pageSections[0].replace(/##\s*1\.\s*(页面详解|深度内容总结.*?)\s*/gi, '').trim();
        if (headerPart) {
            const headerDiv = document.createElement('div');
            headerDiv.innerHTML = markToHtml(headerPart);
            container.appendChild(headerDiv);
        }
    }

    // 页面详解标题
    const sectionTitle = document.createElement('h2');
    sectionTitle.style.cssText = "color: #818cf8; margin: 1.5rem 0 1rem 0; font-size: 1.2rem;";
    sectionTitle.textContent = "📑 页面详解";
    container.appendChild(sectionTitle);

    // 渲染每个页面卡片
    let mermaidIndex = 0;
    for (let i = 1; i < pageSections.length; i++) {
        const section = pageSections[i];
        if (!section.trim()) continue;

        // 创建图文并茂卡片
        const card = document.createElement('div');
        card.className = 'page-flow-card';
        card.style.cssText = `
            display: grid;
        grid - template - columns: 1fr; /* 修改为纵向排列 */
        gap: 1.5rem;
        background: linear - gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9));
        border - radius: 1rem;
        padding: 1.5rem;
        margin - bottom: 1.5rem;
        border: 1px solid #334155;
        box - shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        // 检查此部分是否包含 Mermaid 占位符
        const hasMermaid = placeholders.some(p => section.includes(p));

        // 左侧：文字内容
        const textPart = document.createElement('div');
        textPart.style.cssText = "color: #cbd5e1; line-height: 1.8; font-size: 0.9rem;";

        let textContent = section;
        // 移除 mermaid 占位符用于文字显示
        placeholders.forEach(p => {
            textContent = textContent.replace(p, '');
        });
        // 清理多余的"内容流向图"标题（兼容新旧 Prompt）
        textContent = textContent.replace(/\*\*(🗺️\s*)?内容流(向)?图\*\*[：:]?\s*/gi, '')
            // 清理所有残留的 markdown 分隔线
            .replace(/^\s*---+\s*$/gm, '')
            .replace(/---+\s*$/g, '')
            .replace(/^\s*---+\s*/g, '');

        textPart.innerHTML = markToHtml('### 📄 ' + textContent.trim());
        card.appendChild(textPart);

        // 右侧：流程图
        const chartPart = document.createElement('div');
        chartPart.style.cssText = `
        background: #0f172a;
        border - radius: 0.8rem;
        padding: 1rem;
        border: 1px solid #334155;
        display: flex;
        align - items: center;
        justify - content: center;
        min - height: 150px;
        `;

        if (hasMermaid && mermaidIndex < mermaidBlocks.length) {
            const chartContainer = document.createElement('div');
            chartContainer.id = 'page-flow-' + Date.now() + '-' + i;
            chartContainer.style.cssText = "width: 100%;";
            chartPart.appendChild(chartContainer);

            // 延迟渲染以确保 DOM 就绪
            const blockToRender = mermaidBlocks[mermaidIndex];
            mermaidIndex++;
            setTimeout(() => safeMermaidRender(chartContainer, blockToRender), 100 * i);
        } else {
            chartPart.innerHTML = '<div style="color: #64748b; font-size: 0.85rem;">暂无流程图</div>';
        }

        card.appendChild(chartPart);
        container.appendChild(card);
    }

    // 渲染总体关系图（兼容新旧标题）- 只有在有未渲染的 Mermaid 块时才显示
    const hasRemainingMermaid = mermaidIndex < mermaidBlocks.length;
    if (hasRemainingMermaid) {
        const relationTitle = document.createElement('h2');
        relationTitle.style.cssText = "color: #818cf8; margin: 2rem 0 1rem 0; font-size: 1.2rem;";
        relationTitle.textContent = "🔗 总体关系图";
        container.appendChild(relationTitle);

        const relationContainer = document.createElement('div');
        relationContainer.id = 'relation-chart-' + Date.now();
        relationContainer.style.cssText = `
        background: #0f172a;
        padding: 1.5rem;
        border - radius: 1rem;
        border: 1px solid #334155;
        margin - bottom: 1.5rem;
        `;
        container.appendChild(relationContainer);

        // 使用下一个未渲染的 mermaid 块作为关系图
        setTimeout(() => safeMermaidRender(relationContainer, mermaidBlocks[mermaidIndex]), 100);
    }

    // 渲染综合分析（兼容新旧标题）
    const analysisSection = processedText.match(/##\s*3\.\s*(综合分析|综合多维分析)[\s\S]*/i);
    if (analysisSection) {
        let analysisText = analysisSection[0];
        // 清理占位符
        placeholders.forEach(p => {
            analysisText = analysisText.replace(p, '');
        });

        const analysisDiv = document.createElement('div');
        analysisDiv.style.cssText = `
        background: linear - gradient(135deg, rgba(56, 189, 248, 0.1), rgba(129, 140, 248, 0.1));
        border - radius: 1rem;
        padding: 1.5rem;
        border: 1px solid rgba(56, 189, 248, 0.2);
        margin - top: 1rem;
        `;
        analysisDiv.innerHTML = markToHtml(analysisText);
        container.appendChild(analysisDiv);
    }
}

function renderTopicCards(groups, originalData) {
    const container = document.getElementById('a2ui-container');
    container.innerHTML = '';
    groups.forEach(g => {
        const tabs = (g.ids || []).map(idx => originalData[idx]).filter(Boolean);
        const card = document.createElement('div');
        card.style.cssText = `background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border-radius: 1.25rem; border: 1px solid rgba(51, 65, 85, 0.5); padding: 1.5rem; cursor: pointer; transition: 0.2s; position: relative; overflow: hidden;`;
        card.innerHTML = `<div style="position: absolute; top:0; left:0; right:0; height: 3px; background: #818cf8;"></div><h3 style="margin: 0; color: #f8fafc; font-size: 1.1rem;">${g.title}</h3><div style="color: #94a3b8; font-size: 0.8rem; margin-top:0.5rem;">${tabs.length} 网页已聚合</div>`;
        card.onclick = () => openModal({ title: g.title, tabs: tabs });
        container.appendChild(card);
    });
}

function openModal(item) {
    const overlay = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
        <h2 style="color: #f8fafc; margin-bottom: 1.5rem;">${item.title}</h2>
        <div id="deep-synthesis-content"></div>
        <h3 style="color: #94a3b8; font-size: 0.9rem; margin: 1.5rem 0 0.5rem 0;">原始来源</h3>
        <div id="modal-tabs-list"></div>
        <button id="close-tabs-btn" style="margin-top: 2rem; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 0.6rem 1.2rem; border-radius: 0.6rem; cursor: pointer;">一键清理并关闭标签</button>
    `;

    const list = body.querySelector('#modal-tabs-list');
    item.tabs.forEach(tab => {
        const div = document.createElement('div');
        div.className = 'tab-item';
        div.innerHTML = `${getSafeIconHtml(tab.favIconUrl)} <div class="tab-title">${tab.title}</div>`;
        div.onclick = () => { chrome.tabs.update(tab.tabId, { active: true }); chrome.windows.update(tab.windowId, { focused: true }); };
        list.appendChild(div);
    });

    // 为图片添加错误处理（CSP 兼容）
    attachImageFallbacks();

    body.querySelector('#close-tabs-btn').onclick = async () => {
        if (confirm("确定？")) {
            await chrome.tabs.remove(item.tabs.map(t => t.tabId));
            overlay.style.display = 'none';
            initDashboard();
        }
    };
    overlay.style.display = 'flex';
    performDeepSynthesis(item, body);
}

async function callAIChat(prompt, config) {
    let url = config.endpoint;
    let headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.key}` };
    let body = { model: config.model, messages: [{ role: "user", content: prompt }] };

    if (url.includes('generativelanguage.googleapis.com')) {
        url = `${url}/v1beta/models/${config.model || 'gemini-1.5-flash'}:generateContent?key=${config.key}`;
        body = { contents: [{ parts: [{ text: prompt }] }] };
        headers = { 'Content-Type': 'application/json' };
    } else {
        url = url.endsWith('/') ? url + 'chat/completions' : url + '/chat/completions';
    }

    const response = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    const result = await response.json();
    if (result.choices) return result.choices[0].message.content;
    if (result.candidates) return result.candidates[0].content.parts[0].text;
    throw new Error("API 返回异常");
}

function parseAIResponse(raw) {
    if (!raw) return null;
    try {
        // 1. 尝试直接解析
        return JSON.parse(raw);
    } catch (e) {
        try {
            // 2. 尝试提取 ```json ... ``` 中的内容
            const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (match) return JSON.parse(match[1].trim());

            // 3. 尝试搜索第一个 { 和 最后一个 } 之间的内容
            const start = raw.indexOf('{');
            const end = raw.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                return JSON.parse(raw.substring(start, end + 1));
            }
        } catch (e2) {
            console.error("JSON parse failed after extraction attempts:", e2);
        }
        return null;
    }
}

function markToHtml(text) {
    return text.replace(/### (.*)/g, '<h3 style="color:#38bdf8;margin-top:1.5rem;">$1</h3>')
        .replace(/## (.*)/g, '<h2 style="color:#818cf8;margin-top:2rem;">$1</h2>')
        .replace(/\*\*(.*?)\*\*/g, '<b style="color:#f8fafc;">$1</b>')
        .replace(/\*\*🎯 (.*?)\*\*/g, '<b style="color:#38bdf8;font-size:1.1rem;">🎯 $1</b>') // 增强核心主旨显示
        .replace(/\*\*🔍 (.*?)\*\*/g, '<b style="color:#818cf8;">🔍 $1</b>') // 增强深度内容显示
        .replace(/\* (.*)/g, '<div style="margin-left:1rem;color:#94a3b8;">• $1</div>')
        .replace(/^- (.*)/gm, '<div style="margin-left:1rem;color:#94a3b8;">• $1</div>')
        .replace(/\n/g, '<div style="height:0.5rem;"></div>');
}

function renderExtractedSummary(data) {
    const container = document.getElementById('a2ui-container');
    container.innerHTML = data.map(d => `<div class="topic-card" style="padding:1rem; background:#1e293b; border-radius:1rem;"><h3>${d.title}</h3></div>`).join('');
}

function saveConfig() {
    const config = { endpoint: document.getElementById('api-endpoint').value, model: document.getElementById('api-model').value, key: document.getElementById('api-key').value };
    localStorage.setItem('flowtab_config', JSON.stringify(config));
    return config;
}

function loadConfig() {
    const config = JSON.parse(localStorage.getItem('flowtab_config') || '{}');
    if (config.endpoint) document.getElementById('api-endpoint').value = config.endpoint;
    if (config.model) document.getElementById('api-model').value = config.model;
    if (config.key) document.getElementById('api-key').value = config.key;
}

document.getElementById('refresh-btn')?.addEventListener('click', () => initDashboard());
document.querySelector('.close-modal').onclick = () => {
    document.getElementById('modal-overlay').style.display = 'none';
    // 关闭时重置全屏状态
    document.getElementById('modal-content').classList.remove('fullscreen');
    updateFullscreenIcon();
};
document.addEventListener('DOMContentLoaded', initDashboard);

// ========== 弹窗全屏切换 ==========
function updateFullscreenIcon() {
    const btn = document.getElementById('toggle-fullscreen-btn');
    const isFullscreen = document.getElementById('modal-content').classList.contains('fullscreen');
    btn.textContent = isFullscreen ? '⛶' : '⛶';  // 可换成不同图标
    btn.title = isFullscreen ? '还原窗口' : '全屏显示';
}

document.getElementById('toggle-fullscreen-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-content');
    modal.classList.toggle('fullscreen');
    updateFullscreenIcon();
});

// ========== 自定义选择功能 ==========
let allAvailableTabs = [];

document.getElementById('custom-select-btn')?.addEventListener('click', async () => {
    const overlay = document.getElementById('tab-select-overlay');
    const container = document.getElementById('tab-list-container');
    container.innerHTML = '<div style="color: #94a3b8;">正在加载标签页列表...</div>';
    overlay.style.display = 'flex';

    try {
        const response = await chrome.runtime.sendMessage({ action: "getAllTabs" });
        allAvailableTabs = response.tabs.filter(t => t.url.startsWith('http') && !t.url.includes(chrome.runtime.id));

        container.innerHTML = '';
        allAvailableTabs.forEach((tab, idx) => {
            const item = document.createElement('label');
            item.style.cssText = "display: flex; align-items: center; gap: 0.8rem; padding: 0.8rem; background: rgba(15, 23, 42, 0.5); border-radius: 0.6rem; cursor: pointer; border: 1px solid transparent; transition: all 0.2s;";
            item.innerHTML = `
            <input type="checkbox" data-idx="${idx}" style="width: 18px; height: 18px; accent-color: #38bdf8;">
            ${getSafeIconHtml(tab.favIconUrl).replace('tab-icon', '').replace('class=""', 'style="width: 16px; height: 16px;"')}
            <span style="color: #e2e8f0; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tab.title}</span>
            `;
            item.onmouseover = () => item.style.borderColor = '#334155';
            item.onmouseout = () => item.style.borderColor = 'transparent';
            container.appendChild(item);
        });
        attachImageFallbacks();
    } catch (err) {
        container.innerHTML = `<div style="color: #ef4444;">加载失败: ${err.message}</div>`;
    }
});

document.getElementById('close-tab-select')?.addEventListener('click', () => {
    document.getElementById('tab-select-overlay').style.display = 'none';
});

document.getElementById('select-all-btn')?.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('#tab-list-container input[type="checkbox"]');
    const allChecked = [...checkboxes].every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
});

document.getElementById('start-custom-synthesis-btn')?.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('#tab-list-container input[type="checkbox"]:checked');
    const selectedIndices = [...checkboxes].map(cb => parseInt(cb.dataset.idx));

    if (selectedIndices.length === 0) {
        alert('请至少选择一个标签页');
        return;
    }

    const selectedTabs = selectedIndices.map(idx => allAvailableTabs[idx]);
    document.getElementById('tab-select-overlay').style.display = 'none';

    // 直接对选中的标签页进行合成
    await synthesizeSelectedTabs(selectedTabs);
});

async function synthesizeSelectedTabs(tabs) {
    const statusBar = document.getElementById('status-bar');
    const container = document.getElementById('a2ui-container');

    loadConfig();
    statusBar.innerText = `正在提取 ${tabs.length} 个选定页面...`;

    try {
        currentExtractedData = [];
        for (const tab of tabs) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['libs/Readability.js', 'content.js']
                });
                const result = await chrome.tabs.sendMessage(tab.id, { action: "extractContent" });
                if (result && !result.error) {
                    result.tabId = tab.id;
                    result.windowId = tab.windowId;
                    result.favIconUrl = tab.favIconUrl;
                    result.shortContent = (result.content || "").substring(0, 600); // 增加摘要长度以提高分类准确度
                    currentExtractedData.push(result);
                }
            } catch (e) { console.warn(`Tab ${tab.id} skip: `, e); }
        }

        apiConfig = saveConfig();
        if (apiConfig.key && currentExtractedData.length > 0) {
            // 自定义选择：直接打开合成弹窗，跳过聚类
            statusBar.innerText = "正在合成...";
            openModal({
                title: `自定义合成(${currentExtractedData.length} 个页面)`,
                tabs: currentExtractedData
            });
        } else if (!apiConfig.key) {
            statusBar.innerText = "请配置 API Key";
        } else {
            statusBar.innerText = "未能提取到有效内容";
        }
    } catch (err) {
        statusBar.innerText = "出错：" + err.message;
    }
}
