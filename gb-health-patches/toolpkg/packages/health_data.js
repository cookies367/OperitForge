/* METADATA
{
    "name": "health_data",
    "description": {
        "zh": "小米手环8健康数据读取工具",
        "en": "Mi Band 8 health data reader"
    },
    "enabledByDefault": true,
    "tools": [
        {
            "name": "read_health_data",
            "description": {
                "zh": "读取小米手环8的实时健康数据（心率、血氧、步数）",
                "en": "Read Mi Band 8 real-time health data (HR, SpO2, steps)"
            },
            "parameters": []
        },
        {
            "name": "diagnose",
            "description": {
                "zh": "诊断文件状态，确认数据文件是否存在及内容",
                "en": "Diagnose file status, check if data files exist"
            },
            "parameters": []
        }
    ]
}
*/

var D = '/sdcard/Android/data/nodomain.freeyourgadget.gadgetbridge.nightly/files/';
var DAILY_STEPS_PATH = '/sdcard/Download/realtime_daily_steps.txt';
var CACHE = { hr: null, spo2: null, steps: null, dailySteps: null, lastUpdate: 0 };

// ===== 用 Tools.Files.read() 读取 =====
async function readFile(name) {
    try {
        var r = await Tools.Files.read(D + name);
        var raw = (r && r.content) ? String(r.content).trim() : '';
        if (!raw) return { error: '文件内容为空' };
        var parts = raw.split('\n');
        var val = parseInt(parts[0], 10);
        var ts = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        if (!val || val <= 0) return { error: '无效数值: ' + parts[0] };
        var now = Math.floor(Date.now() / 1000);
        var ageSec = ts > 0 ? now - ts : -1;
        var ageStr = '-';
        if (ageSec < 0) ageStr = '未知';
        else if (ageSec < 60) ageStr = ageSec + '秒前';
        else if (ageSec < 3600) ageStr = Math.floor(ageSec / 60) + '分钟前';
        else ageStr = Math.floor(ageSec / 3600) + '小时前';
        return { value: val, ts: ts, ageStr: ageStr };
    } catch(e) {
        return { error: '异常: ' + String(e.message || e) };
    }
}

function fmt(ts) {
    if (!ts) return '-';
    var d = new Date(ts * 1000);
    var p = function(n) { return n < 10 ? '0' + n : String(n); };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// ===== 读取每日累计步数（从二进制SUMMARY提取）=====
async function readDailySteps() {
    try {
        var r = await Tools.Files.read(DAILY_STEPS_PATH);
        var raw = (r && r.content) ? String(r.content).trim() : '';
        if (!raw) return null;
        var val = parseInt(raw, 10);
        if (!val || val <= 0) return null;
        return val;
    } catch(e) {
        return null;
    }
}

// ===== 刷新缓存 =====
async function refreshCache() {
    var hr = await readFile('realtime_hr.txt');
    var st = await readFile('realtime_steps.txt');
    var sp = await readFile('realtime_spo2.txt');
    var ds = await readDailySteps();
    CACHE.hr = hr;
    CACHE.steps = st;
    CACHE.spo2 = sp;
    CACHE.dailySteps = ds;
    CACHE.lastUpdate = Math.floor(Date.now() / 1000);
    return { hr: hr, steps: st, spo2: sp, dailySteps: ds };
}

// ===== 工具：读取健康数据 =====
async function read_health_data(p) {
    var data = await refreshCache();
    var sections = [];
    if (data.hr && data.hr.value) sections.push('❤️ 心率: ' + data.hr.value + ' bpm (' + fmt(data.hr.ts) + ', ' + data.hr.ageStr + ')');
    else if (data.hr && data.hr.error) sections.push('❤️ 心率: 错误 - ' + data.hr.error);
    else sections.push('❤️ 心率: N/A');
    if (data.spo2 && data.spo2.value) sections.push('💨 血氧: ' + data.spo2.value + '% (' + fmt(data.spo2.ts) + ', ' + data.spo2.ageStr + ')');
    else if (data.spo2 && data.spo2.error) sections.push('💨 血氧: 错误 - ' + data.spo2.error);
    else sections.push('💨 血氧: N/A');
    if (data.steps && data.steps.value && data.steps.value > 50) sections.push('🚶 今日步数: ' + data.steps.value + '步 (' + fmt(data.steps.ts) + ', ' + data.steps.ageStr + ')');
    else if (data.dailySteps) sections.push('🚶 今日步数: ' + data.dailySteps + '步 (累计)');
    else if (data.steps && data.steps.value) sections.push('🚶 步数: ' + data.steps.value + '步 (' + fmt(data.steps.ts) + ', ' + data.steps.ageStr + ')');
    else if (data.steps && data.steps.error) sections.push('🚶 步数: 错误 - ' + data.steps.error);
    else sections.push('🚶 步数: N/A');
    complete({ success: true, data: sections.join('\n'), summary: sections.join('\n') });
}

// ===== 工具：诊断 =====
async function diagnose_fn(p) {
    var data = await refreshCache();
    var lines = [];
    lines.push('DATA_DIR = ' + D);
    var files = ['realtime_hr.txt', 'realtime_steps.txt', 'realtime_spo2.txt'];
    var keys = { 'realtime_hr.txt': 'hr', 'realtime_steps.txt': 'steps', 'realtime_spo2.txt': 'spo2' };
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var r = data[keys[f]];
        lines.push('--- ' + f + ' ---');
        if (r && r.value) lines.push('数值=' + r.value + ' 时间=' + fmt(r.ts) + ' (' + r.ageStr + ')');
        else if (r && r.error) lines.push(r.error);
        else lines.push('未知错误');
    }
    complete({ success: true, data: { log: lines.join('\n') }, summary: '诊断完成，共检查 ' + files.length + ' 个文件' });
}

exports.read_health_data = read_health_data;
exports.diagnose = diagnose_fn;