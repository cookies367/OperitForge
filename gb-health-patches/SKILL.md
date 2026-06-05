---
name: GB Health Patches
description: Gadgetbridge 金箍棒smali注入维护——管理心率/血氧/步数/睡眠（含深睡/浅睡/REM/清醒）八个写文件补丁、AutoFetch定时器、exportHeartRateData数据库回查，以及AI端Operit ToolPkg工具。
---

# GB Health Patches（金箍棒）

## 环境

- 手环: 小米手环8 (Band 8)
- Auth Key: `0xe4e9deb78d5319a673e93792df97ed70`
- GB: Nightly (`nodomain.freeyourgadget.gadgetbridge.nightly`, 0.91.1-3cf7b7696)
- 基座APK: `/storage/emulated/0/Download/Operit/cleanOnExit/img_1780641970461.apk`（开发者成功版，含完整handleRealtimeStats注入）
- 原始smali: `/tmp/success_clean/classes3.dex`（从成功版APK解压）
- 修改后smali: `/tmp/final_mod/`（只改了AutoFetchRunnable一个类）
- 数据路径: `/sdcard/Android/data/nodomain.freeyourgadget.gadgetbridge.nightly/files/`（⚠️带`.nightly`）
- ToolPkg: `com.operit.miband_health`

## 心率数据路径（两条）

### 路径A：handleRealtimeStats（手环推送）

```
手环BLE推送 RealTimeStats → XiaomiHealthService.handleRealtimeStats()
  ├─ realtimeStarted 或 realtimeOneShot 为 true？ → 继续
  ├─ RealTimeStats.getHeartRate() <= 10？ → 跳过 ❌（值为0或无效）
  └─ 通过 → 创建 XiaomiActivitySample
             setTimestamp(当前时间)  ← 关键！新鲜度检查总能通过
             setHeartRate(手环值) → 写 realtime_hr.txt ✅
```

**⚠️ 米8限制**：RealTimeStats心率字段经常为0/空，不是秒级推的。米9可能不同。
**开启条件**：在GB设备设置里打开「实时心率测量」

### 路径B：exportHeartRateData（AutoFetch查数据库）

```
AutoFetch(每60秒) → onFetchRecordedData(0x1bed)
  → exportSleepData()
  → **exportHeartRateData()**  ← 新增
       └─ SQL: SELECT HEART_RATE, TIMESTAMP FROM XIAOMI_ACTIVITY_SAMPLE
                WHERE HEART_RATE > 0 ORDER BY TIMESTAMP DESC LIMIT 1
       └─ 结果 → 写 realtime_hr.txt ✅
```

这个不依赖手环推送，直接查数据库里最新心率记录。只要有activity数据同步过，就有心率。缺点是比推送慢60秒。

## 补丁状态（9项全部 ✅）

### smali 注入 → txt 文件映射

| # | setter 方法 | 类 | 输出文件 | 状态 |
|:--|:---|:---|:---|:----:|
| 1 | `setHeartRate(Integer)` | `XiaomiDailySummarySample` | `realtime_hr.txt` | ✅ |
| 2 | `setSteps(Integer)` | `XiaomiDailySummarySample` | `realtime_steps.txt` | ✅ |
| 3 | `setSpo2Avg(Integer)` | `XiaomiDailySummarySample` | `realtime_spo2.txt` | ✅ |
| 4 | `setTotalDuration(Integer)` | `XiaomiSleepTimeSample` | `realtime_sleep.txt` | ✅ |
| 5 | `setDeepSleepDuration(Integer)` | `XiaomiSleepTimeSample` | `realtime_sleep_deep.txt` | ✅ |
| 6 | `setLightSleepDuration(Integer)` | `XiaomiSleepTimeSample` | `realtime_sleep_light.txt` | ✅ |
| 7 | `setRemSleepDuration(Integer)` | `XiaomiSleepTimeSample` | `realtime_sleep_rem.txt` | ✅ |
| 8 | `setAwakeDuration(Integer)` | `XiaomiSleepTimeSample` | `realtime_sleep_awake.txt` | ✅ |
| **9** | **exportHeartRateData()** | **`AutoFetchRunnable`** | **`realtime_hr.txt`** | **✅** |

### 新增：exportHeartRateData (AutoFetchRunnable)

在`AutoFetchRunnable.run()`里的`exportSleepData()`之后、`postDelayed`之前插入调用。

```smali
.method private exportHeartRateData()V
    .registers 11
    const/4 v8, 0x0
    const/4 v9, 0x0
    :try_start_2
    invoke-static {}, Lnodomain/freeyourgadget/gadgetbridge/GBApplication;->acquireDB()...
    # SQL查询：SELECT HEART_RATE, TIMESTAMP FROM XIAOMI_ACTIVITY_SAMPLE
    #         WHERE HEART_RATE > 0 ORDER BY TIMESTAMP DESC LIMIT 1
    # 写文件：realtime_hr.txt（数值\\n时间戳）
    :try_end_56
    .catch Ljava/lang/Exception; {:try_start_2 .. :try_end_56} :catch_57
    ...
    return-void
.end method
```

**关键设计**：
- 自身有完整 try-catch，异常不会破坏 AutoFetch 循环 ✅
- 不依赖手环推送，直接查数据库 ✅
- 仅在数据库有心率记录时才写文件 ✅

