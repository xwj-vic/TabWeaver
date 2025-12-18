/**
 * FlowTab Dashboard Logic (v0.3.3)
 * 优化：图表布局调整，放置在正确位置
 */

let currentExtractedData = [];
let apiConfig = {};

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
                    result.shortContent = (result.content || "").substring(0, 300);
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
        const prompt = `你是一个分类助手。请将以下网页按主题分类。
                      输出 JSON 格式：{ "groups": [ { "title": "主题名", "ids": [索引数字] } ] }。只输出 JSON。
                      网页列表：\n` +
            data.map((d, i) => `[${i}] ${d.title}`).join('\n');

        const result = await callAIChat(prompt, config);
        const json = parseAIResponse(result);
        if (json && json.groups) renderTopicCards(json.groups, data);
    } catch (err) { renderExtractedSummary(data); }
}

async function performDeepSynthesis(item, modalBody) {
    const synthesisDiv = modalBody.querySelector('#deep-synthesis-content');
    synthesisDiv.innerHTML = '<div class="loading" style="font-size: 0.8rem;">AI 正在绘制图谱与合成知识流...</div>';

    try {
        const prompt = `你是一个知识整合专家。请根据以下网页内容进行深度整合。
                      
                      输出结构：
                      1. **页面总结**：每行一个总结。
                      2. **关系图**：使用 \`\`\`mermaid 代码块，可以是 graph TD、mindmap 或 flowchart。
                      3. **深度对比**：分析关联与异同点。

                      重要：Mermaid 代码必须严格包裹在 \`\`\`mermaid 和 \`\`\` 之间。
                      
                      内容：\n` +
            item.tabs.map(t => `---\n标题：${t.title}\n内容：${t.content}`).join('\n\n');

        const result = await callAIChat(prompt, apiConfig);
        console.log("AI Result:", result);

        // --- 图表识别 ---
        let graphDef = "";
        const fenceMatch = result.match(/```mermaid([\s\S]*?)```/);
        if (fenceMatch) {
            graphDef = fenceMatch[1].trim();
        } else {
            const fuzzyMatch = result.match(/((?:mindmap|graph\s+(?:TD|LR|TB|BT|RL)|flowchart\s+(?:TD|LR|TB|BT|RL)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|pie)[\s\S]*?)(?=\n\n|\n##|\n\*\*|$)/i);
            if (fuzzyMatch) graphDef = fuzzyMatch[1].trim();
        }

        console.log("Extracted graph:", graphDef ? "Found" : "None");

        // 清理 Mermaid 代码中的非法字符
        if (graphDef) {
            graphDef = graphDef
                .replace(/（/g, '(').replace(/）/g, ')')  // 中文括号
                .replace(/【/g, '[').replace(/】/g, ']')  // 中文方括号
                .replace(/：/g, ':').replace(/；/g, ';')  // 中文冒号分号
                .replace(/，/g, ',')                       // 中文逗号
                .replace(/-{3,}/g, '--')                   // 解决 AI 生成长横线导致的语法错误
                .replace(/^\s*--+.*$/gm, '')               // 移除纯线条行
        }

        // 清理文本：移除图表代码，用占位符替换
        let textToShow = result;
        if (fenceMatch) {
            textToShow = result.replace(fenceMatch[0], '[GRAPH_HERE]');
        } else if (graphDef) {
            textToShow = result.replace(graphDef, '[GRAPH_HERE]');
        }

        // 清理所有"关系图"相关标题（因为我们会手动添加）
        textToShow = textToShow.replace(/##\s*2\.?\s*关系图[^\n]*/gi, '');
        textToShow = textToShow.replace(/\*\*2\.?\s*关系图[^\n]*\*\*/gi, '');
        textToShow = textToShow.replace(/^2\.?\s*关系图[^\n]*/gim, '');

        // 容器清空
        synthesisDiv.innerHTML = '';

        // 渲染逻辑：图表放在"关系图"标题位置
        if (graphDef && textToShow.includes('[GRAPH_HERE]')) {
            const parts = textToShow.split('[GRAPH_HERE]');

            // 第一部分：页面总结
            const part1Div = document.createElement('div');
            part1Div.style.cssText = "color: #cbd5e1; line-height: 1.8; font-size: 0.95rem;";
            part1Div.innerHTML = markToHtml(parts[0]);
            synthesisDiv.appendChild(part1Div);

            // 关系图标题
            const chartTitle = document.createElement('h3');
            chartTitle.style.cssText = "color: #818cf8; margin: 1.5rem 0 1rem 0;";
            chartTitle.textContent = "2. 关系图";
            synthesisDiv.appendChild(chartTitle);

            // 图表容器
            const chartContainer = document.createElement('div');
            chartContainer.id = 'mermaid-chart-' + Date.now();
            chartContainer.className = 'mermaid';
            chartContainer.style.cssText = "background: #0f172a; padding: 1.5rem; border-radius: 1rem; margin-bottom: 1.5rem; border: 1px solid #334155; overflow-x: auto;";
            chartContainer.textContent = graphDef;
            synthesisDiv.appendChild(chartContainer);

            // 第二部分：深度对比
            if (parts[1] && parts[1].trim()) {
                const part2Div = document.createElement('div');
                part2Div.style.cssText = "color: #cbd5e1; line-height: 1.8; font-size: 0.95rem;";
                part2Div.innerHTML = markToHtml(parts[1]);
                synthesisDiv.appendChild(part2Div);
            }

            // 异步渲染图表
            requestAnimationFrame(async () => {
                try {
                    await mermaid.run({ nodes: [chartContainer] });
                    console.log("Mermaid rendered successfully");
                } catch (e) {
                    console.error("Mermaid render error:", e);
                    chartContainer.innerHTML = `<pre style="color: #ef4444; font-size: 0.8rem;">图表渲染失败</pre>`;
                }
            });
        } else {
            // 没有图表或占位符：直接渲染全部文本
            const textDiv = document.createElement('div');
            textDiv.style.cssText = "color: #cbd5e1; line-height: 1.8; font-size: 0.95rem;";
            textDiv.innerHTML = markToHtml(textToShow.replace('[GRAPH_HERE]', ''));
            synthesisDiv.appendChild(textDiv);
        }

    } catch (err) {
        console.error("Synthesis error:", err);
        synthesisDiv.innerHTML = `<div style="color: #ef4444;">合成失败: ${err.message}</div>`;
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
        div.innerHTML = `<img class="tab-icon" src="${tab.favIconUrl || 'icons/default.png'}"><div class="tab-title">${tab.title}</div>`;
        div.onclick = () => { chrome.tabs.update(tab.tabId, { active: true }); chrome.windows.update(tab.windowId, { focused: true }); };
        list.appendChild(div);
    });

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
    try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch (e) { return null; }
}

function markToHtml(text) {
    return text.replace(/### (.*)/g, '<h3 style="color:#38bdf8;margin-top:1.5rem;">$1</h3>')
        .replace(/## (.*)/g, '<h2 style="color:#818cf8;margin-top:2rem;">$1</h2>')
        .replace(/\*\*(.*?)\*\*/g, '<b style="color:#f8fafc;">$1</b>')
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
document.querySelector('.close-modal').onclick = () => document.getElementById('modal-overlay').style.display = 'none';
document.addEventListener('DOMContentLoaded', initDashboard);

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
                <img src="${tab.favIconUrl || 'icons/default.png'}" style="width: 16px; height: 16px;">
                <span style="color: #e2e8f0; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tab.title}</span>
            `;
            item.onmouseover = () => item.style.borderColor = '#334155';
            item.onmouseout = () => item.style.borderColor = 'transparent';
            container.appendChild(item);
        });
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
                    result.shortContent = (result.content || "").substring(0, 300);
                    currentExtractedData.push(result);
                }
            } catch (e) { console.warn(`Tab ${tab.id} skip:`, e); }
        }

        apiConfig = saveConfig();
        if (apiConfig.key && currentExtractedData.length > 0) {
            // 自定义选择：直接打开合成弹窗，跳过聚类
            statusBar.innerText = "正在合成...";
            openModal({
                title: `自定义合成 (${currentExtractedData.length} 个页面)`,
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
