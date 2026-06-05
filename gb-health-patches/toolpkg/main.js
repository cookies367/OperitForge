// ===== 菜单开关状态 =====
var autoInject = true; // 默认开启
var DATA_DIR = '/sdcard/Android/data/nodomain.freeyourgadget.gadgetbridge.nightly/files/';
var ENV_KEY = 'MIBAND_HEALTH_CACHE';

// ===== 异步读取并缓存到环境变量 =====
async function refreshCache() {
    try {
        var sections = [];
        var now = Math.floor(Date.now() / 1000);
        try { var hrR = await Tools.Files.read(DATA_DIR + 'realtime_hr.txt'); if (hrR && hrR.content) { var p = String(hrR.content).trim().split('\n'); var v = parseInt(p[0],10); var t = parseInt(p[1],10)||0; if (v>0) { var a = now-t; sections.push('❤️ '+v+' bpm'+(a>0&&a<600?' ('+Math.floor(a/60)+'分钟前)':'')); } } } catch(e){}
        try { var spR = await Tools.Files.read(DATA_DIR + 'realtime_spo2.txt'); if (spR && spR.content) { var p = String(spR.content).trim().split('\n'); var v = parseInt(p[0],10); var t = parseInt(p[1],10)||0; if (v>0) { var a = now-t; sections.push('💨 '+v+'%'+(a>0&&a<600?' ('+Math.floor(a/60)+'分钟前)':'')); } } } catch(e){}
        try { var stR = await Tools.Files.read(DATA_DIR + 'realtime_steps.txt'); if (stR && stR.content) { var p = String(stR.content).trim().split('\n'); var v = parseInt(p[0],10); var t = parseInt(p[1],10)||0; if (v>50) { var a = now-t; sections.push('🚶 今日'+v+'步'+(a>0&&a<600?' ('+Math.floor(a/60)+'分钟前)':'')); } } } catch(e){}
        try { if (!sections.some(function(s){return s.indexOf('今日')>=0;})) { var dsR = await Tools.Files.read('/sdcard/Download/realtime_daily_steps.txt'); if (dsR && dsR.content) { var dv = parseInt(String(dsR.content).trim(),10); if (dv>0) { sections.push('🚶 今日'+dv+'步 (累计)'); } } } } catch(e){}
        var text = sections.length > 0 ? '📊 健康数据\n' + sections.join(' | ') : '';
        await Tools.SoftwareSettings.writeEnvironmentVariable(ENV_KEY, text);
        return text;
    } catch(e) {
        await Tools.SoftwareSettings.writeEnvironmentVariable(ENV_KEY, '');
        return '';
    }
}

// ===== 从环境变量读取缓存（同步）=====
function readCached() {
    if (typeof getEnv === 'function') {
        return String(getEnv(ENV_KEY) ?? '').trim();
    }
    return '';
}

// ===== 包装为附件 =====
function wrapAttachment(content) {
    var escaped = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return '<attachment id="miband_health_data" filename="小米手环健康数据" type="text/plain" size="' + content.length + '">' + escaped + '</attachment>';
}

// ===== 菜单开关 =====
async function onInputMenuToggle(event) {
    var payload = event.eventPayload || {};
    var action = payload.action;
    if (action === 'create') {
        return {
            toggles: [{
                id: 'miband_health_auto',
                title: '健康数据注入',
                description: autoInject ? '已开启' : '已关闭',
                isChecked: autoInject
            }]
        };
    }
    if (action === 'toggle' && payload.toggleId === 'miband_health_auto') {
        autoInject = !autoInject;
        if (autoInject) {
            await refreshCache();
        }
        return { ok: true };
    }
    return { ok: false };
}

// ===== 输入钩子（以附件形式注入缓存的健康数据）=====
// 参考 moodlet: 在 before_process 阶段注入，返回拼接后的字符串
function onPromptInput(event) {
    var stage = String(event.eventPayload?.stage ?? event.eventName ?? '');
    if (stage !== 'before_process') return null;
    if (!autoInject) return null;
    var cached = readCached();
    if (!cached) {
        refreshCache().catch(function(){});
        return null;
    }
    var payload = event.eventPayload || {};
    var input = String(payload.processedInput ?? payload.rawInput ?? '');
    if (!input.trim()) return null;
    refreshCache().catch(function(){});
    return input + '\n\n' + wrapAttachment(cached);
}

// ===== 注册 =====
function registerToolPkg() {
    ToolPkg.registerInputMenuTogglePlugin({ id: 'miband_health_toggle', function: onInputMenuToggle });
    ToolPkg.registerPromptInputHook({ id: 'miband_health_inject', function: onPromptInput });
    return true;
}

exports.registerToolPkg = registerToolPkg;
exports.onInputMenuToggle = onInputMenuToggle;
exports.onPromptInput = onPromptInput;