### 每个setter的smali注入结构（1-8项通用）

```smali
.method public setXxx(Ljava/lang/Integer;)V
    .locals 5
    .catch Ljava/lang/Exception; { :try_start .. :try_end } :catch_label
    iput-object p1, p0, ...;->field:Ljava/lang/Integer;
    if-eqz p1, :ret_label
    invoke-virtual {p1}, Ljava/lang/Integer;->intValue()I
    move-result v0
    if-ltz v0, :ret_label           # >=0 就写入（零值也写！不用if-lez）
    # 构建 "数值\nUnix秒时间戳" → FileOutputStream写入
    # 路径: "...gadgetbridge.nightly/files/realtime_xxx.txt"
    :ret_label
    return-void
.end method
```

**关键规则**：
- 条件用 `if-ltz`（<0才跳过），**不用** `if-lez`（≤0跳过会丢零值）
- 路径永远带 `.nightly` 后缀
- 每个注入用独立 try/catch 标签

### AutoFetch 定时器

- `AutoFetchRunnable.run()` 内 1 分钟定时器 ✅
- `ForceFetchMonitor` 3秒轮询 `force_fetch` ✅
- 数据每分钟自动拉取 → `rawFetchOperations/2026/ACTIVITY/ACTIVITY_DAILY/SUMMARY/`

## ToolPkg 端

```
com.operit.miband_health.toolpkg
├── main.js              # 自动注入钩子 + 菜单开关（autoInject=false）
├── packages/
│   └── health_data.js   # read_health_data + diagnose
├── ui/health_panel/
└── manifest.json
```

- **main.js**: autoInject默认`false`，用户工具箱菜单开关；refreshCache()读全部8个txt
- **health_data.js**: read_health_data一步读8项；readFile()解析`数值\n时间戳`；睡眠分钟→`XhXmin`
- **零值处理**: `val===null||val===undefined||val<0` 才判无效（避免JS的0为falsy）

## 已知坑位（全部已修）

1. **步数=0显旧值**: `if-lez`→`if-ltz`（零值也要覆盖旧数据）
2. **ToolPkg读不到0**: `!val||val<=0`→`val===null||undefined||<0` + `data.steps.value!==null` 
3. **自动注入强制触发**: `autoInject=true`→`false`
4. **路径指向旧版GB**: `gadgetbridge/files/`→`gadgetbridge.nightly/files/`
5. **SpO2代码重复**: 去重清理
6. **打包用错base APK**: 始终用成功版APK（完整定制版），不是旧版Nightly
7. **exportHeartRateData抛异常断循环**: 方法自身有完整try-catch ✅
8. **zip -g替换dex导致native lib错误**: 改用`zip -0`（不压缩）+ `zipalign`解决
9. **重编译整个classes3引入其他类差异**: 改用单类反编译+完整目录重编译策略 ✅

## 打包签名

```bash
# 准备工作：编译修改后的smali
baksmali d /tmp/success_clean/classes3.dex -o /tmp/final_mod/
# 修改 /tmp/final_mod/.../AutoFetchRunnable.smali（加exportHeartRateData）
smali assemble /tmp/final_mod/ -o /tmp/classes3_final.dex

# 打包APK（⚠️必须zip -0！否则native lib提取失败）
cp 成功版APK /tmp/gb_final.apk
zip -d gb_final.apk 'classes3.dex'
cp classes3_final.dex classes3.dex
zip -0 gb_final.apk classes3.dex       # -0 = 不压缩！关键！
zipalign -f -p 4 gb_final.apk gb_final_aligned.apk
apksigner sign --ks /root/.android/debug.keystore --ks-pass pass:android \
  --ks-key-alias androiddebugkey gb_final_aligned.apk
pm install /data/local/tmp/gb_final.apk
```

**关键步骤**：
- `zip -0` 不压缩classes3.dex（防止extractNativeLibs冲突） ✅
- `zipalign` 4字节对齐 ✅
- `apksigner` 重签名（debug keystore） ✅

## 文件格式

所有txt文件：`<数值>\n<Unix秒时间戳>` — 睡眠单位是分钟，读取时自动转`XhXmin`。

## 调试命令

```bash
# 查看数据是否在更新
for f in realtime_hr.txt realtime_steps.txt; do echo "=== $f ==="; cat "/sdcard/Android/data/nodomain.freeyourgadget.gadgetbridge.nightly/files/$f" 2>/dev/null; ls -la "/sdcard/Android/data/nodomain.freeyourgadget.gadgetbridge.nightly/files/$f" 2>/dev/null; done

# 查看AutoFetch是否在跑（rawFetch目录应有最新.bin文件）
ls -lt /sdcard/Android/data/nodomain.freeyourgadget.gadgetbridge.nightly/files/rawFetch/ 2>/dev/null | head -5

# 重启GB
am force-stop nodomain.freeyourgadget.gadgetbridge.nightly && am start -n nodomain.freeyourgadget.gadgetbridge.nightly/nodomain.freeyourgadget.gadgetbridge.activities.ControlCenterv2

# 查看数据库是否存在
find /data/data/nodomain.freeyourgadget.gadgetbridge.nightly/databases/ -name '*.db'
```